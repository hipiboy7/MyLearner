/* MyLearner web/app/stats_view.js — 통계 화면(보류 결정 1 순서): ① 학습량·목표·연속·7일 예정 ② 복습량·정답률 추이 ③ 카드 상태·정착률
 * ④ 진도·숙련도 ⑤ 틀림이 많은 카드·단원 ⑥ 점검 전·후. 과정별·전체를 고르고 위에 범위를 적는다. 계산은 web/core/stats.js(등급 A),
 * 차트는 app/util.js 의 인라인 SVG. 색만으로 말하지 않는다 — 칸마다 이름과 수를 글로 함께 둔다. MWL viewStats(e55b9c0)의 타일·막대 규칙.
 * 입력: MyLearner.app 상태 / 출력: MyLearner.views.stats / 트리거: #/stats[/<과정>]
 * 문서: docs/P3_요구사항정의서_PC.md FR-340~347, docs/P3_설계서_PC.md 3.7절 */
(function (root) {
  'use strict';
  var ns = root.MyLearner = root.MyLearner || {};
  var A = ns.app, ui = ns.ui, esc = ui.esc, T = ns.stats, C = ns.constants;
  var V = ns.views = ns.views || {};

  function short(d) { return d.slice(5); }
  function section(n, title, body) { return '<section aria-labelledby="st-' + n + '"><h2 id="st-' + n + '">' + n + ' ' + esc(title) + '</h2>' + body + '</section>'; }
  function empty(msg) { return '<div class="empty"><p>' + esc(msg) + '</p></div>'; }

  V.stats = function (params) {
    if (!A.courses.length) return '<h1>통계</h1>' + empty('실린 과정이 없습니다.');
    var sel = params[0] && A.course(params[0]) ? params[0] : null, filter = sel ? [sel] : null, st = A.st, courses = A.courses;
    var html = '<h1>통계</h1><p class="scope">범위: ' + esc(A.cfg.stats_scope || '') + ' · ' + esc(sel ? A.course(sel).title : '전체 과정') + ' · 기준일 ' + esc(A.today) + '</p>';
    html += '<div class="pick"><a class="btn small' + (sel ? '' : ' primary') + '" href="#/stats">전체</a>' + courses.map(function (c) {
      return '<a class="btn small' + (sel === c.id ? ' primary' : '') + '" href="#/stats/' + esc(c.id) + '">' + esc(c.title) + '</a>';
    }).join('') + '</div>';

    // ① 학습량·목표·연속·7일 예정
    var o = T.overview(courses, st, A.today, A.settings(), filter), due = o.due7.reduce(function (a, d) { return a + d.count; }, 0);
    var b1 = '<div class="grid">' + ui.statTile(o.today_minutes + ' / ' + o.today_goal + '분', '오늘 학습') + ui.statTile(o.week_minutes + ' / ' + o.week_goal + '분', '이번 주(월~일)') +
      ui.statTile(o.streak + '일', '연속 학습') + ui.statTile(due + '장', '앞으로 7일 복습 예정', '밀린 것은 오늘에') + '</div>';
    b1 += '<p class="small muted">학습 시간은 과정을 나누지 않고 그날 합계로 셉니다.</p>';
    b1 += due ? ui.chartCard(ui.barChart(o.due7.map(function (d, i) { return { label: i ? short(d.date) : '오늘', value: d.count }; }), '장', 0, false, '앞으로 7일 날마다 복습 예정 카드 수'))
      : empty('앞으로 7일 안에 복습할 카드가 없습니다.');
    html += section('①', '학습량·연속·7일 예정', b1);

    // ② 복습량·정답률 추이
    var t = T.trend(st, A.today, 28, filter), any = t.daily.some(function (d) { return d.reviews > 0; });
    var b2 = any ? ui.chartCard(ui.barChart(t.daily.map(function (d) { return { label: short(d.date), value: d.reviews }; }), '장', 0, false, '최근 28일 날마다 복습 수')) +
      '<h3>주마다 정답률(good 이상)</h3>' + ui.chartCard(ui.barChart(t.weekly.map(function (w) {
        return w.accuracy === null ? { label: short(w.week_start) + ' 주', value: 0, text: '—', note: '복습 없음' }
          : { label: short(w.week_start) + ' 주', value: Math.round(100 * w.accuracy), note: w.reviews + '장' };
      }), '%', 100, true, '주마다 정답률'))
      : empty('최근 28일 복습 기록이 없습니다. 복습을 하면 여기에 쌓입니다.');
    html += section('②', '복습량·정답률 추이', b2);

    // ③ 카드 상태·정착률
    var cs = T.cardStates(courses, st, filter);
    var parts = [['new', '새 카드'], ['learning', '배우는 중'], ['settled', '정착'], ['held', '보류']];
    var b3 = cs.total ? '<div class="stack" role="img" aria-label="카드 상태 분포 — ' + parts.map(function (p) { return p[1] + ' ' + cs[p[0]] + '장'; }).join(', ') + '">' +
      parts.map(function (p) { return cs[p[0]] ? '<span class="s-' + p[0] + '" data-pct="' + (100 * cs[p[0]] / cs.total) + '"></span>' : ''; }).join('') + '</div>' +
      '<ul class="legend-list">' + parts.map(function (p) { return '<li class="s-' + p[0] + '">' + p[1] + ' ' + cs[p[0]] + '장 (' + Math.round(100 * cs[p[0]] / cs.total) + '%)</li>'; }).join('') + '</ul>' +
      '<div class="grid">' + ui.statTile(ui.pctText(cs.settle_rate), '정착률', '본 카드마다 최근 3회 중 good 이상 비율의 평균') + ui.statTile(cs.total + '장', '과정 파일의 카드') + '</div>' +
      '<p class="small muted">정착 = 3회 이상 복습했고 최근 3회가 모두 good 이상인 카드.</p>'
      : empty('카드가 있는 과정이 없습니다.');
    html += section('③', '카드 상태·정착률', b3);

    // ④ 진도·숙련도
    var pr = T.progress(courses, st, filter), b4 = '';
    Object.keys(pr).forEach(function (cid) {
      var p = pr[cid], c = A.course(cid), rows = '';
      b4 += '<h3>' + esc(c.title) + ' <span class="small muted">강의 ' + p.lessons_done + ' / ' + p.lessons_total + '</span></h3>' + ui.bar(c.title + ' 강의 진도', p.lessons_done, p.lessons_total);
      var pids = Object.keys(p.parts);
      if (pids.length > 1) b4 += ui.chartCard(ui.barChart(pids.map(function (pid) {
        return { label: p.parts[pid].title || pid, value: Math.round(p.parts[pid].avg_level * 10) / 10, note: p.parts[pid].lessons_done + '/' + p.parts[pid].lessons_total };
      }), '', 5, true, c.title + ' 영역별 평균 숙련도(L0~L5)'));
      pids.forEach(function (pid) {
        Object.keys(p.parts[pid].units).forEach(function (uid) {
          var u = p.parts[pid].units[uid];
          if (!u.lessons_done && u.level === 0) return;
          rows += '<tr><td>' + esc(uid + ' ' + (u.title || '')) + '</td><td>L' + u.level + ' ' + esc(C.MASTERY_LEVELS[u.level] || '') + '</td><td>' + u.lessons_done + '/' + u.lessons_total + '</td><td>' + ui.pctText(u.retention) + '</td></tr>';
        });
      });
      b4 += rows ? '<table><thead><tr><th>단원</th><th>숙련도</th><th>강의</th><th>정착률</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="small muted">아직 시작한 단원이 없습니다. 강의를 하나 마치면 그 단원이 여기에 나옵니다.</p>';
    });
    html += section('④', '진도·숙련도', b4 || empty('일반 과정이 없습니다(메모 과정은 진도를 세지 않습니다).'));

    // ⑤ 틀림이 많은 카드·단원
    var w = T.weak(courses, st, filter, 10, 5), b5 = '';
    if (w.cards.length) {
      b5 += '<h3>카드(again 많은 순)</h3><ol class="weak-list">' + w.cards.map(function (x) {
        var c = A.course(x.course), href = A.lessonHref(c, x.lesson);
        return '<li><span class="course-tag">' + esc(c.title) + '</span><strong>' + esc(x.card) + '</strong> · again ' + x.again + '회 / 복습 ' + x.reviews + '회 · ' + esc(String(c.cards[x.card].q).slice(0, 60)) +
          (href ? ' · <a href="' + esc(href) + '">강의 ' + esc(x.lesson) + '</a>' : '') + '</li>';
      }).join('') + '</ol>';
      b5 += '<h3>단원</h3><table><thead><tr><th>단원</th><th>again</th><th>정착률</th></tr></thead><tbody>' + w.units.map(function (u) {
        return '<tr><td><span class="course-tag">' + esc(A.course(u.course).title) + '</span>' + esc(u.unit + ' ' + u.title) + '</td><td>' + u.again + '회</td><td>' + ui.pctText(u.retention) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    html += section('⑤', '틀림이 많은 카드·단원', b5 || empty('again 을 누른 카드가 아직 없습니다.'));

    // ⑥ 점검 전·후
    var b6 = '';
    (sel ? [A.course(sel)] : A.regular()).forEach(function (c) {
      var cmp = T.checkCompare(st, c.id);
      if (!cmp.first) return;
      var keys = Object.keys(Object.assign({}, cmp.first.scores, cmp.latest ? cmp.latest.scores : {})).sort();
      b6 += '<h3>' + esc(c.title) + '</h3><table class="cmp"><thead><tr><th>영역</th><th class="num">첫 기준선 ' + esc(cmp.first.at) + '</th><th class="num">' +
        (cmp.latest ? '가장 최근 ' + esc(cmp.latest.at) : '가장 최근') + '</th><th class="num">변화</th></tr></thead><tbody>' + keys.map(function (k) {
          var a = cmp.first.scores[k], b = cmp.latest ? cmp.latest.scores[k] : undefined;
          var title = ((c.parts || []).filter(function (p) { return p.id === k; })[0] || {}).title || (k === '?' ? '영역 모름' : k);
          return '<tr><td>' + esc(title) + '</td><td class="num">' + (a === undefined ? '—' : a + '점') + '</td><td class="num">' + (b === undefined ? '—' : b + '점') + '</td><td class="num">' +
            (a === undefined || b === undefined ? '—' : (b - a > 0 ? '+' : '') + (b - a) + '점') + '</td></tr>';
        }).join('') + '</tbody></table>' + (cmp.latest ? '' : '<p class="small muted">기준선을 한 번 더 재면 변화가 나옵니다.</p>');
    });
    html += section('⑥', '점검 전·후', b6 || empty('기준선 점검 기록이 없습니다. 점검 → 기준선으로 학습 전 점수를 재 두세요.'));
    return html + '<p class="small muted" id="usage-line"></p>';
  };
  V.stats.post = function (app) {
    var el = app.querySelector('#usage-line');
    if (!el || !A.store) return;
    A.store.usage().then(function (u) {
      if (u) el.textContent = '이 브라우저에 쓴 양: 약 ' + Math.round(u.chars / 1024) + 'K 글자(키 ' + u.keys + '개) - 폐쇄망 브라우저 한도는 아직 재지 않았습니다(보류 결정 8).';
    }, function () {});
  };
})(typeof self !== 'undefined' ? self : this);
