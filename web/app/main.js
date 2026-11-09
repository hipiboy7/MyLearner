/* MyLearner web/app/main.js — 해시 라우터·행동 묶기·키보드·시작. MWL web/app.js(MiddlewareLearner@e55b9c0)의 route·bind·keydown·init 을 옮겼다.
 * 화면을 그리다 오류가 나면 오류 화면을 보이고 앱은 계속 돈다(FR-305). 읽기 전용 탭이면 맨 위에 띠를 둔다(FR-325).
 * 그린 뒤: data-pct 폭 넣기(CSP — 인라인 style 없이), 넓은 표 감싸기, 화면별 post(목차·비동기 칸), 다 그리면 body[data-ready="1"](스모크가 기다린다).
 * 입력: 주소의 해시·클릭·키 / 출력: #app 의 화면 / 트리거: 문서를 열 때
 * 문서: docs/P3_요구사항정의서_PC.md FR-301·305·306·311·325, docs/P3_설계서_PC.md 3.4절 */
(function (root) {
  'use strict';
  var ns = root.MyLearner = root.MyLearner || {};
  var A = ns.app, ui = ns.ui, esc = ui.esc, V = ns.views, ACT = ns.actions, doc = root.document;
  var NAV = { today: 'today', review: 'review', learn: 'today', lab: 'today', drill: 'today', quiz: 'today', check: 'check', checks: 'check', wrong: 'wrong',
    stats: 'stats', journal: 'journal', courses: 'courses', map: 'courses', glossary: 'glossary', settings: 'settings', 'import': 'settings' };

  function parts() {
    return root.location.hash.replace(/^#\/?/, '').split('/').map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
  }
  function roBand() {
    if (A.writer === 'mine') return '';
    return '<div class="ro-band" role="alert"><span>다른 탭이 기록을 쓰고 있어 이 탭은 읽기만 합니다' + (A.pending.length ? ' - 저장 못 한 기록 ' + A.pending.length + '건' : '') + '.</span>' +
      '<button class="btn small" type="button" data-action="takeover">이 탭에서 쓰기</button></div>';
  }
  function route() {
    var app = doc.getElementById('app');
    if (!A.ready) return;
    var p = parts(), name = p[0] || 'today', view = Object.prototype.hasOwnProperty.call(V, name) ? V[name] : V.today;
    if (name !== 'review') A.review = null;
    var links = doc.querySelectorAll('.nav a');
    for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', links[i].getAttribute('data-route') === (NAV[name] || 'today'));
    try {
      app.innerHTML = roBand() + view(p.slice(1));
      bind(app);
      if (view.post) view.post(app);
    } catch (e) {
      app.innerHTML = '<h1>화면 오류</h1><div class="err-box"><p>이 화면을 그리지 못했습니다. 기록은 그대로입니다.</p><pre>' + esc(e && (e.stack || e.message)) + '</pre></div><a class="btn" href="#/today">오늘로</a>';
    }
    navCounts();
    doc.title = 'MyLearner — ' + ((app.querySelector('h1') || {}).textContent || '오늘 학습');
    root.scrollTo(0, 0);
    if (!root.__readyAt) root.__readyAt = root.performance.now();   // 첫 화면까지 걸린 시간(스모크가 잰다 — NFR-302)
    doc.body.setAttribute('data-ready', '1');
  }
  ns.route = route;
  function navCounts() {
    var due = doc.getElementById('nav-due'), wrong = doc.getElementById('nav-wrong');
    try {
      var p = A.plan(), n = p.reviews.length + p.new_cards.length;
      if (due) due.textContent = n ? String(n) : '';
      var open = 0;
      A.courses.forEach(function (c) { var b = ns.checkup.bank(c); if (Object.keys(b).length) open += ns.checkup.wrongNotes(c, A.st, b).filter(function (x) { return !x.resolved; }).length; });
      if (wrong) wrong.textContent = open ? String(open) : '';
    } catch (e) { if (due) due.textContent = ''; if (wrong) wrong.textContent = ''; }
  }
  function bind(app) {
    var els = app.querySelectorAll('[data-action]');
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        el.addEventListener('click', function (ev) {
          var fn = ACT[el.getAttribute('data-action')];
          if (fn) { ev.preventDefault(); fn(el, ev); }
        });
      })(els[i]);
    }
    var forms = app.querySelectorAll('form[data-submit]');
    for (var j = 0; j < forms.length; j++) {
      (function (f) {
        f.addEventListener('submit', function (ev) { ev.preventDefault(); var fn = ACT[f.getAttribute('data-submit')]; if (fn) fn(f, ev); });
        if (f.getAttribute('data-live')) f.addEventListener('change', function (ev) { ACT[f.getAttribute('data-submit')](f, ev); });
      })(forms[j]);
    }
    ui.applyPct(app);
    var ts = app.querySelectorAll('.lesson table');   // 넓은 표가 목차 위로 넘치지 않게 가로 스크롤 상자로(MWL T-024)
    for (var k = 0; k < ts.length; k++) {
      if (ts[k].parentNode.className === 'table-wrap') continue;
      var w = doc.createElement('div'); w.className = 'table-wrap'; ts[k].parentNode.insertBefore(w, ts[k]); w.appendChild(ts[k]);
    }
  }
  ACT.takeover = function () { A.takeover().then(function () { ui.banner('이 탭에서 기록을 씁니다', 'good'); route(); }); };

  doc.addEventListener('keydown', function (ev) {
    if (root.location.hash.indexOf('#/review') !== 0 || !A.review) return;
    if (ev.target && /INPUT|TEXTAREA|SELECT|BUTTON/.test(ev.target.tagName) && !(ev.code === 'Space' && ev.target.tagName === 'BUTTON')) return;
    if (ev.code === 'Space' || ev.key === ' ') { if (!A.review.show) { ev.preventDefault(); ACT.reveal(); } }
    else if (A.review.show && ['1', '2', '3', '4'].indexOf(ev.key) >= 0) {
      var b = doc.querySelector('[data-action="grade"][data-g="' + ['again', 'hard', 'good', 'easy'][Number(ev.key) - 1] + '"]');
      if (b) ACT.grade(b);
    }
  });
  // 통계 차트는 그릴 때 화면 폭을 본다(좁으면 글자를 키운다) — 창 폭이 600px 을 넘나들면 통계 화면만 다시 그린다(입력 칸이 있는 화면은 건드리지 않는다)
  var wasNarrow = (root.innerWidth || 1280) < 600, resizeTimer = null;
  root.addEventListener('resize', function () {
    if (resizeTimer) root.clearTimeout(resizeTimer);
    resizeTimer = root.setTimeout(function () {
      var now = (root.innerWidth || 1280) < 600;
      if (now !== wasNarrow) { wasNarrow = now; if ((root.location.hash || '').indexOf('#/stats') === 0) route(); }
    }, 120);
  });
  doc.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t && t.id === 'mwl-file' && t.files && t.files[0] && ns.importFile) ns.importFile(t.files[0]);
  });

  function init() {
    ui.applyUi(ui.uiPrefs());
    var tb = doc.getElementById('theme-btn');
    if (tb) tb.addEventListener('click', function () {
      var u = ui.uiPrefs(); u.theme = ui.THEME_NEXT[u.theme || ''];
      ui.saveUi(u);
      if ((root.location.hash || '').indexOf('#/settings') === 0) route();
    });
    var eb = doc.getElementById('edition-badge');
    if (eb) eb.textContent = A.cfg.label || '';
    A.boot().then(function () {
      var mb = doc.getElementById('mode-badge');
      mb.textContent = A.store.kind === 'server' ? '서버 모드' : '브라우저 모드';
      mb.title = '기록 저장 위치: ' + A.where;
      doc.getElementById('foot-info').textContent = 'MyLearner ' + (A.cfg.label || '') + ' · 과정 ' + A.courses.length + '개 · ' + (A.store.kind === 'server' ? '서버 저장' : '브라우저 저장');
      if (A.problems.length) ui.banner('싣지 못한 과정이 ' + A.problems.length + '개 있습니다 - 과정 화면을 보세요', 'bad');
      root.addEventListener('hashchange', route);
      if (!root.location.hash) root.location.hash = '#/today'; else route();
    }).catch(function (e) {
      A.error = e;
      doc.getElementById('app').innerHTML = '<h1>시작하지 못했습니다</h1><div class="err-box"><pre>' + esc(e && (e.message || e)) + '</pre></div>' +
        '<p>저장소를 열 수 없거나 기록 파일을 읽지 못했습니다. 서버 모드라면 서버 창의 메시지를, 더블클릭으로 열었다면 브라우저 설정의 저장소 허용을 확인하세요.</p>';
      doc.body.setAttribute('data-ready', '1');
    });
  }
  init();
})(typeof self !== 'undefined' ? self : this);
