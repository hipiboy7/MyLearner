/* MyLearner web/app/merge_view.js — 다른 기기 기록 합치기(#/import/merge)·백업 시점으로 되살리기(#/restore/<백업>)·교환 파일 내보내기·내보내기 알림 띠.
 * 상태를 바꾸는 것은 단추 + 확인뿐이다(주소만으로는 미리보기까지). 합치기: 파일 → 미리보기 → 저장 못 한 기록 저장 → 백업('import-merge') → 덧붙이기 →
 * 새 사용자 과정 저장 → 다시 읽기 → N/N. 되살리기: 차이(backupDiff) → 계획(백업 ∪ 이 기기 줄) → restore → 다시 읽기. 계산은 core/merge.js·exchange.js.
 * 입력: MyLearner.app·exchange·merge·zip / 출력: MyLearner.views.import(merge)·restore, actions, MyLearner.mergeView / 트리거: 설정 화면·오늘 화면
 * 문서: docs/P4_요구사항정의서_Mobile.md FR-413·421~424·430~436·440~443, docs/P4_설계서_Mobile.md 3.5~3.7절 */
(function (root) {
  'use strict';
  var ns = root.MyLearner = root.MyLearner || {};
  var A = ns.app, ui = ns.ui, esc = ui.esc, L = ns.log, R = ns.replay, X = ns.exchange, M = ns.merge, K = ns.course, SC = ns.storeCommon;
  var V = ns.views = ns.views || {}, ACT = ns.actions = ns.actions || {};
  var EXPORTED = 'mylearner.exported';
  var CHUNK_LINES = 20000, CHUNK_BYTES = 8 * 1024 * 1024;   // 서버 한도(본문 32 MB·한 번 50,000줄) 안에서 나눠 보낸다
  var ERR = {
    'E-FILE-KIND': '교환 파일(.zip)이나 기록 파일(.jsonl)이 아닙니다.',
    'E-FILE-MWL': 'MWL 진도 파일입니다 - 설정 → MWL 진도 들여오기에서 여세요.',
    'E-ZIP': 'zip 이 깨졌거나 잘렸습니다(옮기는 중 일부만 받았을 수 있습니다).',
    'E-ZIP-LIMIT': 'zip 이 너무 크거나 항목이 너무 많습니다.',
    'E-ZIP-METHOD': '암호가 걸렸거나 이 앱이 풀 수 없는 압축입니다.',
    'E-EX-FORMAT': 'MyLearner 교환 파일 머리가 아닙니다.',
    'E-EX-READER': '이 앱보다 새 판이 만든 교환 파일입니다 - 앱을 새 판으로 올린 뒤 여세요.',
    'E-EX-MISSING': '교환 파일 안에 있어야 할 파일이 없습니다.',
    'E-EX-HASH': '교환 파일 안 파일이 머리에 적힌 것과 다릅니다(옮기다 깨졌습니다) - 처음 만든 기기에서 다시 내보내세요.',
    'E-LOG-FORMAT': '기록 파일 머리가 아닙니다.',
    'E-LOG-READER': '이 앱보다 새 판이 만든 기록 파일입니다.',
    'E-LINE-LONG': '64KB 넘는 기록 줄이 있어 저장할 수 없습니다.',
    'E-SEQ-END': '순번이 끝에 가까운 기록 줄이 있어 합치지 않습니다 - 들이면 그 기기가 더 기록할 수 없게 됩니다(손으로 고친 파일일 수 있습니다).',
    'E-UTF8': '글자(UTF-8)가 깨진 파일입니다.'
  };

  function route() { if (ns.route) ns.route(); }
  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, v); } catch (e) { /* 알림용 — 못 적어도 된다 */ } }
  function devLabel(dev) { return A.isOwn(dev) ? '이 기기' : '<code>' + esc(String(dev).slice(0, 8)) + '</code>'; }

  // 브라우저의 deflate-raw 풀기 — 적힌 크기(max)를 넘게 풀리면 끊는다(압축 폭탄)
  function inflateRaw(data, max) {
    if (typeof root.DecompressionStream !== 'function') return Promise.reject(new Error('이 브라우저는 압축된 zip 을 풀 수 없습니다'));
    var ds = new root.DecompressionStream('deflate-raw'), w = ds.writable.getWriter(), rd = ds.readable.getReader(), chunks = [], n = 0;
    w.write(data).catch(function () {});
    w.close().catch(function () {});
    function pump() {
      return rd.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(n), p = 0;
          chunks.forEach(function (c) { out.set(c, p); p += c.length; });
          return out;
        }
        n += r.value.length;
        if (n > max) { rd.cancel().catch(function () {}); throw new Error('적힌 크기보다 크게 풀립니다'); }
        chunks.push(r.value);
        return pump();
      });
    }
    return pump();
  }
  ns.inflateRaw = inflateRaw;

  // ---------------------------------------------------------------- 내보내기
  function exchangeFile() {
    return A.flush().then(function (ok) {
      if (!ok) throw new Error('저장 못 한 기록이 있어 먼저 저장해야 합니다(설정 → 기록 → 다시 저장)');
      return A.store.loadCourses();
    }).then(function (courses) {
      return X.build({ lines: A.events.map(function (e) { return e.line; }), raw: A.raw, courses: courses,
        app: { version: A.cfg.app_version || '', edition: A.cfg.edition || '', label: A.cfg.label || '' }, dev: A.dev, now: new Date(), dayStartHour: A.settings().day_start_hour });
    });
  }
  function exported(ok, what) {
    if (ok === false) { ui.banner('저장하지 않았습니다', 'bad'); return; }
    lsSet(EXPORTED, new Date().toISOString());
    ui.banner(what + ' - 다른 기기의 설정 → 다른 기기 기록 합치기에서 엽니다', 'good');
    route();
  }
  ACT.exportExchange = function (el) {
    if (A.cfg.export !== true) return;
    el.disabled = true;
    exchangeFile().then(function (f) {
      return ui.download(f.name, f.bytes, 'application/zip').then(function (ok) { exported(ok, '교환 파일 ' + f.name + '(' + f.manifest.files[0].lines + '줄)'); });
    }).catch(function (e) { ui.banner('내보내지 못했습니다: ' + e.message, 'bad'); }).then(function () { el.disabled = false; });
  };
  ACT.shareExchange = function (el) {
    if (A.cfg.export !== true || !(ns.platform && ns.platform.share)) return;
    el.disabled = true;
    exchangeFile().then(function (f) {
      return ns.platform.share(f.name, f.bytes, 'application/zip').then(function (ok) { exported(ok, '교환 파일을 보냈습니다'); });
    }).catch(function (e) { ui.banner('보내지 못했습니다: ' + e.message, 'bad'); }).then(function () { el.disabled = false; });
  };

  // 오늘 위 띠 — 판 설정 remind_export_days 를 넘게 내보내지 않았으면(앱을 지우면 앱 안 기록도 지워진다 — FR-413)
  function reminder() {
    var days = A.cfg.export === true ? Number(A.cfg.remind_export_days) || 0 : 0;
    if (!days) return '';
    var first = null;
    for (var i = 0; i < A.events.length; i++) { var e = A.events[i]; if (A.isOwn(e.dev) && (!first || e.t < first)) first = e.t; }
    var n = M.reminderDays({ exportedAt: lsGet(EXPORTED), firstOwnT: first, now: new Date(), days: days });
    if (n === null) return '';
    return '<div class="notice remind" role="status"><p><strong>마지막 내보내기 ' + n + '일 전</strong> - 앱을 지우거나 폰을 바꾸면 이 기기의 기록도 사라집니다. ' +
      '교환 파일을 PC 나 드라이브에 저장해 두세요.</p><a class="btn small" href="#/settings">설정 → 내보내기</a></div>';
  }

  // ---------------------------------------------------------------- 합치기 — 준비
  function courseStatus(c) {
    if (!c.obj) return { id: c.id, status: 'invalid', why: c.error || '읽을 수 없음' };
    if (c.obj.id !== c.id) return { id: c.id, status: 'invalid', why: '파일 이름과 과정 ID 가 다릅니다' };
    var v;
    try { v = K.validate(c.obj); } catch (e) { v = { ok: false, errors: [{ code: 'E-THROW', path: '', msg: e.message }] }; }
    if (!v.ok) return { id: c.id, status: 'invalid', why: v.errors.slice(0, 3).map(function (x) { return x.code + ' ' + x.path; }).join(', ') };
    var have = A.course(c.id);
    if (have && A.userIds[c.id] !== true) return { id: c.id, status: 'bundled', obj: c.obj };
    if (!have) return { id: c.id, status: 'new', obj: c.obj };
    return { id: c.id, status: L.canonical(have) === L.canonical(c.obj) ? 'same' : 'diff', obj: c.obj };
  }
  function prepare(bytes, source) {
    var m = { source: source, res: null, pv: null, courses: [], error: null, done: null, busy: false };
    A.mrg = m;
    return X.open(bytes, { inflateRaw: inflateRaw }).then(function (res) {
      m.res = res;
      if (!res.ok) { m.error = res; return; }
      m.pv = M.preview({ have: A.allLines(), file: res.lines, today: A.today, isOwn: A.isOwn, known: R.KNOWN });
      // 들이면 저장·기록이 막히는 줄 — 파일째 거부한다(독립 점검 2026-11-10 F-1·F-2)
      if (m.pv.long) { m.error = { error: 'E-LINE-LONG', msg: '정규형이 64 KiB 를 넘는 줄 ' + m.pv.long + '개' }; return; }
      if (m.pv.seq_end) { m.error = { error: 'E-SEQ-END', msg: '순번이 ' + M.SEQ_LIMIT + ' 을 넘는 줄 ' + m.pv.seq_end + '개' }; return; }
      m.courses = res.courses.map(courseStatus);
    }).catch(function (e) { m.error = { error: 'E-FILE-KIND', msg: e.message }; });
  }
  ns.mergeFile = function (file) {
    var reader = new root.FileReader();
    A.reading = true;
    A.mrg = { source: file.name, busy: true };
    route();
    reader.onerror = function () { A.reading = false; A.mrg = null; ui.banner('파일을 읽지 못했습니다', 'bad'); route(); };
    reader.onload = function () {
      A.reading = false;
      prepare(new Uint8Array(reader.result), file.name).then(route);
    };
    reader.readAsArrayBuffer(file);
  };

  // ---------------------------------------------------------------- 합치기 — 화면
  var STATUS = { 'new': '새 과정 - 저장', same: '같음', diff: '다름 - 지금 것을 둠(Phase 5 에서 합치기)', invalid: '검사 실패 - 싣지 않음', bundled: '앱에 실린 과정과 ID 가 같음 - 싣지 않음' };
  var CLOCK = { ok: '', ahead: '시계 확인 - 오늘보다 뒤 날짜', back: '시계 확인 - 날짜가 뒤로 감' };
  function pickHtml() {
    return '<ol class="import-steps"><li>다른 기기(폰·PC)의 <strong>설정 → 다른 기기와 주고받기 → 교환 파일</strong> 로 zip 을 만들어 이 기기로 옮깁니다(카톡 나에게·메일·USB·드라이브).</li>' +
      '<li>아래에서 그 파일을 고르면 무엇을 더할지 먼저 보여 줍니다. 기록 파일(.jsonl)·백업 파일도 받습니다.</li></ol>' +
      '<label class="btn">교환 파일 고르기<input type="file" id="merge-file" accept=".zip,.jsonl,application/zip" hidden></label>';
  }
  function previewHtml(m) {
    var pv = m.pv, man = m.res.manifest, html = '<h2>미리보기 <span class="small muted">' + esc(m.source) + '</span></h2><table><tbody>';
    html += '<tr><th scope="row">파일</th><td>' + (man ? '교환 파일 · ' + esc(man.app && man.app.label) + ' ' + esc(man.app && man.app.version) + ' · 만든 기기 ' + devLabel(man.dev) +
      ' · ' + esc(man.made_at) : '기록 파일(.jsonl)') + '</td></tr>';
    html += '<tr><th scope="row">파일의 기록</th><td>' + pv.total + '줄</td></tr>';
    html += '<tr><th scope="row">새로 더할 줄</th><td><strong>' + pv.fresh + '</strong>' + (pv.fresh ? '' : ' - 이미 모두 있음') + '</td></tr></tbody></table>';
    if (pv.devices.length) {
      html += '<h3>기기</h3><table><thead><tr><th>기기</th><th>새 줄 / 파일의 줄</th><th>학습일</th><th>확인</th></tr></thead><tbody>' + pv.devices.map(function (d) {
        return '<tr><td>' + devLabel(d.dev) + '</td><td>' + d.fresh + ' / ' + d.total + '</td><td>' + esc(d.first_day) + ' ~ ' + esc(d.last_day) + '</td><td>' +
          (d.clock === 'ok' ? '-' : '<span class="warn">' + esc(CLOCK[d.clock]) + '</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (pv.courses.length) {
      html += '<h3>과정마다 새 기록</h3><table><thead><tr><th>과정</th><th>복습</th><th>강의</th><th>그 밖</th></tr></thead><tbody>' + pv.courses.map(function (c) {
        var co = A.course(c.course);
        return '<tr><td>' + (c.course === '-' ? '(과정 없음 - 학습 시간·설정)' : esc(co ? co.title : c.course)) + '</td><td>' + c.reviews + '</td><td>' + c.lessons + '</td><td>' + c.other + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (m.courses.length) {
      html += '<h3>내 과정</h3><table><thead><tr><th>과정</th><th>이렇게 합니다</th></tr></thead><tbody>' + m.courses.map(function (c) {
        return '<tr><td><code>' + esc(c.id) + '</code></td><td>' + esc(STATUS[c.status]) + (c.why ? ' <span class="small muted">(' + esc(c.why) + ')</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    var warn = [];
    if (pv.conflicts_new) warn.push('같은 기기·순번에 다른 기록 ' + pv.conflicts_new + '건 - 둘 다 남기고 셉니다');
    if (pv.unknown) warn.push('이 판이 모르는 종류의 기록 ' + pv.unknown + '줄 - 계산하지 않고 그대로 남깁니다');
    if (pv.bad || pv.newer) warn.push('해석하지 못한 줄 ' + pv.bad + ' · 새 판 줄 ' + pv.newer + ' - 지우지 않고 그대로 남깁니다');
    if (pv.future) warn.push('계산하는 날보다 뒤 날짜의 기록 ' + pv.future + '줄 - 그날이 오면 계산에 들어갑니다');
    if (warn.length) html += '<div class="notice"><ul>' + warn.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    var news = m.courses.filter(function (c) { return c.status === 'new'; }).length;
    if (!pv.fresh && !news) return html + '<div class="btnrow"><button class="btn" type="button" data-action="mergeReset">다른 파일 고르기</button></div>';
    return html + '<p class="small muted">합치기 전에 지금 기록 전체를 백업합니다. 잘못 합쳤으면 설정 → 백업에서 \'이 들여오기 되돌리기\' 로 이 기기에서 쓴 기록은 남긴 채 되돌립니다.</p>' +
      '<div class="btnrow"><button class="btn primary" type="button" data-action="mergeRun">백업하고 합치기</button><button class="btn" type="button" data-action="mergeReset">취소</button></div>';
  }
  function mergeView() {
    var m = A.mrg, html = '<h1>다른 기기 기록 합치기</h1>';
    html += '<div class="notice"><p>다른 기기(폰·내 PC)의 기록을 이 기기 기록에 <strong>더합니다</strong>. 아무것도 지우지 않고, 같은 파일을 여러 번 합쳐도 기록이 늘지 않습니다.</p>' +
      (A.cfg.export === true ? '' : '<p>이 판(' + esc(A.cfg.label || '') + ')은 들여오기만 하고 밖으로 내보내지 않습니다.</p>') + '</div>';
    if (A.writer !== 'mine') return html + '<div class="ro-band">다른 탭이 기록을 쓰고 있습니다 - 그 탭을 닫거나 이 탭에서 쓰기로 바꾼 뒤 합치세요.</div>';
    if (!m) return html + pickHtml();
    if (m.busy && !m.res && !m.error) return html + '<p class="loading">' + esc(m.source) + ' 을(를) 읽는 중…</p>';
    if (m.done) {
      var d = m.done;
      return html + '<div class="card good"><h2>합쳤습니다</h2><p>새로 더한 줄 ' + d.added + (d.courses ? ' · 새 과정 ' + d.courses : '') + '</p>' +
        '<p><strong>파일의 기록 ' + d.present.present + ' / ' + d.present.total + '</strong> 이 이 기기 기록에 있습니다' + (d.present.present === d.present.total ? '' : ' <span class="bad">- 빠진 줄이 있습니다. 같은 파일로 다시 합치세요</span>') + '</p>' +
        (d.conflicts ? '<p>새 충돌 ' + d.conflicts + '건(같은 기기·순번에 다른 기록 - 둘 다 남김)</p>' : '') + '</div>' +
        '<div class="btnrow"><a class="btn primary" href="#/today">오늘로</a><a class="btn" href="#/restore/' + encodeURIComponent(d.backup) + '">이 들여오기 되돌리기</a>' +
        '<button class="btn" type="button" data-action="mergeReset">다른 파일 합치기</button></div>';
    }
    if (m.error) {
      return html + '<div class="err-box"><strong>' + esc(m.source) + ' 을(를) 합칠 수 없습니다</strong><p>' + esc(ERR[m.error.error] || m.error.error) + '</p>' +
        '<pre>' + esc(m.error.error + (m.error.msg ? ' ' + m.error.msg : '')) + '</pre></div>' +
        (m.error.error === 'E-FILE-MWL' ? '<div class="btnrow"><a class="btn" href="#/import/mwl">MWL 진도 들여오기</a></div>' : '') +
        '<div class="btnrow"><button class="btn" type="button" data-action="mergeReset">다른 파일 고르기</button></div>';
    }
    return html + previewHtml(m);
  }
  var mwlImport = V['import'];
  V['import'] = function (params) { return params[0] === 'merge' ? mergeView() : mwlImport(params); };
  ACT.mergeReset = function () { A.mrg = null; route(); };

  // 덧붙이기를 서버 한도 안에서 나눠 보낸다
  function appendAll(lines) {
    var parts = [], cur = [], bytes = 0, added = 0;
    lines.forEach(function (l) {
      var n = SC.utf8Length(l) + 1;
      if (cur.length && (cur.length >= CHUNK_LINES || bytes + n > CHUNK_BYTES)) { parts.push(cur); cur = []; bytes = 0; }
      cur.push(l); bytes += n;
    });
    if (cur.length) parts.push(cur);
    return parts.reduce(function (p, part) {
      return p.then(function () { return A.store.append(part, A.today); }).then(function (r) { added += r.added; });
    }, Promise.resolve()).then(function () { return added; });
  }
  // 합치기·되살리기 동안 '저장 중' 으로 둔다 — 날짜 넘김(checkDay)이 여러 번에 나눠 보내는 중간에 다시 읽지 않게(독립 점검 2026-11-10)
  function hold() {
    var held = true;
    A.saving += 1;
    return function () { if (held) { held = false; A.saving -= 1; } };
  }
  ACT.mergeRun = function (el) {
    var m = A.mrg;
    if (!m || !m.pv || m.done || m.busy) return;
    if (A.writer !== 'mine') { ui.banner('다른 탭이 기록을 쓰고 있습니다', 'bad'); return; }
    var news = m.courses.filter(function (c) { return c.status === 'new'; });
    if (!root.confirm('지금 기록을 백업한 뒤 새 기록 ' + m.pv.fresh + '줄' + (news.length ? '과 새 과정 ' + news.length + '개' : '') + '를 더합니다. 계속할까요?')) return;
    el.disabled = true; m.busy = true;
    var backup = null, added = 0, conflicts0 = A.counts.conflicts || 0, letGo = hold();
    A.flush().then(function (ok) {
      if (!ok) throw new Error('저장 못 한 기록이 있어 먼저 저장해야 합니다');
      return A.store.backup('import-merge');
    }).then(function (b) {
      backup = b.name;
      return appendAll(m.pv.freshLines);
    }).then(function (n) {
      added = n;
      return news.reduce(function (p, c) { return p.then(function () { return A.store.saveCourse(c.obj); }); }, Promise.resolve());
    }).then(function () {
      return A.loadCourses();
    }).then(function () {
      return A.reloadLog();
    }).then(function () {
      letGo();
      m.busy = false;
      m.done = { added: added, courses: news.length, backup: backup, present: M.present(A.allLines(), m.res.lines), conflicts: Math.max(0, (A.counts.conflicts || 0) - conflicts0) };
      ui.banner('합쳤습니다 - 새 줄 ' + added, 'good');
      route();
    }).catch(function (e) {
      letGo();
      m.busy = false; el.disabled = false;
      // 덧붙이기까지 갔다면 일부가 저장됐을 수 있다 — 다시 읽어 화면을 맞추고, 같은 파일로 다시 하면 빠진 것만 더한다고 알린다(FR-435)
      A.loadCourses().then(A.reloadLog, A.reloadLog).catch(function () {}).then(function () {
        ui.banner('합치기가 끝나지 않았습니다: ' + e.message + ' - ' + (backup ? '일부만 더해졌을 수 있습니다. 같은 파일로 다시 합치면 빠진 것만 더합니다' : '백업을 만들지 못해 아무것도 더하지 않았습니다'), 'bad');
        if (m.pv) m.pv = M.preview({ have: A.allLines(), file: m.res.lines, today: A.today, isOwn: A.isOwn, known: R.KNOWN });
        route();
      });
    });
  };

  // ---------------------------------------------------------------- 되살리기
  V.restore = function (params) {
    var name = params[0] || '', r = A.rst && A.rst.name === name ? A.rst : null, html = '<h1>백업 시점으로 되살리기</h1>';
    html += '<div class="notice"><p>되살린 뒤 기록 = <strong>그 백업의 기록 + 이 기기에서 쓴 기록</strong>. 그 뒤 들여온 다른 기기 기록만 빠집니다.</p>' +
      '<p>되살리기 전에 지금 기록 전체를 백업하므로, 마음이 바뀌면 그 백업(\'되살리기 전\')을 다시 되살리면 됩니다.</p></div>';
    if (A.writer !== 'mine') return html + '<div class="ro-band">다른 탭이 기록을 쓰고 있습니다 - 그 탭을 닫거나 이 탭에서 쓰기로 바꾼 뒤 되살리세요.</div>';
    if (!/^\d{8}T\d{9}Z-[a-z][a-z0-9-]{0,31}$/.test(name)) return html + '<div class="err-box">백업 이름이 틀렸습니다.</div><a class="btn" href="#/settings">설정으로</a>';
    if (!r || r.loading) return html + '<p id="restore-load" class="loading">백업과 지금 기록을 비교하는 중…</p>';
    if (r.error) return html + '<div class="err-box">' + esc(r.error) + '</div><a class="btn" href="#/settings">설정으로</a>';
    if (r.done) {
      return html + '<div class="card good"><h2>되살렸습니다</h2><p>뺀 줄 ' + r.done.removed + ' · 되돌아온 줄 ' + r.done.added + '</p>' +
        '<p class="small muted">되살리기 전 기록은 백업 ' + esc(r.done.backup) + ' 에 있습니다.</p></div><div class="btnrow"><a class="btn primary" href="#/today">오늘로</a>' +
        '<a class="btn" href="#/restore/' + encodeURIComponent(r.done.backup) + '">되살리기 전으로 다시</a></div>';
    }
    var p = r.plan;
    html += '<h2>미리보기 <span class="small muted">' + esc(r.info ? r.info.at : name) + ' · ' + esc((ns.backupReason || {})[r.info && r.info.reason] || '') + '</span></h2><table><tbody>' +
      '<tr><th scope="row">뺄 줄(다른 기기)</th><td><strong>' + p.remove.length + '</strong></td></tr>' +
      '<tr><th scope="row">되돌아올 줄(백업에만 있음)</th><td>' + p.add + '</td></tr>' +
      '<tr><th scope="row">남기는 이 기기 줄</th><td>' + p.keep_own + '</td></tr>' +
      '<tr><th scope="row">그 뒤 들여오기·합치기</th><td>' + r.after + '건 - 함께 빠집니다</td></tr></tbody></table>';
    if (p.by_dev.length) html += '<h3>빼는 기록</h3><table><thead><tr><th>기기</th><th>줄</th></tr></thead><tbody>' + p.by_dev.map(function (d) {
      return '<tr><td>' + (d.dev === '-' ? '(해석하지 못한 줄)' : devLabel(d.dev)) + '</td><td>' + d.remove + '</td></tr>';
    }).join('') + '</tbody></table>';
    if (!p.remove.length && !p.add) return html + '<p>바뀔 것이 없습니다 - 지금 기록이 이미 그 백업 + 이 기기 기록입니다.</p><a class="btn" href="#/settings">설정으로</a>';
    return html + '<div class="btnrow"><button class="btn primary" type="button" data-action="restoreRun">백업하고 되살리기</button><a class="btn" href="#/settings">취소</a></div>';
  };
  V.restore.post = function () {
    var name = decodeURIComponent(String(root.location.hash).replace(/^#\/restore\//, ''));
    if (A.rst && A.rst.name === name) return;
    if (A.writer !== 'mine' || !/^\d{8}T\d{9}Z-[a-z][a-z0-9-]{0,31}$/.test(name)) return;
    var r = A.rst = { name: name, loading: true };
    Promise.all([A.store.listBackups(), A.store.backupDiff(name)]).then(function (got) {
      var list = got[0], info = list.filter(function (b) { return b.name === name; })[0] || null;
      r.info = info;
      r.after = list.filter(function (b) { return b.name > name && /^import-/.test(b.reason || ''); }).length;
      r.plan = M.restorePlan({ onlyCurrent: got[1].onlyCurrent, onlyBackup: got[1].onlyBackup, isOwn: A.isOwn });
      r.loading = false;
    }).catch(function (e) { r.loading = false; r.error = '백업을 읽지 못했습니다: ' + e.message; }).then(function () { if (A.rst === r) route(); });
  };
  ACT.restoreRun = function (el) {
    var r = A.rst;
    if (!r || !r.plan || r.done || r.busy) return;
    if (!root.confirm('지금 기록을 백업한 뒤 다른 기기 기록 ' + r.plan.remove.length + '줄을 빼고 백업에만 있는 ' + r.plan.add + '줄을 되돌립니다. 계속할까요?')) return;
    el.disabled = true; r.busy = true;
    var letGo = hold();
    A.flush().then(function (ok) {
      if (!ok) throw new Error('저장 못 한 기록이 있어 먼저 저장해야 합니다');
      return A.store.restore(r.name, r.plan.remove);
    }).then(function (res) {
      r.done = res;
      return A.reloadLog();
    }).then(function () {
      letGo();
      r.busy = false;
      ui.banner('되살렸습니다 - 뺀 줄 ' + r.done.removed + ' · 되돌아온 줄 ' + r.done.added, 'good');
      route();
    }).catch(function (e) {
      letGo();
      r.busy = false; el.disabled = false;
      A.reloadLog().catch(function () {}).then(function () { ui.banner('되살리지 못했습니다: ' + e.message, 'bad'); route(); });
    });
  };

  ns.mergeView = { reminder: reminder, EXPORTED: EXPORTED };
})(typeof self !== 'undefined' ? self : this);
