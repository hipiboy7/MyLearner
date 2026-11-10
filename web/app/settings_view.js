/* MyLearner web/app/settings_view.js — 설정(화면·학습)·기록(저장 위치·백업·내려받기)·MWL 진도 들여오기(보류 결정 2 — 병행).
 * 학습 설정은 기기 사이를 따라가는 setting 사건으로, 화면 설정은 이 브라우저에만. 들여오기는 백업 → 덧붙이기 → 메모 과정 저장 → 다시 계산 → N/N.
 * 폐쇄망판(판 설정 export 거짓)에는 내려받기 단추가 없다(FR-327). MWL viewSettings(e55b9c0)의 화면·학습 설정을 옮겼다.
 * 입력: MyLearner.app·mwl_import / 출력: MyLearner.views.settings·import, actions / 트리거: #/settings · #/import/mwl
 * 문서: docs/P3_요구사항정의서_PC.md FR-307·324·327·360~364, docs/P3_설계서_PC.md 3.2·3.5절, docs/P4_설계서_Mobile.md 3.7절(주고받기·되살리기 입구) */
(function (root) {
  'use strict';
  var ns = root.MyLearner = root.MyLearner || {};
  var A = ns.app, ui = ns.ui, esc = ui.esc, L = ns.log, R = ns.replay, MI = ns.mwl_import;
  var V = ns.views = ns.views || {}, ACT = ns.actions = ns.actions || {};

  function route() { if (ns.route) ns.route(); }
  var REASON = { daily: '하루 백업', 'import-mwl': 'MWL 들여오기 전', 'import-merge': '합치기 전', restore: '되살리기 전' };
  ns.backupReason = REASON;
  function go(hash) { root.location.hash = hash; }

  // ---------------------------------------------------------------- 설정
  V.settings = function () {
    var s = A.settings(), u = ui.uiPrefs();
    var html = '<h1>설정</h1><h2>화면 <span class="small muted">이 브라우저에만 · 고르면 바로 바뀝니다</span></h2><form data-submit="uiSubmit" data-live="1" class="filters">';
    [['theme', '밝기'], ['size', '글자 크기'], ['lh', '줄 간격(강의·복습 본문)'], ['width', '본문 폭']].forEach(function (f) {
      html += '<label>' + f[1] + '<select name="' + f[0] + '">' + ui.UI_OPTS[f[0]].map(function (o) {
        return '<option value="' + o[0] + '"' + ((u[f[0]] || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>';
    });
    html += '</form><h2>학습 <span class="small muted">기록에 남아 다른 기기로도 따라갑니다</span></h2><form data-submit="settingsSubmit">';
    html += '<label class="field">평일 학습 분<input type="number" name="weekday_minutes" value="' + esc(s.weekday_minutes) + '" min="1" max="600"></label>';
    html += '<label class="field">주말 복습 분<input type="number" name="weekend_minutes" value="' + esc(s.weekend_minutes) + '" min="0" max="600"></label>';
    html += '<label class="field"><input type="checkbox" name="weekend_review_only"' + (s.weekend_review_only ? ' checked' : '') + '> 학습 요일이 아닌 날은 복습만</label>';
    html += '<label class="field">하루 최대 복습 카드<input type="number" name="max_reviews_per_day" value="' + esc(s.max_reviews_per_day) + '" min="1" max="1000"></label>';
    html += '<label class="field">하루 새 카드<input type="number" name="new_cards_per_day" value="' + esc(s.new_cards_per_day) + '" min="0" max="200"></label>';
    html += '<label class="field">학습 요일 (1=월 … 7=일, 쉼표)<input type="text" name="study_days" value="' + esc(s.study_days.join(',')) + '"></label>';
    html += '<label class="field">학습일이 바뀌는 시각(0~23시)<input type="number" name="day_start_hour" value="' + esc(s.day_start_hour) + '" min="0" max="23"></label>';
    A.regular().forEach(function (c) {
      var plans = Object.keys(c.plans || {});
      if (plans.length < 2) return;
      var cur = s.plan_variants[c.id] || c.default_plan || plans[0];
      html += '<label class="field">' + esc(c.title) + ' 학습 계획<select name="plan_variants.' + esc(c.id) + '">' + plans.map(function (v) {
        return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('') + '</select></label>';
    });
    html += '<button class="btn primary" type="submit">설정 저장</button></form>';

    html += '<h2>기록</h2><table><tbody>' +
      '<tr><th scope="row">저장 위치</th><td>' + esc(A.where) + ' (' + esc(A.storeLabel()) + ')</td></tr>' +
      '<tr><th scope="row">사건</th><td>' + A.events.length + '줄' + (A.raw.length ? ' · 해석하지 못한 줄 ' + A.raw.length + '(지우지 않고 보존)' : '') +
        (A.counts.conflicts ? ' · 같은 순번 다른 줄 ' + A.counts.conflicts : '') + '</td></tr>' +
      '<tr><th scope="row">이 기기</th><td><code>' + esc(A.dev) + '</code></td></tr>' +
      '<tr><th scope="row">저장 못 한 기록</th><td>' + (A.pending.length ? '<span class="bad">' + A.pending.length + '건</span> <button class="btn small" type="button" data-action="retrySave">다시 저장</button>' : '없음') + '</td></tr>' +
      '</tbody></table>';
    html += '<h3 id="exchange">다른 기기와 주고받기</h3>';
    if (A.cfg.export === true) {
      html += '<p class="small muted">교환 파일(zip) 하나에 이 기기에 모인 모든 기기의 기록과 내 과정이 들어갑니다. 다른 기기의 설정 → 다른 기기 기록 합치기에서 엽니다.</p>' +
        '<div class="btnrow"><button class="btn" type="button" data-action="exportExchange">교환 파일 ' + (ns.platform && ns.platform.share ? '파일로 저장' : '내려받기') + '</button>' +
        (ns.platform && ns.platform.share ? '<button class="btn" type="button" data-action="shareExchange">교환 파일 공유</button>' : '') +
        '<a class="btn" href="#/import/merge">다른 기기 기록 합치기</a></div>';
    } else {
      html += '<p class="small muted">이 판은 기록을 밖으로 내보내지 않습니다. 다른 기기의 교환 파일(zip)을 들여오기만 합니다.</p>' +
        '<div class="btnrow"><a class="btn" href="#/import/merge">다른 기기 기록 합치기</a></div>';
    }
    html += '<h3>백업</h3><p class="small muted">들여오기·합치기 전(각 최근 20개), 되살리기 전(최근 10개), 하루 첫 저장 때(최근 14일) 기록 전체를 남깁니다. ' +
      '되살리면 그 백업의 기록에 이 기기에서 쓴 기록을 더한 상태가 됩니다(그 뒤 들여온 다른 기기 기록만 빠집니다).</p><div id="backup-list" class="loading">백업 목록을 읽는 중…</div>';
    if (A.cfg.export === true) html += '<div class="btnrow"><button class="btn" type="button" data-action="exportLog">기록 파일 내려받기</button></div>';
    html += '<h2>가져오기</h2><div class="btnrow"><a class="btn" href="#/import/mwl">MWL 진도 들여오기</a></div>';
    html += '<h2>이 앱</h2><p class="small muted">' + esc(A.cfg.label || '') + (A.cfg.app_version ? ' ' + esc(A.cfg.app_version) : '') + ' · 과정 ' + A.courses.length + '개 · ' +
      (A.cfg.export ? '기록 내보내기 있음' : '기록 내보내기 없음(폐쇄망판)') + ' · 화면 폭 ' + esc(Math.round(root.innerWidth || 0)) + 'px</p>';
    return html;
  };
  V.settings.post = function (app) {
    var el = app.querySelector('#backup-list');
    if (!el) return;
    A.store.listBackups().then(function (list) {
      el.className = '';
      if (!list.length) { el.innerHTML = '<p class="small muted">아직 백업이 없습니다.</p>'; return; }
      el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>시각(UTC)</th><th>까닭</th><th>크기</th><th><span class="small">되살리기</span></th>' + (A.cfg.export === true ? '<th><span class="small">내려받기</span></th>' : '') + '</tr></thead><tbody>' +
        list.map(function (b) {
          var imp = /^import-/.test(b.reason || '');
          return '<tr><td>' + esc(String(b.at || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(REASON[b.reason] || b.reason) + '</td><td>' + esc(Math.round((b.bytes || 0) / 1024)) + ' KB</td>' +
            '<td><a class="btn small" href="#/restore/' + encodeURIComponent(b.name) + '">' + (imp ? '이 들여오기 되돌리기' : '이 시점으로 되살리기') + '</a></td>' +
            (A.cfg.export === true ? '<td><button class="btn small" type="button" data-name="' + esc(b.name) + '">' + esc(b.name) + ' 받기</button></td>' : '') + '</tr>';
        }).join('') + '</tbody></table></div>';   // 좁은 화면(폴드 접은 화면 344px)에서 열이 잘리지 않게 가로로 넘겨 본다
      var bs = el.querySelectorAll('button[data-name]');
      for (var i = 0; i < bs.length; i++) bs[i].addEventListener('click', function (ev) {
        var name = ev.currentTarget.getAttribute('data-name');
        A.store.backupText(name).then(function (t) { ui.download('mylearner-backup-' + name + '.jsonl', t); }, function (e) { ui.banner(e.message, 'bad'); });
      });
    }, function (e) { el.className = 'err-box'; el.textContent = '백업 목록을 읽지 못했습니다: ' + e.message; });
  };
  ACT.uiSubmit = function (form) {
    var fd = new root.FormData(form), u = {};
    ui.UI_KEYS.forEach(function (k) { u[k] = String(fd.get(k) || ''); });
    ui.saveUi(u);
  };
  ACT.settingsSubmit = function (form) {
    var fd = new root.FormData(form), cur = A.settings(), next = {};
    function num(name) { var v = Number(fd.get(name)); return Number.isInteger(v) ? v : NaN; }
    next.weekday_minutes = num('weekday_minutes'); next.weekend_minutes = num('weekend_minutes');
    next.weekend_review_only = !!fd.get('weekend_review_only');
    next.max_reviews_per_day = num('max_reviews_per_day'); next.new_cards_per_day = num('new_cards_per_day'); next.day_start_hour = num('day_start_hour');
    next.study_days = String(fd.get('study_days') || '').split(',').map(function (x) { return Number(x.trim()); })
      .filter(function (x, i, a) { return Number.isInteger(x) && x >= 1 && x <= 7 && a.indexOf(x) === i; }).sort();
    if (!next.study_days.length) { ui.banner('학습 요일을 1개 이상 적으세요', 'bad'); return; }
    var bad = ['weekday_minutes', 'weekend_minutes', 'max_reviews_per_day', 'new_cards_per_day', 'day_start_hour'].filter(function (k) { return !(next[k] >= 0); });
    if (bad.length || next.day_start_hour > 23 || next.weekday_minutes < 1 || next.max_reviews_per_day < 1) { ui.banner('숫자 칸을 확인하세요: ' + (bad.join(', ') || '범위'), 'bad'); return; }
    var changes = Object.keys(next).filter(function (k) { return JSON.stringify(next[k]) !== JSON.stringify(cur[k]); }).map(function (k) { return [k, next[k]]; });
    A.regular().forEach(function (c) {
      var v = fd.get('plan_variants.' + c.id);
      if (v !== null && String(v) !== (cur.plan_variants[c.id] || c.default_plan || Object.keys(c.plans || {})[0])) changes.push(['plan_variants.' + c.id, String(v)]);
    });
    if (!changes.length) { ui.banner('바뀐 설정이 없습니다'); return; }
    changes.reduce(function (p, kv) { return p.then(function (ok) { return ok && A.record('setting', { key: kv[0], value: kv[1] }); }); }, Promise.resolve(true))
      .then(function (ok) { if (ok) { ui.banner('설정 저장 - ' + changes.length + '개', 'good'); A.review = null; go('#/today'); } else route(); });
  };
  ACT.retrySave = function () { A.flush().then(function (ok) { if (ok) ui.banner('저장했습니다', 'good'); route(); }); };
  ACT.exportLog = function () {
    if (A.cfg.export !== true) return;
    var text = L.writeFile(L.merge([A.events.map(function (e) { return e.line; }), A.raw]));
    ui.download('mylearner-log-' + A.today + '.jsonl', text);
  };

  // ---------------------------------------------------------------- MWL 진도 들여오기(FR-360~364)
  function haveSet() {
    var s = Object.create(null);
    A.events.forEach(function (e) { s[e.line] = true; });
    A.raw.forEach(function (l) { s[l] = true; });
    return s;
  }
  function prepare(text, source) {
    var imp = { text: text, source: source, conv: null, error: null, fresh: 0, done: null };
    try {
      imp.conv = MI.convert(text);
      var have = haveSet();
      imp.fresh = imp.conv.lines.filter(function (l) { return have[l] !== true; }).length;
    } catch (e) { imp.error = e.message; }
    A.imp = imp;
  }
  function localMwl() {
    if (root.location.protocol !== 'file:') return null;
    try { return root.localStorage.getItem('mwl.progress'); } catch (e) { return null; }
  }
  V['import'] = function (params) {
    if (params[0] !== 'mwl') return '<h1>가져오기</h1><div class="empty"><p>모르는 가져오기입니다.</p><a class="btn" href="#/import/mwl">MWL 진도 들여오기</a></div>';
    var imp = A.imp, html = '<h1>MWL 진도 들여오기</h1>';
    html += '<div class="notice"><p><strong>병행해서 써도 됩니다.</strong> 같은 MWL 진도를 여러 번 들여와도 기록이 늘지 않고, 나중 스냅숏은 바뀐 것만 더해집니다.</p>' +
      '<p>단, 들여온 카드 상태는 <strong>그 진도의 마지막 복습일까지</strong> MyLearner 에서 한 복습을 덮습니다. 같은 카드를 같은 날 두 앱에서 복습하면 MWL 쪽 상태가 이깁니다.</p>' +
      '<p>들여오기 전에 지금 기록 전체를 백업합니다.</p></div>';
    if (A.writer !== 'mine') return html + '<div class="ro-band">다른 탭이 기록을 쓰고 있습니다 - 그 탭을 닫거나 이 탭에서 쓰기로 바꾼 뒤 들여오세요.</div>';
    if (!imp || imp.done) {
      if (imp && imp.done) {
        var d = imp.done;
        html += '<div class="card good"><h3>들여왔습니다</h3><p>새로 더한 줄 ' + d.added + ' · 메모 강의 ' + d.notesLessons + '개 · 카드 ' + d.notesCards + '장</p>' +
          '<p><strong>변환 일치 ' + d.verify.match + ' / ' + d.verify.total + '</strong> - 들여온 진도만으로 다시 계산한 카드 상태가 MWL 과 같은 수</p>' +
          '<p>지금 상태와 MWL 이 다른 카드 ' + d.now.mismatches.length + '장 - MyLearner 에서 그 뒤에 복습한 카드는 다를 수 있습니다(병행)</p></div>';
      }
      html += '<ol class="import-steps"><li>MWL 에서 <strong>설정 → 진도 내보내기(JSON)</strong> 로 파일을 받습니다(서버 모드 MWL 은 학습 앱 폴더의 <code>data/progress.json</code>).</li>' +
        '<li>아래에서 그 파일을 고르면 무엇을 들여올지 먼저 보여 줍니다.</li></ol>';
      html += '<label class="btn">MWL 진도 파일 고르기<input type="file" id="mwl-file" accept=".json,application/json" hidden></label>';
      if (localMwl()) html += ' <button class="btn" type="button" data-action="impLocal">이 브라우저의 MWL 진도 읽기</button>';
      return html;
    }
    if (imp.error) return html + '<div class="err-box"><strong>' + esc(imp.source) + ' 을(를) 들여올 수 없습니다</strong><pre>' + esc(imp.error) + '</pre></div><div class="btnrow"><button class="btn" type="button" data-action="impReset">다른 파일 고르기</button></div>';
    var r = imp.conv.report;
    html += '<h2>미리보기 <span class="small muted">' + esc(imp.source) + '</span></h2><table><tbody>' +
      '<tr><th scope="row">바꿀 사건</th><td>' + r.events + '줄(카드 상태 ' + r.cards + ')</td></tr>' +
      '<tr><th scope="row">새로 더할 줄</th><td><strong>' + imp.fresh + '</strong>' + (imp.fresh ? '' : ' - 이미 모두 들여왔습니다') + '</td></tr>' +
      '<tr><th scope="row">메모(내 지식)</th><td>강의 ' + r.notes_lessons + ' · 카드 ' + r.notes_cards + '</td></tr>' +
      '<tr><th scope="row">바꾸지 않은 것</th><td>진행 중 강의 ' + r.skipped.lessons + ' · 진행 중 실습 ' + r.skipped.labs + ' · 다시 계산이 받지 못한 사건 ' + r.invalid + '</td></tr>' +
      '<tr><th scope="row">진도 스키마</th><td>' + esc(r.schema) + '</td></tr></tbody></table>';
    return html + '<div class="btnrow"><button class="btn primary" type="button" data-action="impRun">백업하고 들여오기</button><button class="btn" type="button" data-action="impReset">취소</button></div>';
  };
  ACT.impReset = function () { A.imp = null; route(); };
  ACT.impLocal = function () { var t = localMwl(); if (t) { prepare(t, '이 브라우저의 mwl.progress'); route(); } };
  ACT.impRun = function (el) {
    var imp = A.imp;
    if (!imp || !imp.conv || imp.done) return;
    if (A.writer !== 'mine') { ui.banner('다른 탭이 기록을 쓰고 있습니다', 'bad'); return; }
    if (!root.confirm('지금 기록을 백업한 뒤 MWL 진도 ' + imp.fresh + '줄을 더합니다. 계속할까요?')) return;
    el.disabled = true;
    var conv = imp.conv, added = 0;
    A.flush().then(function (ok) {
      if (!ok) throw new Error('저장 못 한 기록이 있어 먼저 저장해야 합니다');
      return A.store.backup('import-mwl');
    }).then(function () {
      return A.store.append(conv.lines, A.today);
    }).then(function (r) {
      added = r.added;
      return conv.notes ? A.store.saveCourse(conv.notes) : null;
    }).then(function () {
      return A.loadCourses();
    }).then(function () {
      return A.reloadLog();
    }).then(function () {
      imp.done = { added: added, notesLessons: conv.report.notes_lessons, notesCards: conv.report.notes_cards,
        verify: MI.verify(imp.text, R.run(conv.events, {})), now: MI.verify(imp.text, A.st) };
      ui.banner('MWL 진도를 들여왔습니다 - 새 줄 ' + added, 'good');
      route();
    }).catch(function (e) {
      el.disabled = false;
      // 덧붙이기까지 갔다면 일부가 저장됐을 수 있다 — 다시 읽어 화면을 맞추고, 같은 파일로 다시 들여오면 빠진 것만 더한다고 알린다(독립 점검 S7)
      A.loadCourses().then(A.reloadLog, A.reloadLog).catch(function () {}).then(function () {
        ui.banner('들여오기가 끝나지 않았습니다: ' + e.message + ' - 일부만 더해졌을 수 있습니다. 같은 파일로 다시 들여오면 빠진 것만 더합니다' +
          '(백업이 실패했으면 아무것도 더하지 않았습니다)', 'bad');
        route();
      });
    });
  };
  ns.importFile = function (file) {   // main.js 가 #mwl-file 을 고르면 부른다
    var reader = new root.FileReader();
    A.reading = true;
    reader.onerror = function () { A.reading = false; ui.banner('파일을 읽지 못했습니다', 'bad'); };
    reader.onload = function () { A.reading = false; prepare(String(reader.result), file.name); route(); };
    reader.readAsText(file, 'utf-8');
  };
})(typeof self !== 'undefined' ? self : this);
