/* MyLearner web/core/srs.js — SM-2 간격 반복. MWL web/engine.js(MiddlewareLearner@e55b9c0) 의 review·isDue·retention 을 그대로 옮겼다.
 * 입력: 카드 상태·등급·날짜 / 출력: MyLearner.srs / 트리거: replay.js(다시 계산)·plan.js·mastery.js
 * 문서: docs/P2_요구사항정의서_Core.md FR-230, docs/P2_설계서_Core.md 3.4절. 골든 벡터: tests/fixtures/mwl/srs_vectors.json */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.srs = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants'), D = dep('dates');
  var SM2 = C.SM2, GV = C.GRADE_VALUES;

  function roundHalfUp(x) { return Math.floor(x + 0.5); }
  function round4(x) { return Math.round(x * 10000) / 10000; }
  function newCardState() { return { ef: SM2.initial_ef, interval: 0, reps: 0, lapses: 0, due: null, last: null, grades: [] }; }

  function review(state, grade, today) {
    if (!Object.prototype.hasOwnProperty.call(GV, grade)) throw new Error('알 수 없는 등급');
    var g = GV[grade];
    var ef = state.ef, iv = state.interval, reps = state.reps, lapses = state.lapses;
    if (g === 0) { lapses += 1; reps = 0; iv = SM2.first_interval; ef = Math.max(SM2.min_ef, ef - SM2.again_penalty); }
    else if (g === 1) { reps += 1; iv = Math.max(1, roundHalfUp(iv * SM2.hard_multiplier)); ef = Math.max(SM2.min_ef, ef - SM2.hard_penalty); }
    else if (g === 2) { reps += 1; iv = reps === 1 ? SM2.first_interval : reps === 2 ? SM2.second_interval : roundHalfUp(iv * ef); }
    else { reps += 1; iv = reps === 1 ? SM2.easy_first_interval : roundHalfUp(Math.max(iv, 1) * ef * SM2.easy_bonus); ef = ef + SM2.easy_reward; }
    iv = Math.min(iv, SM2.max_interval);
    ef = round4(ef);
    return { ef: ef, interval: iv, reps: reps, lapses: lapses, due: D.addDays(today, iv), last: today,
      grades: (state.grades || []).concat([g]).slice(-C.GRADES_KEEP) };
  }
  function isDue(state, today) { return state.due !== null && state.due !== undefined && state.due <= today; }
  function retention(state, lastN) {
    lastN = lastN || 3;
    if (!state.grades || !state.grades.length) return null;
    var recent = state.grades.slice(-lastN);
    return recent.filter(function (g) { return g >= GV.good; }).length / recent.length;
  }
  function isCount(v, max) { return Number.isInteger(v) && v >= 0 && v <= max; }
  // card.state 사건에 담을 수 있는 꼴인가(MWL models.CardState 검사 + 상한)
  function validState(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    if (typeof s.ef !== 'number' || !isFinite(s.ef) || s.ef < SM2.min_ef || s.ef > 10) return false;
    if (!isCount(s.interval, 36500) || !isCount(s.reps, 100000) || !isCount(s.lapses, 100000)) return false;
    if (!(s.due === null || D.isDay(s.due)) || !(s.last === null || D.isDay(s.last))) return false;
    if (!Array.isArray(s.grades) || s.grades.length > C.GRADES_KEEP) return false;
    return s.grades.every(function (g) { return isCount(g, 3); });
  }

  return { newCardState: newCardState, review: review, isDue: isDue, retention: retention, validState: validState, roundHalfUp: roundHalfUp };
});
