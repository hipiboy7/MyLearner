/* MyLearner web/core/mastery.js — 단원 숙련도 L0~L5 와 영역 요약. MWL web/engine.js(MiddlewareLearner@e55b9c0) moduleLevel·domainSummary 를 옮겼다.
 * 다른 점: 실습·퀴즈·드릴이 없는 단원은 그 조건을 건너뛴다(MWL 55모듈은 모두 실습이 있어 결과가 같다), 일지는 그 과정(또는 과정 없는) 것만 본다.
 * 입력: 과정·replay 상태 / 출력: MyLearner.mastery / 트리거: stats.js, (Phase 3) 통계·지도 화면
 * 문서: docs/P2_요구사항정의서_Core.md FR-243, docs/P2_설계서_Core.md 3.5절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.mastery = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants'), S = dep('srs'), K = dep('course');
  var TH = C.MASTERY_THRESHOLDS;

  function sub(map, key) { return (map && map[key]) || {}; }
  function isDone(st, cid, lid) { var l = sub(st.lessons, cid)[lid]; return !!l && l.done === true; }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function retention(c, st, uid) {
    var ix = K.index(c), u = ix.units[uid], cards = sub(st.cards, c.id), vals = [];
    if (!u) return null;
    (u.lessons || []).forEach(function (lid) {
      ix.cardsOf(lid).forEach(function (cid) { var s = cards[cid]; if (!s) return; var r = S.retention(s); if (r !== null) vals.push(r); });
    });
    return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
  }
  function unit(c, st, uid) {
    var ix = K.index(c), u = ix.units[uid];
    if (!u || !(u.lessons || []).length) return 0;
    var lessons = u.lessons;
    var ratio = lessons.filter(function (l) { return isDone(st, c.id, l); }).length / lessons.length;
    if (ratio < 0.5) return 0;
    var ret = retention(c, st, uid);
    if (ratio < 1.0 || ret === null || ret < TH.retention_l2) return 1;
    var labs = sub(st.labs, c.id), labIds = ix.labsOfUnit(uid);
    var labDone = !labIds.length || labIds.some(function (id) { return labs[id] && labs[id].done === true; });
    var quizOk = ix.quizzesOfUnit(uid).every(function (qid) {
      return st.quizzes.some(function (q) { return q.course === c.id && q.id === qid && q.score >= C.PASS_SCORES.quiz; });
    });
    if (!(labDone && quizOk)) return 2;
    var lids = {};
    lessons.forEach(function (l) { lids[l] = true; });
    var drillIds = {};
    var drills = Object.keys(c.drills || {}).filter(function (id) { return (c.drills[id].lessons || []).some(function (l) { return lids[l]; }); });
    drills.forEach(function (id) { drillIds[id] = true; });
    var drillOk = !drills.length || st.drills.some(function (d) {
      return d.course === c.id && drillIds[d.id] && (d.max ? Math.round(100 * d.score / d.max) : 0) >= C.PASS_SCORES.drill;
    });
    if (!(drillOk && ret >= TH.retention_l4)) return 3;
    var pat = new RegExp('(?<![A-Z0-9])' + escapeRe(uid) + '(?![0-9])');
    return st.journal.some(function (j) { return (j.course === null || j.course === c.id) && pat.test(j.teach || ''); }) ? 5 : 4;
  }
  function summary(c, st) {
    var out = {};
    (c.parts || []).forEach(function (p) {
      var units = {}, done = 0, tot = 0;
      (p.units || []).forEach(function (u) {
        var n = (u.lessons || []).filter(function (l) { return isDone(st, c.id, l); }).length;
        done += n; tot += (u.lessons || []).length;
        units[u.id] = { title: u.title, level: unit(c, st, u.id), lessons_done: n, lessons_total: (u.lessons || []).length, retention: retention(c, st, u.id) };
      });
      var levels = Object.keys(units).map(function (k) { return units[k].level; });
      out[p.id] = { title: p.title, code: p.code || '', units: units, lessons_done: done, lessons_total: tot,
        avg_level: levels.length ? levels.reduce(function (a, b) { return a + b; }, 0) / levels.length : 0.0 };
    });
    return out;
  }

  return { unit: unit, retention: retention, summary: summary };
});
