/* MyLearner web/app/views.js — 배우는 화면: 오늘·복습·강의·실습·드릴·퀴즈·점검(기준선·무작위·오답)·점검 기록·오답노트·과정·지도·용어·회고.
 * MWL web/app.js(MiddlewareLearner@e55b9c0)의 viewToday·viewLearn·viewReview·viewLab·viewDrill·viewQuiz·viewDiagnose·viewChecks·viewWrong·
 * viewMap·viewGlossary·viewJournal 을 여러 과정·사건 기록으로 옮겼다. 화면 원칙: 한 화면 기본 단추 하나, 오늘은 순서 목록, 본문 먼저,
 * 상태는 글과 기호로(색만으로 말하지 않는다). 상태를 바꾸는 일은 단추로만 — 해시 주소만으로는 기록이 바뀌지 않는다(P2 설계서 7절).
 * 입력: MyLearner.app(상태·과정) / 출력: MyLearner.views·actions(화면 글·행동) / 트리거: app/main.js 라우터
 * 문서: docs/P3_요구사항정의서_PC.md FR-305·310~319, docs/P3_설계서_PC.md 3.4·3.5·5절 */
(function (root) {
  'use strict';
  var ns = root.MyLearner = root.MyLearner || {};
  var A = ns.app, ui = ns.ui, esc = ui.esc, D = ns.dates, G = ns.grade, K = ns.course, M = ns.mastery, T = ns.stats, KU = ns.checkup, C = ns.constants;
  var V = ns.views = ns.views || {}, ACT = ns.actions = ns.actions || {};
  var WEEKDAY = '월화수목금토일';
  var own = A.own;

  function go(hash) { root.location.hash = hash; }
  function route() { if (ns.route) ns.route(); }
  function cname(cid) { var c = A.course(cid); return c ? c.title : cid; }
  function ctag(cid) { return '<span class="course-tag">' + esc(cname(cid)) + '</span>'; }
  function cardOf(ref) { var c = A.course(ref.course); return c && own(c.cards, ref.id) ? { c: c, card: c.cards[ref.id] } : null; }
  function notFound(what) { return '<h1>' + esc(what) + '을(를) 찾을 수 없습니다</h1><div class="empty"><p>주소가 틀렸거나 그 과정이 실려 있지 않습니다.</p><a class="btn" href="#/today">오늘로</a></div>'; }
  function lessonLink(c, lid) { var h = A.lessonHref(c, lid); return h ? '<a href="' + esc(h) + '">' + esc(lid) + '</a>' : esc(lid); }
  function saved(fn) { return function (ok) { if (ok) fn(); else route(); }; }
  function noCourse() {
    return '<h1>오늘의 학습</h1><div class="empty"><p>실린 과정이 없습니다. 묶음(.tgz)을 다시 풀거나, 개발 중이면 <code>python3 scripts/pack_app.py --web-data</code> 로 과정 자료를 만드세요.</p>' +
      '<a class="btn" href="#/courses">과정 화면</a></div>';
  }
  function collect(form, items, idOf) {
    var fd = new root.FormData(form), answers = {};
    items.forEach(function (it) {
      var name = idOf ? idOf(it) : it.id;
      if (it.type === 'multi') { var v = fd.getAll(name); if (v.length) answers[name] = v.join(';'); }
      else { var one = fd.get(name); if (one) answers[name] = String(one); }
    });
    return answers;
  }

  // ---------------------------------------------------------------- 오늘(FR-310)
  function doneToday() {
    var t = A.today, st = A.st, out = [];
    var sess = st.sessions.filter(function (x) { return x.date === t; })[0];
    if (sess && sess.reviewed) out.push('복습 ' + sess.reviewed + '장');
    Object.keys(st.lessons).sort().forEach(function (cid) { Object.keys(st.lessons[cid]).sort().forEach(function (id) { if (st.lessons[cid][id].done_at === t) out.push('강의 ' + id); }); });
    Object.keys(st.labs).sort().forEach(function (cid) { Object.keys(st.labs[cid]).sort().forEach(function (id) { if (st.labs[cid][id].done_at === t) out.push('실습 ' + id); }); });
    st.quizzes.forEach(function (q) { if (q.at === t) out.push('퀴즈 ' + q.id + ' ' + q.score + '점'); });
    st.drills.forEach(function (d) { if (d.at === t) out.push('드릴 ' + d.id); });
    st.checks.forEach(function (c) { if (c.at === t) out.push('점검 ' + cname(c.course)); });
    if (st.journal.some(function (j) { return j.date === t; })) out.push('회고');
    return out;
  }
  function stepHtml(st, i, next, primary) {
    var check = !st.href || st.done;
    return '<li class="step' + (next ? ' next' : '') + (check ? ' idle' : '') + (st.done ? ' done' : '') + '"><span class="step-num" aria-hidden="true">' + (check ? '✓' : i + 1) + '</span>' +
      '<div class="step-body"><div class="step-kind">' + st.kind + (next ? ' · 다음 할 일' : st.done ? ' · 오늘 함' : check ? ' · 할 것 없음' : '') + '</div>' +
      '<div class="step-title">' + (st.course ? ctag(st.course) : '') + (st.id ? '<span class="id">' + esc(st.id) + '</span>' : '') + esc(st.title) + '</div>' +
      '<div class="step-meta">' + st.meta + '</div></div>' +
      (st.href ? '<a class="btn' + (primary ? ' primary' : '') + '" href="' + esc(st.href) + '">' + st.label + '</a>' : '') + '</li>';
  }
  V.today = function () {
    if (!A.courses.length) return noCourse();
    var p = A.plan(), s = A.settings(), st = A.st, main = A.course(p.course);
    var sess = st.sessions.filter(function (x) { return x.date === A.today; })[0], spent = sess ? sess.minutes : 0;
    var goal = p.is_study_day ? s.weekday_minutes : s.weekend_minutes;
    var streak = T.streak(st.sessions.map(function (x) { return x.date; }), A.today, s.study_days);
    var html = (ns.mergeView ? ns.mergeView.reminder() : '') + '<div class="today-head"><div><p class="eyebrow">' + esc(A.today) + ' (' + WEEKDAY[D.isoWeekday(A.today) - 1] + ')' +
      (main ? ' · ' + esc(main.title) : '') + (p.week ? ' · ' + p.week + '주차' : '') + '</p><h1>' + (p.theme ? esc(p.theme) : '오늘의 학습') + '</h1></div>';
    html += '<div class="goal"><div class="goal-row"><span>오늘 학습</span><span>연속 ' + streak + '일</span></div><div class="goal-v">' + esc(spent) + '<small> / ' + esc(goal) + '분</small></div>' +
      ui.bar('오늘 학습 시간', spent, goal) + '<div class="goal-row"><span>계획 약 ' + p.total_minutes + '분</span><span>' + (p.is_study_day ? '학습일' : '비학습일') + '</span></div></div></div>';
    var baseline = !!main && (main.diagnostic || []).length > 0 && !st.checks.some(function (c) { return c.course === main.id; });
    if (baseline) {
      html += '<div class="callout"><div><h2>학습 전 기준선을 먼저 재세요</h2><p class="muted">지금 점수는 나중에 잴 수 없는 "개선 전" 숫자입니다(' + main.diagnostic.length + '문항).</p></div>' +
        '<a class="btn primary" href="#/check/' + esc(main.id) + '">기준선 시작</a></div>';
    }
    if (!p.is_study_day && !p.lesson) html += '<div class="callout warn"><p>비학습일 - 복습만 편성됩니다(설정에서 학습 요일·주말 정책을 바꿀 수 있습니다).</p></div>';
    var steps = [], n = p.reviews.length + p.new_cards.length;
    steps.push(n ? { kind: '복습', title: '만기 ' + p.reviews.length + '장 + 새 카드 ' + p.new_cards.length + '장', meta: '약 ' + (p.minutes_estimate.review || 0) + '분 · <span class="kbd">Space</span> 답 보기 · <span class="kbd">1</span>~<span class="kbd">4</span> 등급', href: '#/review', label: '복습 시작' }
      : (sess && sess.reviewed ? { kind: '복습', title: '오늘 복습을 마쳤습니다 - ' + sess.reviewed + '장', meta: '내일 만기 카드가 다시 들어옵니다' }
        : { kind: '복습', title: '오늘은 복습할 카드가 없습니다', meta: '강의를 마치면 그 강의의 카드가 대기열에 들어옵니다' }));
    if (p.lesson) {
      var lc = A.course(p.lesson.course), L = lc.lessons[p.lesson.id] || {};
      steps.push({ kind: '강의', course: lc.id, id: p.lesson.id, title: L.title || p.lesson.id, meta: (p.minutes_estimate.lesson || 0) + '분' + (L.body ? '' : ' · <span class="warn">본문 준비 중</span>'), href: '#/learn/' + lc.id + '/' + p.lesson.id, label: '강의 열기' });
    }
    if (p.lab) { var bc = A.course(p.lab.course), lab = bc.labs[p.lab.id]; steps.push({ kind: '실습', course: bc.id, id: p.lab.id, title: lab.title, meta: esc(lab.tier + ' · ' + lab.env) + ' · ' + esc(lab.minutes) + '분', href: '#/lab/' + bc.id + '/' + p.lab.id, label: '실습 열기' }); }
    if (p.quiz) steps.push({ kind: '퀴즈', course: p.quiz.course, id: p.quiz.id, title: '이 단원의 강의를 모두 마쳤습니다', meta: '합격 기준 ' + C.PASS_SCORES.quiz + '점', href: '#/quiz/' + p.quiz.course + '/' + p.quiz.id, label: '퀴즈 시작' });
    if (p.drill) { var dc = A.course(p.drill.course); steps.push({ kind: '드릴', course: dc.id, id: p.drill.id, title: dc.drills[p.drill.id].title, meta: (p.minutes_estimate.drill || 0) + '분', href: '#/drill/' + dc.id + '/' + p.drill.id, label: '드릴 시작' }); }
    var wrote = st.journal.some(function (j) { return j.date === A.today; });
    if (p.journal) steps.push(wrote ? { kind: '회고', title: '오늘 회고를 썼습니다', meta: '더 적을 것이 있으면 한 번 더 써도 됩니다', href: '#/journal', label: '회고 보기', done: true }
      : { kind: '회고', title: '한 문장 요약 · 실무 적용 · 모호한 점', meta: '5분', href: '#/journal', label: '회고 쓰기' });
    var nextIdx = -1;
    steps.forEach(function (x, i) { if (nextIdx < 0 && x.href && !x.done) nextIdx = i; });
    html += '<div class="section-h"><h2>오늘의 순서</h2><span class="small">' + steps.length + '단계 · 합계 약 ' + p.total_minutes + '분</span></div><ol class="steps">';
    steps.forEach(function (x, i) { html += stepHtml(x, i, i === nextIdx, i === nextIdx && !baseline); });
    html += '</ol>';
    if (p.is_study_day && main && !p.lesson) html += '<p>' + esc(main.title) + ' 의 계획 강의를 모두 마쳤습니다. 복습·점검·회고로 이어 가거나 과정 화면에서 주 과정을 바꾸세요.</p>';
    var done = doneToday();
    if (done.length) html += '<div class="section-h"><h2>오늘 한 것</h2></div><div class="done-list">' + done.map(function (d) { return '<span class="tag good">✓ ' + esc(d) + '</span>'; }).join('') + '</div>';
    html += '<div class="grid"><div class="card"><h3>과정</h3><p class="muted small">실린 과정 ' + A.courses.length + '개 · 주 과정 ' + esc(main ? main.title : '없음') + '</p><a class="btn" href="#/courses">과정 보기</a></div>' +
      '<div class="card"><h3>통계</h3><p class="muted small">학습량·정답률·정착률·숙련도</p><a class="btn" href="#/stats">통계 보기</a></div>' +
      '<div class="card"><h3>점검·오답노트</h3><p class="muted small">점검 ' + st.checks.length + '회</p><a class="btn" href="#/check">점검으로</a></div></div>';
    return html + '<p class="small muted">기록 저장 위치: ' + esc(A.where) + '</p>';
  };

  // ---------------------------------------------------------------- 복습(FR-311)
  V.review = function () {
    if (!A.review) {
      var p = A.plan();
      A.review = { queue: p.reviews.concat(p.new_cards).filter(cardOf), i: 0, show: false, counts: { again: 0, hard: 0, good: 0, easy: 0 }, held: 0 };
    }
    var r = A.review;
    while (r.i < r.queue.length && !cardOf(r.queue[r.i])) r.i++;
    if (!r.queue.length) { A.review = null; return '<h1>복습</h1><div class="empty"><p>지금 복습할 카드가 없습니다. 강의를 마치면 그 강의의 카드가 대기열에 들어옵니다.</p><a class="btn" href="#/today">오늘로</a></div>'; }
    if (r.i >= r.queue.length) {
      var graded = r.counts.again + r.counts.hard + r.counts.good + r.counts.easy, good = r.counts.good + r.counts.easy;
      var out = '<h1>복습 완료 <span class="small">' + graded + '장' + (r.held ? ' · 보류 ' + r.held + '장' : '') + '</span></h1><div class="grid">' +
        ui.statTile(graded ? Math.round(100 * good / graded) + '%' : '—', '정답률', 'good·easy 비율') + ui.statTile(r.counts.again, '다시(again)') +
        ui.statTile(r.counts.hard, '어려움(hard)') + ui.statTile(r.counts.good, '알겠음(good)') + ui.statTile(r.counts.easy, '쉬움(easy)') +
        '</div><div class="btnrow"><a class="btn primary" href="#/today">오늘로</a></div>';
      A.review = null;
      return out;
    }
    var ref = r.queue[r.i], x = cardOf(ref), card = x.card, c = x.c, cs = (A.st.cards[c.id] || {})[ref.id];
    var html = '<div class="review-top"><div class="row"><h1>복습</h1><span class="small muted">' + (r.i + 1) + ' / ' + r.queue.length + '</span></div>' + ui.bar('복습 진행', r.i, r.queue.length) + '</div>';
    html += '<div class="flash"><div class="lesson-meta">' + ctag(c.id) + '<span class="tag accent">' + esc(card.type || 'card') + '</span><span class="small muted">' +
      (card.lesson ? '강의 ' + lessonLink(c, card.lesson) : '') + (cs ? ' · 간격 ' + esc(cs.interval) + '일 · EF ' + esc(cs.ef) : ' · 새 카드') + '</span></div>';
    html += '<p class="q">' + ui.textHtml(card.q) + '</p>';
    if (r.show) html += '<div class="a"><p>' + ui.textHtml(card.a) + '</p>' + (card.hint ? '<p class="muted small">힌트: ' + esc(card.hint) + '</p>' : '') + '</div>';
    html += '</div>';
    if (!r.show) html += '<div class="btnrow center"><button class="btn primary" type="button" data-action="reveal">답 보기 <span class="kbd">Space</span></button></div>';
    else {
      var names = ['다시', '어려움', '알겠음', '쉬움'];
      html += '<div class="btnrow center">';
      C.GRADES.forEach(function (g, i) { html += '<button class="btn g-' + g + (g === 'good' ? ' primary' : '') + '" type="button" data-action="grade" data-g="' + g + '">' + names[i] + ' <span class="kbd">' + (i + 1) + '</span></button>'; });
      html += '</div><p class="muted small grade-help">again=내일 다시 · hard=조금만 늘림 · good=정상 간격 · easy=크게 늘림</p>';
    }
    return html + '<div class="btnrow center"><button class="btn small" type="button" data-action="hold">이 카드가 틀렸다 → 보류</button></div>' +
      '<p class="muted small">보류한 카드는 계획에서 빠집니다. 과정 → 지도에서 풀 수 있습니다(간격 반복은 틀린 답도 강화합니다).</p>';
  };
  function finishReview(r) {
    var n = r.counts.again + r.counts.hard + r.counts.good + r.counts.easy;
    if (!n) return Promise.resolve(true);
    return A.record('session', { minutes: Math.max(1, Math.ceil(n * C.SECONDS_PER_CARD / 60)), reviewed: n });
  }
  ACT.reveal = function () { if (A.review) { A.review.show = true; route(); } };
  ACT.grade = function (el) {
    var r = A.review; if (!r || !r.show) return;
    var ref = r.queue[r.i], g = el.getAttribute('data-g');
    r.counts[g] += 1; r.i += 1; r.show = false;
    A.record('review', { course: ref.course, card: ref.id, grade: g }).then(function () { return r.i >= r.queue.length ? finishReview(r) : true; }).then(route);
  };
  ACT.hold = function () {
    var r = A.review; if (!r) return;
    var ref = r.queue[r.i];
    r.i += 1; r.show = false; r.held += 1;
    A.record('card.hold', { course: ref.course, card: ref.id, on: true, why: 'wrong' }).then(function () { return r.i >= r.queue.length ? finishReview(r) : true; })
      .then(function () { ui.banner(ref.id + ' 를 보류했습니다', 'good'); route(); });
  };

  // ---------------------------------------------------------------- 강의(FR-312)
  V.learn = function (params) {
    var c = A.course(params[0]), lid = params[1];
    if (!c || !own(c.lessons, lid)) return notFound('강의 ' + (lid || ''));
    var L = c.lessons[lid], ix = K.index(c), uid = ix.unitOf(lid), pid = uid ? ix.partOf(uid) : null;
    var part = (c.parts || []).filter(function (p) { return p.id === pid; })[0], unit = uid ? ix.units[uid] : null;
    var stl = (A.st.lessons[c.id] || {})[lid], cards = ix.cardsOf(lid), labs = ix.labsOf(lid);
    var html = '<div class="reader"><article class="lesson"><p class="crumbs"><a href="#/courses">과정</a> › <a href="#/map/' + esc(c.id) + '">' + esc(c.title) + '</a>' +
      (part ? ' › <a href="#/map/' + esc(c.id) + '/' + esc(part.id) + '">' + esc(part.title) + '</a>' : '') + (unit ? ' › ' + esc(unit.id + ' ' + (unit.title || '')) : '') + '</p>';
    html += '<h1>' + esc(L.title || lid) + '</h1><div class="lesson-meta"><span class="tag">' + esc(lid) + '</span>' + (L.level ? '<span class="tag">목표 L' + esc(L.level) + '</span>' : '') +
      (L.minutes ? '<span class="tag">' + esc(L.minutes) + '분</span>' : '') + (L.confidence ? '<span class="tag ' + (L.confidence === 'verified' ? 'good' : 'warn') + '">신뢰도 ' + esc(L.confidence) + '</span>' : '') + '</div>';
    if (L.confidence && L.confidence !== 'verified') html += '<p class="small warn">본문의 ⚠️ 표식은 원문 대조 전 항목입니다.</p>';
    if ((L.sources || []).length) html += '<p class="sources">출처: ' + esc(L.sources.join('; ')) + '</p>';
    html += L.body ? A.render(L.body, c) : '<div class="callout warn"><p>이 강의의 본문은 아직 없습니다.</p></div>';
    html += '<div class="finish"><p class="small muted">연결 카드 ' + cards.length + '장' + (labs.length ? ' · 실습 ' + labs.map(function (id) { return '<a href="#/lab/' + esc(c.id) + '/' + esc(id) + '">' + esc(id) + '</a>'; }).join(', ') : '') + '</p>';
    if (stl && stl.done) html += '<p class="good">✅ ' + esc(stl.done_at) + ' 마침 (자신감 ' + esc(stl.confidence || '-') + ')</p>';
    html += '<div class="btnrow"><span class="muted small">읽었다면 자신감을 고르세요</span>';
    [[1, '1 낮음'], [2, '2'], [3, '3 보통'], [4, '4 높음']].forEach(function (x) {
      html += '<button class="btn' + (x[0] === 3 ? ' primary' : '') + '" type="button" data-action="lessonDone" data-course="' + esc(c.id) + '" data-id="' + esc(lid) + '" data-c="' + x[0] + '">' + x[1] + '</button>';
    });
    return html + '</div></div></article><aside class="toc" id="lesson-toc" aria-label="목차"><strong>목차</strong></aside></div>';
  };
  V.learn.post = function (app) {   // 목차는 그린 본문의 h2 로 만든다
    var toc = app.querySelector('#lesson-toc');
    if (!toc) return;
    var hs = app.querySelectorAll('.lesson h2');
    for (var i = 0; i < hs.length; i++) {
      var a = root.document.createElement('a');
      a.href = '#'; a.textContent = hs[i].textContent; a.setAttribute('data-i', String(i));
      a.addEventListener('click', (function (h) { return function (ev) { ev.preventDefault(); h.scrollIntoView({ block: 'start' }); }; })(hs[i]));
      toc.appendChild(a);
    }
    if (!hs.length) toc.hidden = true;
  };
  ACT.lessonDone = function (el) {
    var c = A.course(el.getAttribute('data-course')), id = el.getAttribute('data-id'), conf = Number(el.getAttribute('data-c'));
    if (!c) return;
    var mins = (c.lessons[id] || {}).minutes || 20;
    A.record('lesson', { course: c.id, lesson: id, done: true, confidence: conf })
      .then(function (ok) { return ok && A.record('session', { minutes: mins, reviewed: 0, course: c.id, lesson: id }); })
      .then(saved(function () { ui.banner(id + ' 마침 - 카드 ' + K.index(c).cardsOf(id).length + '장이 복습 대기열에 들어갑니다', 'good'); go('#/today'); }));
  };

  // ---------------------------------------------------------------- 실습(FR-313)
  V.lab = function (params) {
    var c = A.course(params[0]), id = params[1];
    if (!c || !own(c.labs, id)) return notFound('실습 ' + (id || ''));
    var lab = c.labs[id], st = (A.st.labs[c.id] || {})[id], checks = lab.checks || [];
    var html = '<article class="lesson"><p class="crumbs"><a href="#/map/' + esc(c.id) + '">' + esc(c.title) + '</a> › 실습</p><h1>' + esc(lab.title) + '</h1>';
    html += '<div class="lesson-meta"><span class="tag">' + esc(id) + '</span><span class="tag">' + esc(lab.tier) + ' · ' + esc(lab.env) + '</span><span class="tag">' + esc(lab.minutes) + '분</span>' +
      '<span class="small muted">강의 ' + (lab.lessons || []).map(function (l) { return lessonLink(c, l); }).join(', ') + '</span></div>';
    if (lab.env === 'work') html += '<p class="warn">실환경 실습입니다. 조회 명령만 실행하고, 관찰 기록에 실제 호스트명·IP·계정·고객 정보를 적지 마세요(가상 값으로).</p>';
    if (lab.env === 'docker') html += '<p class="muted">Docker 실습입니다. 실습 환경이 있는 PC 에서 진행하세요.</p>';
    html += A.render(lab.body, c) + '<h2>점검 문항</h2><form data-submit="labSubmit" data-course="' + esc(c.id) + '" data-id="' + esc(id) + '">';
    if (checks.length) {
      checks.forEach(function (k, n) {
        html += '<fieldset class="card"><legend>' + (n + 1) + '. ' + esc(k.q) + '</legend>';
        if (k.type === 'choice') (k.options || []).forEach(function (o) { html += '<label class="choice"><input type="radio" name="' + esc(k.id) + '" value="' + esc(o) + '"> ' + esc(o) + '</label>'; });
        else html += '<label class="field">답<input type="text" name="' + esc(k.id) + '" autocomplete="off"></label>';
        html += '</fieldset>';
      });
    } else html += '<p class="muted">이 실습에는 자동 채점 문항이 없습니다.</p>';
    html += '<label class="field">관찰 기록(가상 값으로 쓴 요약)<textarea name="__notes" maxlength="20000"></textarea></label>';
    html += '<button class="btn primary" type="submit">' + (checks.length ? '채점하고 마침' : '마침으로 기록') + '</button></form>';
    if (st && st.done) html += '<p class="good">✅ ' + esc(st.done_at) + ' 마침' + (st.total ? ' · 점검 ' + esc(st.score) + '/' + esc(st.total) : '') + (st.notes ? ' · 기록: ' + esc(st.notes) : '') + '</p>';
    return html + '</article>';
  };
  ACT.labSubmit = function (form) {
    var c = A.course(form.getAttribute('data-course')), id = form.getAttribute('data-id');
    if (!c) return;
    var lab = c.labs[id], fd = new root.FormData(form), checks = lab.checks || [], score = null, total = null;
    if (checks.length) { total = checks.length; score = checks.filter(function (k) { return G.checkLab(k, fd.get(k.id) || ''); }).length; }
    A.record('lab', { course: c.id, lab: id, done: true, score: score, total: total, notes: String(fd.get('__notes') || '') })
      .then(function (ok) { return ok && A.record('session', { minutes: lab.minutes || 15, reviewed: 0, course: c.id, lab: id }); })
      .then(saved(function () { ui.banner(total !== null ? '점검 문항 ' + score + '/' + total + ' - 마침 기록' : '실습 마침 기록', 'good'); route(); }));
  };

  // ---------------------------------------------------------------- 드릴(FR-314)
  V.drill = function (params) {
    var c = A.course(params[0]), id = params[1];
    if (!c || !own(c.drills, id)) return notFound('드릴 ' + (id || ''));
    var drill = c.drills[id];
    if (!A.drill || A.drill.id !== id || A.drill.course !== c.id) A.drill = { course: c.id, id: id, choices: [], current: drill.start, feedback: null, saved: false };
    var d = A.drill;
    var html = '<article class="lesson"><p class="crumbs"><a href="#/map/' + esc(c.id) + '">' + esc(c.title) + '</a> › 장애 드릴</p><h1>' + esc(drill.title) + '</h1>';
    html += '<div class="lesson-meta"><span class="tag">' + esc(id) + '</span><span class="tag">난이도 ' + esc(drill.difficulty) + '</span><span class="tag">' + esc(drill.minutes) + '분</span>' +
      '<span class="small muted">강의 ' + (drill.lessons || []).map(function (l) { return lessonLink(c, l); }).join(', ') + '</span></div>';
    html += '<div class="card">' + A.render(drill.situation, c) + '</div>';
    if (d.current) {
      var step = drill.steps[d.current];
      html += '<h2>단계 ' + (d.choices.length + 1) + '</h2>' + A.render(step.prompt, c);
      if (d.feedback) html += '<div class="card"><p><strong>피드백</strong> (' + esc(d.feedback.score) + '점): ' + esc(d.feedback.text) + '</p><button class="btn primary" type="button" data-action="drillNext">다음</button></div>';
      else step.options.forEach(function (o, i) { html += '<button class="btn option" type="button" data-action="drillChoose" data-i="' + i + '">' + (i + 1) + ') ' + esc(o.text) + '</button>'; });
    } else {
      var run = G.runDrill(drill, d.choices);
      html += '<h2>결과 ' + run.score + ' / ' + run.max + '점 (' + (run.max ? Math.round(100 * run.score / run.max) : 0) + '%)</h2><p class="muted small">경로 ' + esc(run.path.join(' → ')) + '</p>';
      html += '<h2>디브리핑</h2>' + A.render(drill.debrief, c);
      html += d.saved ? '<p class="good">✅ 저장됨</p><div class="btnrow"><a class="btn" href="#/today">오늘로</a><a class="btn" href="#/journal">회고 쓰기</a></div>'
        : '<div class="btnrow"><button class="btn primary" type="button" data-action="drillSave">결과 저장</button><button class="btn" type="button" data-action="drillRestart">다시 하기</button></div>';
    }
    return html + '</article>';
  };
  ACT.drillChoose = function (el) {
    var d = A.drill; if (!d) return;
    var step = A.course(d.course).drills[d.id].steps[d.current], i = Number(el.getAttribute('data-i')), opt = step.options[i];
    d.choices.push(i); d.feedback = { score: opt.score, text: opt.feedback, next: opt.next };
    route();
  };
  ACT.drillNext = function () { var d = A.drill; if (!d || !d.feedback) return; d.current = d.feedback.next || null; d.feedback = null; route(); };
  ACT.drillSave = function () {
    var d = A.drill; if (!d || d.saved) return;
    var drill = A.course(d.course).drills[d.id], run = G.runDrill(drill, d.choices);
    A.record('drill', { course: d.course, drill: d.id, score: run.score, max: run.max, path: run.path })
      .then(function (ok) { return ok && A.record('session', { minutes: drill.minutes || 15, reviewed: 0, course: d.course }); })
      .then(function (ok) { if (ok) d.saved = true; route(); });
  };
  ACT.drillRestart = function () { A.drill = null; route(); };

  // ---------------------------------------------------------------- 퀴즈(FR-315)
  function quizForm(items, action, attrs, intro, idOf) {
    var html = intro + '<form data-submit="' + action + '"' + attrs + '>';
    items.forEach(function (it, n) {
      var name = esc(idOf ? idOf(it) : it.id);
      html += '<fieldset class="card"><legend><strong>' + (n + 1) + '.</strong> ' + esc(it.q) + '</legend>';
      if (it.type === 'mcq') (it.options || []).forEach(function (o) { html += '<label class="choice"><input type="radio" name="' + name + '" value="' + esc(o) + '"> ' + esc(o) + '</label>'; });
      else if (it.type === 'multi') (it.options || []).forEach(function (o) { html += '<label class="choice"><input type="checkbox" name="' + name + '" value="' + esc(o) + '"> ' + esc(o) + '</label>'; });
      else if (it.type === 'order') html += '<label class="field">순서대로 세미콜론(;)으로: ' + (it.options || []).map(esc).join(' / ') + '<input type="text" name="' + name + '" autocomplete="off"></label>';
      else html += '<label class="field">답<input type="text" name="' + name + '" autocomplete="off"></label>';
      html += '</fieldset>';
    });
    return html + '<button class="btn primary" type="submit">채점</button></form>';
  }
  V.quiz = function (params) {
    var c = A.course(params[0]), id = params[1];
    if (!c || !own(c.quizzes, id)) return notFound('퀴즈 ' + (id || ''));
    var quiz = c.quizzes[id];
    if (A.lastQuiz && A.lastQuiz.id === id && A.lastQuiz.course === c.id) return quizResult(c, A.lastQuiz);
    var unit = K.index(c).units[quiz.unit];
    return quizForm(quiz.items, 'quizSubmit', ' data-course="' + esc(c.id) + '" data-id="' + esc(id) + '"',
      '<h1>' + esc(id) + ' 퀴즈 <span class="muted small">' + esc(c.title) + ' · 단원 ' + esc(unit ? unit.title : quiz.unit) + ' · ' + quiz.items.length + '문항</span></h1>');
  };
  function quizResult(c, r) {
    var pass = r.score >= C.PASS_SCORES.quiz;
    var html = '<h1>' + esc(r.id) + ' 결과 ' + r.score + '점 <span class="muted small">(' + r.correct.length + '/' + r.items.length + ' · ' + (pass ? '합격 기준 ' + C.PASS_SCORES.quiz + ' 충족' : C.PASS_SCORES.quiz + ' 미만 - 단원 L3 판정 불가') + ')</span></h1>';
    r.items.forEach(function (it) {
      var ok = r.correct.indexOf(it.id) >= 0;
      html += '<div class="card"><p>' + (ok ? '✅ 맞음' : '❌ 틀림') + ' · ' + esc(it.q) + '</p><p class="small">정답 <strong>' + esc(ui.fmtAns(it.answer)) + '</strong> · 내 답 ' + esc(r.answers[it.id] || '(없음)') + '</p>' +
        '<p class="small muted">' + esc(it.explain || '') + (it.lesson ? ' · 강의 ' + lessonLink(c, it.lesson) : '') + '</p></div>';
    });
    A.lastQuiz = null;
    return html + '<div class="btnrow"><a class="btn primary" href="#/today">오늘로</a><a class="btn" href="#/wrong">오답노트</a></div>';
  }
  ACT.quizSubmit = function (form) {
    var c = A.course(form.getAttribute('data-course')), id = form.getAttribute('data-id');
    if (!c) return;
    var quiz = c.quizzes[id], answers = collect(form, quiz.items), g = G.gradeItems(quiz.items, answers);
    A.lastQuiz = { course: c.id, id: id, items: quiz.items, answers: answers, score: g.score, correct: g.correct };
    A.record('quiz', { course: c.id, quiz: id, score: g.score, answers: answers })
      .then(function (ok) { return ok && A.record('session', { minutes: 10, reviewed: 0, course: c.id }); }).then(route);
  };

  // ---------------------------------------------------------------- 점검·기록·오답노트(FR-316)
  function checkable() { return A.courses.filter(function (c) { return Object.keys(KU.bank(c)).length > 0; }); }
  function checkItems(c, ids) { var b = KU.bank(c); return ids.map(function (id) { return Object.assign({}, b[id], { _id: id }); }); }
  function itemName(it) { return it._id; }
  function pickRow(list, base, cur) {
    return '<div class="pick">' + list.map(function (c) { return '<a class="btn small' + (c.id === cur ? ' primary' : '') + '" href="' + base + esc(c.id) + '">' + esc(c.title) + '</a>'; }).join('') + '</div>';
  }
  V.check = function (params) {
    var list = checkable();
    if (!list.length) return '<h1>점검</h1><div class="empty"><p>점검 문항이나 퀴즈가 있는 과정이 없습니다.</p><a class="btn" href="#/courses">과정 보기</a></div>';
    var c = A.course(params[0]) || (list.length === 1 ? list[0] : null);
    if (c && params[1] === 'run' && A.check && A.check.course === c.id) {
      return quizForm(checkItems(c, A.check.ids), 'checkSubmit', ' data-course="' + esc(c.id) + '"',
        '<h1>' + esc(modeLabel(A.check.mode)) + ' <span class="muted small">' + esc(c.title) + ' · ' + A.check.ids.length + '문항 · 모르면 비워 두세요</span></h1>', itemName);
    }
    var html = '<h1>점검</h1>' + pickRow(list, '#/check/', c ? c.id : null);
    if (!c) return html + '<p class="muted">점검할 과정을 고르세요.</p>';
    var bank = KU.bank(c), notes = KU.wrongNotes(c, A.st, bank), open = notes.filter(function (n) { return !n.resolved; }).length;
    if ((c.diagnostic || []).length) html += '<div class="card"><h2>기준선 - 고정 ' + c.diagnostic.length + '문항</h2><p class="muted">늘 같은 문항입니다. 학습 전과 몇 달 뒤를 같은 잣대로 비교합니다.</p>' +
      '<button class="btn primary" type="button" data-action="checkStart" data-course="' + esc(c.id) + '" data-mode="baseline">기준선 시작</button></div>';
    html += '<div class="card"><h2>무작위 점검</h2><p class="muted">점검 문항과 퀴즈 전체(' + Object.keys(bank).length + '문항)에서 영역마다 뽑습니다. 할 때마다 다릅니다.</p><form data-submit="checkRandom" data-course="' + esc(c.id) + '"><fieldset class="btnrow"><legend class="small muted">영역</legend>';
    (c.parts || []).forEach(function (p) { html += '<label class="choice"><input type="checkbox" name="part" value="' + esc(p.id) + '" checked> ' + esc(p.title || p.id) + '</label>'; });
    html += '</fieldset><label>영역별 문항 수 <input type="number" name="per" min="1" max="20" value="5" class="inline-num"></label> <button class="btn" type="submit">무작위 점검 시작</button></form></div>';
    html += '<div class="card"><h2>오답 다시 풀기</h2><p class="muted">아직 못 고친 오답 ' + open + '문항</p>' + (open ? '<button class="btn" type="button" data-action="checkStart" data-course="' + esc(c.id) + '" data-mode="retry">다시 풀기</button>' : '<p class="small">다시 풀 오답이 없습니다.</p>') + '</div>';
    return html + '<div class="btnrow"><a class="btn" href="#/checks">점검 기록</a><a class="btn" href="#/wrong">오답노트</a></div>';
  };
  function modeLabel(m) { return { baseline: '기준선', random: '무작위 점검', retry: '오답 다시 풀기' }[m || 'baseline'] || m; }
  function startCheck(c, mode, parts, per) {
    var bank = KU.bank(c), ids;
    if (mode === 'baseline') ids = KU.baselineIds(c);
    else if (mode === 'random') ids = KU.sampleIds(c, bank, per, parts, Math.random);
    else ids = KU.retryIds(KU.wrongNotes(c, A.st, bank), 20);
    if (!ids.length) { ui.banner(mode === 'retry' ? '다시 풀 오답이 없습니다' : '출제할 문항이 없습니다', 'bad'); return; }
    A.check = { course: c.id, mode: mode, ids: ids };
    var h = '#/check/' + c.id + '/run';
    if (root.location.hash === h) route(); else go(h);
  }
  ACT.checkStart = function (el) { var c = A.course(el.getAttribute('data-course')); if (c) startCheck(c, el.getAttribute('data-mode'), null, null); };
  ACT.checkRandom = function (form) {
    var c = A.course(form.getAttribute('data-course')), fd = new root.FormData(form), parts = fd.getAll('part'), per = Math.max(1, Math.min(20, Number(fd.get('per')) || 5));
    if (!c) return;
    if (!parts.length) { ui.banner('영역을 하나 이상 고르세요', 'bad'); return; }
    startCheck(c, 'random', parts.map(String), per);
  };
  ACT.checkSubmit = function (form) {
    var k = A.check, c = k && A.course(k.course);
    if (!c) return;
    var bank = KU.bank(c), items = checkItems(c, k.ids), r = KU.gradeCheck(c, bank, k.ids, collect(form, items, itemName));
    A.check = null;
    A.record('check', { course: c.id, mode: k.mode, scores: r.scores, total: r.total, items: r.items })
      .then(saved(function () { go('#/checks/' + A.st.checks.length); }));
  };
  V.checks = function (params) {
    var list = A.st.checks;
    if (!list.length) return '<h1>점검 기록</h1><div class="empty"><p>아직 기록이 없습니다.</p><a class="btn primary" href="#/check">점검 시작</a></div>';
    if (params[0]) {
      var n = Number(params[0]), d = list[n - 1];
      if (!d) return notFound('점검 기록 #' + params[0]);
      var c = A.course(d.course), rows = c ? KU.detail(d, KU.bank(c)) : [], right = rows.filter(function (r) { return r.correct; }).length;
      var html = '<h1>점검 #' + n + ' <span class="muted small">' + esc(cname(d.course)) + ' · ' + esc(d.at) + ' · ' + esc(modeLabel(d.mode)) + (d.total == null ? '' : ' · 총점 ' + esc(d.total) + '점') + '</span></h1>';
      html += '<table><thead><tr><th>영역</th><th>점수</th></tr></thead><tbody>';
      Object.keys(d.scores).sort().forEach(function (p) { html += '<tr><td>' + esc(partTitle(c, p)) + '</td><td>' + esc(d.scores[p]) + '점</td></tr>'; });
      html += '</tbody></table>';
      html += rows.length ? '<h2>문항별 (' + right + '/' + rows.length + ')</h2>' + rows.map(function (r) {
        return '<div class="card"><p>' + (r.correct ? '✅ 맞음' : '❌ 틀림') + ' · ' + esc(r.q) + '</p>' + (r.correct ? '' : '<p class="small">내 답 ' + esc(ui.fmtAns(r.answer)) + '</p>') +
          '<p class="small">정답 <strong>' + esc(ui.fmtAns(r.expected)) + '</strong></p><p class="small muted">' + esc(r.explain) + (r.lesson ? ' · 강의 ' + lessonLink(c, r.lesson) : '') + '</p></div>';
      }).join('') : '<p class="muted">문항별 기록이 없습니다(그 과정이 없거나 옛 형식).</p>';
      return html + '<div class="btnrow"><a class="btn" href="#/checks">목록</a><a class="btn" href="#/wrong">오답노트</a><a class="btn" href="#/check/' + esc(d.course) + '">다시 점검</a></div>';
    }
    var t = '<h1>점검 기록</h1><table><thead><tr><th>#</th><th>날짜</th><th>과정</th><th>방식</th><th>문항</th><th>총점</th><th><span class="small">보기</span></th></tr></thead><tbody>';
    list.forEach(function (d, i) {
      t += '<tr><td>' + (i + 1) + '</td><td>' + esc(d.at) + '</td><td>' + esc(cname(d.course)) + '</td><td>' + esc(modeLabel(d.mode)) + '</td><td>' + esc((d.items || []).length || '—') + '</td><td>' +
        (d.total == null ? '—' : esc(d.total) + '점') + '</td><td><a href="#/checks/' + (i + 1) + '">#' + (i + 1) + ' 보기</a></td></tr>';
    });
    return t + '</tbody></table><div class="btnrow"><a class="btn primary" href="#/check">점검 시작</a><a class="btn" href="#/wrong">오답노트</a></div>';
  };
  function partTitle(c, pid) { var p = c ? (c.parts || []).filter(function (x) { return x.id === pid; })[0] : null; return p ? p.title || pid : (pid === '?' ? '영역 모름' : pid); }
  V.wrong = function () {
    var html = '<h1>오답노트</h1>', any = false, openAll = 0;
    html += '<div class="btnrow"><button class="btn" type="button" data-action="wrongToggle">' + (A.wrongAll ? '못 고친 것만 보기' : '고친 것까지 보기') + '</button></div>';
    checkable().forEach(function (c) {
      var bank = KU.bank(c), notes = KU.wrongNotes(c, A.st, bank), open = notes.filter(function (n) { return !n.resolved; }).length;
      openAll += open;
      var shown = notes.filter(function (n) { return A.wrongAll || !n.resolved; });
      if (!shown.length) return;
      any = true;
      html += '<h2>' + esc(c.title) + ' <span class="muted small">못 고친 ' + open + ' · 고친 ' + (notes.length - open) + '</span></h2>' +
        (open ? '<div class="btnrow"><button class="btn primary" type="button" data-action="checkStart" data-course="' + esc(c.id) + '" data-mode="retry">못 고친 것 다시 풀기</button></div>' : '');
      shown.forEach(function (n) {
        var it = bank[n.id];
        html += '<div class="card"><p>' + (n.resolved ? '✅ 고침' : '❌ 틀림 ' + n.wrong + '/' + n.attempts + '회') + ' · 마지막 오답 ' + esc(n.last_wrong_at) + '</p><p><strong>' + esc(it.q) + '</strong></p>' +
          '<p class="small">내 답 ' + esc(ui.fmtAns(n.last_answer)) + '</p><p class="small">정답 <strong>' + esc(ui.fmtAns(it.answer)) + '</strong></p><p class="small muted">' + esc(it.explain || '') + (it.lesson ? ' · 강의 ' + lessonLink(c, it.lesson) : '') + '</p></div>';
      });
    });
    return any ? html : html + '<div class="empty"><p>보여 줄 오답이 없습니다' + (openAll ? '' : ' - 퀴즈·점검에서 틀린 문항이 여기에 모입니다') + '.</p><a class="btn" href="#/check">점검으로</a></div>';
  };
  ACT.wrongToggle = function () { A.wrongAll = !A.wrongAll; route(); };

  // ---------------------------------------------------------------- 과정·지도(FR-317)
  V.courses = function () {
    var s = A.settings(), main = ns.plan.mainCourse(A.courses, s);
    var html = '<h1>과정 <span class="small">' + A.courses.length + '개</span></h1>';
    A.problems.forEach(function (p) { html += '<div class="err-box"><strong>싣지 못한 과정(' + esc(p.source) + ' · ' + esc(p.id) + ')</strong><pre>' + esc(p.why.join('\n')) + '</pre></div>'; });
    if (!A.courses.length) return html + '<div class="empty"><p>실린 과정이 없습니다.</p></div>';
    var prog = T.progress(A.courses, A.st), cards = T.cardStates;
    html += '<table><thead><tr><th>과정</th><th>강의</th><th>카드(본 것/전체)</th><th>출처</th><th>주 과정</th></tr></thead><tbody>';
    A.courses.forEach(function (c) {
      var cs = cards([c], A.st), seen = Object.keys(A.st.cards[c.id] || {}).filter(function (k) { return own(c.cards, k); }).length;
      var pr = prog[c.id];
      html += '<tr><td><a href="#/map/' + esc(c.id) + '"><strong>' + esc(c.title) + '</strong></a><br><span class="small muted">' + esc(c.id) + (c.kind === 'notes' ? ' · 메모' : '') + (c.readonly ? ' · 읽기 전용' : '') + '</span></td>' +
        '<td>' + (pr ? pr.lessons_done + ' / ' + pr.lessons_total : Object.keys(c.lessons || {}).length + '개') + '</td><td>' + esc(seen) + ' / ' + esc(cs.total) + '</td>' +
        '<td class="small">' + esc((c.origin && c.origin.ref) || '') + '</td><td>' + (c.kind === 'notes' ? '—' : (main && main.id === c.id ? '<strong>✓ 주 과정</strong>' :
          '<button class="btn small" type="button" data-action="setMain" data-course="' + esc(c.id) + '">주 과정으로</button>')) + '</td></tr>';
    });
    html += '</tbody></table><p class="small muted">주 과정에서 새 강의를 하루 1과 냅니다. 복습·새 카드는 모든 과정에서 합칩니다.</p>';
    return html + '<div class="btnrow"><a class="btn" href="#/import/mwl">MWL 진도 들여오기</a><a class="btn" href="#/stats">통계</a></div>';
  };
  ACT.setMain = function (el) {
    var id = el.getAttribute('data-course');
    if (!A.course(id)) return;
    A.record('setting', { key: 'main_course', value: id }).then(saved(function () { ui.banner(cname(id) + ' 을(를) 주 과정으로 정했습니다', 'good'); route(); }));
  };
  V.map = function (params) {
    var c = A.course(params[0]);
    if (!c) return notFound('과정 ' + (params[0] || ''));
    var only = params[1] || null, ix = K.index(c), st = A.st, lessons = st.lessons[c.id] || {};
    var html = '<h1>' + esc(c.title) + ' <span class="small">지도</span></h1><div class="legend"><span>● 마침</span><span>○ 학습 가능</span><span>· 본문 없음</span><span>숙련도 ' +
      Object.keys(C.MASTERY_LEVELS).map(function (k) { return 'L' + k + '=' + C.MASTERY_LEVELS[k]; }).join(' ') + '</span></div>';
    if ((c.parts || []).length > 1) html += '<div class="btnrow">' + c.parts.map(function (p) { return '<a class="btn small' + (only === p.id ? ' primary' : '') + '" href="#/map/' + esc(c.id) + '/' + esc(p.id) + '">' + esc(p.title || p.id) + '</a>'; }).join('') +
      '<a class="btn small' + (only ? '' : ' primary') + '" href="#/map/' + esc(c.id) + '">전체</a></div>';
    (c.parts || []).forEach(function (p) {
      if (only && p.id !== only) return;
      var total = 0, doneN = 0;
      (p.units || []).forEach(function (u) { (u.lessons || []).forEach(function (l) { total++; if (lessons[l] && lessons[l].done) doneN++; }); });
      html += '<section class="domain"><div class="domain-h"><h2>' + esc(p.title || p.id) + '</h2><span class="small muted">강의 ' + doneN + ' / ' + total + ' 마침</span></div>' + (p.summary ? '<p class="muted small">' + esc(p.summary) + '</p>' : '');
      html += '<table><thead><tr><th>단원</th><th>숙련도</th><th>강의</th></tr></thead><tbody>';
      (p.units || []).forEach(function (u) {
        var lvl = M.unit(c, st, u.id), seg = '';
        for (var k = 1; k <= 5; k++) seg += '<i' + (k <= lvl ? ' class="on"' : '') + '></i>';
        html += '<tr><td><strong>' + esc(u.id) + '</strong> ' + esc(u.title || '') + '</td><td class="nowrap" title="L' + lvl + ' ' + esc(C.MASTERY_LEVELS[lvl] || '') + '"><span class="meter" aria-hidden="true">' + seg + '</span>L' + lvl + ' ' + esc(C.MASTERY_LEVELS[lvl] || '') + '</td><td>';
        (u.lessons || []).forEach(function (l) {
          var done = !!(lessons[l] && lessons[l].done), L = c.lessons[l] || {}, has = !!L.body;
          html += '<a class="chip' + (done ? ' done' : '') + (has ? '' : ' nobody') + '" href="#/learn/' + esc(c.id) + '/' + esc(l) + '" title="' + esc(L.title || l) + '">' + (done ? '●' : has ? '○' : '·') + ' ' + esc(l) + '</a>';
        });
        html += '</td></tr>';
      });
      html += '</tbody></table></section>';
    });
    var held = Object.keys(st.held[c.id] || {}).filter(function (k) { return own(c.cards, k); }).sort();
    html += '<h2>보류한 카드 <span class="small muted">' + held.length + '장</span></h2>';
    if (!held.length) html += '<p class="muted small">보류한 카드가 없습니다. 복습 중 "이 카드가 틀렸다 → 보류"를 누르면 여기에 모입니다.</p>';
    else html += '<table><thead><tr><th>카드</th><th>질문</th><th><span class="small">풀기</span></th></tr></thead><tbody>' + held.map(function (k) {
      return '<tr><td>' + esc(k) + '</td><td>' + esc(c.cards[k].q) + '</td><td><button class="btn small" type="button" data-action="unhold" data-course="' + esc(c.id) + '" data-card="' + esc(k) + '">보류 풀기</button></td></tr>';
    }).join('') + '</tbody></table>';
    return html;
  };
  ACT.unhold = function (el) {
    var cid = el.getAttribute('data-course'), card = el.getAttribute('data-card');
    if (!A.course(cid)) return;
    A.record('card.hold', { course: cid, card: card, on: false }).then(saved(function () { ui.banner(card + ' 보류를 풀었습니다', 'good'); route(); }));
  };

  // ---------------------------------------------------------------- 용어(FR-318)·회고(FR-319)
  V.glossary = function (params) {
    var list = A.courses.filter(function (c) { return (c.glossary || []).length; });
    if (!list.length) return '<h1>용어</h1><div class="empty"><p>용어집이 있는 과정이 없습니다.</p></div>';
    var c = A.course(params[0]) || list[0], q = (A.glossaryQuery || '').toLowerCase();
    var rows = c.glossary.filter(function (t) { return !q || ((t.term || '') + ' ' + (t.en || '') + ' ' + (t.short || '')).toLowerCase().indexOf(q) >= 0; });
    var html = '<h1>용어 <span class="small">' + rows.length + ' / ' + c.glossary.length + '</span></h1>' + (list.length > 1 ? pickRow(list, '#/glossary/', c.id) : '');
    html += '<form data-submit="glossarySearch" data-course="' + esc(c.id) + '" role="search"><label class="field">검색(한글·영문)<input type="text" name="q" value="' + esc(A.glossaryQuery || '') + '"></label></form>';
    html += '<table><thead><tr><th>용어</th><th>영문</th><th>뜻</th><th>강의</th></tr></thead><tbody>';
    rows.forEach(function (t) { html += '<tr><td><strong>' + esc(t.term) + '</strong></td><td>' + esc(t.en || '') + '</td><td>' + esc(t.short || '') + '</td><td>' + (t.lesson ? lessonLink(c, t.lesson) : '') + '</td></tr>'; });
    return html + '</tbody></table>';
  };
  ACT.glossarySearch = function (form) { A.glossaryQuery = String(new root.FormData(form).get('q') || ''); route(); };
  V.journal = function () {
    var html = '<h1>회고</h1><form data-submit="journalSubmit">' +
      '<label class="field">오늘 배운 것 한 문장<input type="text" name="summary"></label>' +
      '<label class="field">실무에서 어디에 적용?<input type="text" name="apply"></label>' +
      '<label class="field">아직 모호한 점<span>다음에 다시 물어볼 항목이 됩니다.</span><input type="text" name="unclear"></label>' +
      '<label class="field">가르치기 노트(선택)<span>후임에게 설명하듯 한 단원을 정리하면, 본문에 적은 단원 ID(예: A5)가 주 과정의 그 단원 L5 판정에 반영됩니다.</span><textarea name="teach" maxlength="20000"></textarea></label>' +
      '<button class="btn primary" type="submit">저장</button></form>';
    var list = A.st.journal.slice(-15).reverse();
    if (list.length) {
      html += '<h2>최근 회고</h2><table><thead><tr><th>날짜</th><th>요약</th><th>적용</th><th>모호</th><th>가르치기</th></tr></thead><tbody>';
      list.forEach(function (e) { html += '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.summary) + '</td><td>' + esc(e.apply) + '</td><td>' + esc(e.unclear) + '</td><td>' + esc((e.teach || '').slice(0, 80)) + '</td></tr>'; });
      html += '</tbody></table>';
    }
    return html;
  };
  ACT.journalSubmit = function (form) {
    var fd = new root.FormData(form), main = ns.plan.mainCourse(A.courses, A.settings());
    var f = { summary: String(fd.get('summary') || ''), apply: String(fd.get('apply') || ''), unclear: String(fd.get('unclear') || ''), teach: String(fd.get('teach') || '') };
    if (!f.summary.trim() && !f.apply.trim() && !f.unclear.trim() && !f.teach.trim()) { ui.banner('적은 것이 없습니다', 'bad'); return; }
    A.record('journal', Object.assign({ course: main ? main.id : null }, f))
      .then(function (ok) { return ok && A.record('session', { minutes: 5, reviewed: 0 }); })
      .then(saved(function () { ui.banner('회고 저장', 'good'); route(); }));
  };
})(typeof self !== 'undefined' ? self : this);
