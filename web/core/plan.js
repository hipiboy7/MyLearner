/* MyLearner web/core/plan.js — 하루 계획(여러 과정). MWL web/engine.js(MiddlewareLearner@e55b9c0) buildDailyPlan 을 과정 여러 개로 넓혔다.
 * 규칙(인터뷰 1번 A): 복습·새 카드는 모든 과정을 합쳐 상한 하나, 새 강의·실습·드릴·주간 계획은 주 과정 하나에서. 과정이 하나면 MWL 과 같다.
 * 입력: 과정 목록(앞이 우선)·replay 상태·설정·오늘·{docker} / 출력: MyLearner.plan.build / 트리거: (Phase 3) '오늘' 화면
 * 문서: docs/P2_요구사항정의서_Core.md FR-240·241, docs/P2_설계서_Core.md 3.5절. 골든: tests/unit/js/golden.test.js */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.plan = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants'), D = dep('dates'), S = dep('srs'), K = dep('course');

  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function sub(map, key) { return (map && map[key]) || {}; }
  function isDone(st, cid, lid) { var l = sub(st.lessons, cid)[lid]; return !!l && l.done === true; }
  function held(st, cid, card) { return own(sub(st.held, cid), card); }
  function seen(st, cid, card) { return own(sub(st.cards, cid), card); }
  function variantOf(settings, c) { return (settings.plan_variants || {})[c.id]; }
  function mainCourse(courses, settings) {
    var regular = courses.filter(function (c) { return c.kind !== 'notes'; });
    return regular.filter(function (c) { return c.id === settings.main_course; })[0] || regular[0] || null;
  }

  function resolvePrereqs(c, ix, st, lid, visiting) {
    visiting[lid] = true;
    var pres = (c.lessons[lid] && c.lessons[lid].prereqs) || [];
    for (var i = 0; i < pres.length; i++) {
      var p = pres[i];
      if (!isDone(st, c.id, p) && !visiting[p] && ix.unitOf(p)) return resolvePrereqs(c, ix, st, p, visiting);
    }
    return lid;
  }
  function nextLesson(c, st, variant) {
    var ix = K.index(c), seq = ix.sequence(variant);
    for (var i = 0; i < seq.length; i++) { if (isDone(st, c.id, seq[i])) continue; return resolvePrereqs(c, ix, st, seq[i], {}); }
    return null;
  }
  function pickLab(c, st, lesson, docker) {
    if (!lesson) return null;
    var labs = sub(st.labs, c.id);
    var undone = K.index(c).labsOf(lesson).filter(function (id) { return !labs[id] || labs[id].done !== true; });
    if (!undone.length) return null;
    if (!docker) { var nd = undone.filter(function (id) { return c.labs[id].env !== 'docker'; }); if (nd.length) return nd[0]; }
    return undone[0];
  }
  function pickDrill(c, st, variant, currentWeek) {
    var plan = K.index(c).planOf(variant);
    if (!plan) return null;
    var done = {};
    st.drills.forEach(function (d) { if (d.course === c.id) done[d.id] = true; });
    for (var i = 0; i < plan.weeks.length; i++) {
      var w = plan.weeks[i];
      if (currentWeek !== null && currentWeek !== undefined && w.week > currentWeek) break;
      if (w.drill && own(c.drills, w.drill) && !done[w.drill]) return w.drill;
    }
    return null;
  }
  function pickQuiz(c, st) {
    var ix = K.index(c), tried = {};
    st.quizzes.forEach(function (q) { if (q.course === c.id) tried[q.id] = true; });
    for (var i = 0; i < ix.unitIds.length; i++) {
      var uid = ix.unitIds[i], qs = ix.quizzesOfUnit(uid), lessons = ix.units[uid].lessons || [];
      for (var j = 0; j < qs.length; j++) {
        if (tried[qs[j]]) continue;
        if (lessons.length && lessons.every(function (l) { return isDone(st, c.id, l); })) return qs[j];
      }
    }
    return null;
  }
  function dueCards(courses, st, today) {
    var out = [];
    courses.forEach(function (c) {
      var cards = sub(st.cards, c.id);
      Object.keys(cards).forEach(function (cid) {
        if (own(c.cards, cid) && !held(st, c.id, cid) && S.isDue(cards[cid], today)) out.push({ course: c.id, id: cid, due: cards[cid].due });
      });
    });
    return out.sort(function (a, b) { return cmp(a.due, b.due) || cmp(a.course, b.course) || cmp(a.id, b.id); })
      .map(function (x) { return { course: x.course, id: x.id }; });
  }
  function newCards(courses, st, settings, limit) {
    var out = [];
    function take(cid, card) {
      if (out.length >= limit || seen(st, cid, card) || held(st, cid, card)) return;
      out.push({ course: cid, id: card });
    }
    courses.filter(function (c) { return c.kind === 'notes'; }).forEach(function (c) {   // 사용자가 방금 적은 것이 먼저(MWL 내 지식)
      var ix = K.index(c);
      Object.keys(c.lessons || {}).sort(function (a, b) { return cmp(c.lessons[a].created || '', c.lessons[b].created || '') || cmp(a, b); })
        .forEach(function (lid) { ix.cardsOf(lid).forEach(function (card) { take(c.id, card); }); });
    });
    var done = [];
    courses.forEach(function (c, ci) {
      if (c.kind === 'notes') return;
      var order = {};
      K.index(c).sequence(variantOf(settings, c)).forEach(function (lid, i) { if (!own(order, lid)) order[lid] = i; });
      var ls = sub(st.lessons, c.id);
      Object.keys(ls).forEach(function (lid) {
        if (ls[lid].done === true) done.push({ c: c, ci: ci, lid: lid, at: ls[lid].done_at || '', order: own(order, lid) ? order[lid] : 1e9 });
      });
    });
    done.sort(function (a, b) { return cmp(a.at, b.at) || (a.ci - b.ci) || (a.order - b.order) || cmp(a.lid, b.lid); });
    done.forEach(function (d) { K.index(d.c).cardsOf(d.lid).forEach(function (card) { take(d.c.id, card); }); });
    return out;
  }
  function total(m) { return Object.keys(m).reduce(function (a, k) { return a + m[k]; }, 0); }
  function ref(c, id) { return id ? { course: c.id, id: id } : null; }

  function build(courses, st, settings, today, opts) {
    settings = Object.assign({}, C.PLAN_DEFAULTS, settings || {});
    opts = opts || {};
    var main = mainCourse(courses, settings);
    var isStudy = settings.study_days.indexOf(D.isoWeekday(today)) >= 0;
    var due = dueCards(courses, st, today);
    var minutes = {};
    var plan = { date: today, course: main ? main.id : null, is_study_day: isStudy, reviews: [], new_cards: [], lesson: null, lab: null, drill: null, quiz: null,
      journal: true, minutes_estimate: minutes, week: null, theme: null };
    var per = C.SECONDS_PER_CARD;
    if (!isStudy && settings.weekend_review_only) {
      plan.reviews = due.slice(0, Math.floor(settings.weekend_minutes * 60 / per)); plan.journal = false;
      if (plan.reviews.length) minutes.review = Math.max(1, Math.ceil(plan.reviews.length * per / 60));
      plan.total_minutes = total(minutes);
      return plan;
    }
    plan.reviews = due.slice(0, settings.max_reviews_per_day);
    plan.new_cards = newCards(courses, st, settings, settings.new_cards_per_day);
    if (plan.reviews.length || plan.new_cards.length) minutes.review = Math.max(1, Math.ceil((plan.reviews.length + plan.new_cards.length) * per / 60));
    if (main) {
      var variant = variantOf(settings, main), ix = K.index(main);
      var lesson = nextLesson(main, st, variant);
      var week = lesson ? ix.weekOf(variant, lesson) : null;
      if (lesson) minutes.lesson = (main.lessons[lesson] && main.lessons[lesson].minutes) || 20;
      var lab = pickLab(main, st, lesson, !!opts.docker);
      if (lab) minutes.lab = main.labs[lab].minutes;
      var drill = null;
      if (D.isoWeekday(today) === Math.max.apply(null, settings.study_days)) {
        drill = pickDrill(main, st, variant, week ? week.week : null);
        if (drill) minutes.drill = main.drills[drill].minutes;
      }
      plan.lesson = ref(main, lesson); plan.lab = ref(main, lab); plan.drill = ref(main, drill);
      plan.week = week ? week.week : null; plan.theme = week ? week.theme : null;
    }
    var order = main ? [main].concat(courses.filter(function (c) { return c !== main && c.kind !== 'notes'; })) : [];
    for (var i = 0; i < order.length && !plan.quiz; i++) plan.quiz = ref(order[i], pickQuiz(order[i], st));
    if (plan.quiz) minutes.quiz = 10;
    minutes.journal = 5;
    plan.total_minutes = total(minutes);
    return plan;
  }

  return { build: build, nextLesson: nextLesson, mainCourse: mainCourse };
});
