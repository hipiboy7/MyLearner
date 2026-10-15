/* MyLearner web/core/stats.js — 연속 학습일·요약 통계. MWL web/engine.js(MiddlewareLearner@e55b9c0) streak·summary 를 옮겨 과정 여러 개로 넓혔다.
 * 통계 항목 넓히기(과정별 추이·정착률 등 S7)는 Phase 3 — 보류 결정 1.
 * 입력: 과정 목록·replay 상태·오늘·공부 요일 / 출력: MyLearner.stats / 트리거: (Phase 3) 통계 화면
 * 문서: docs/P2_요구사항정의서_Core.md FR-242, docs/P2_설계서_Core.md 3.5절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.stats = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants'), D = dep('dates'), M = dep('mastery'), K = dep('course');

  function streak(dates, today, studyDays) {
    var days = {}, set = {};
    (studyDays && studyDays.length ? studyDays : [1, 2, 3, 4, 5, 6, 7]).forEach(function (d) { days[d] = true; });
    dates.forEach(function (d) { set[d] = true; });
    var cur = today;
    if (!set[cur]) {
      cur = D.addDays(cur, -1);
      while (!days[D.isoWeekday(cur)]) cur = D.addDays(cur, -1);
      if (!set[cur]) return 0;
    }
    var n = 0;
    for (var guard = 0; guard < 3650; guard++) {
      if (days[D.isoWeekday(cur)]) { if (set[cur]) n += 1; else break; } else if (set[cur]) n += 1;
      cur = D.addDays(cur, -1);
    }
    return n;
  }
  function values(map) { return Object.keys(map || {}).map(function (k) { return map[k]; }); }
  function sum(list, f) { return list.reduce(function (a, x) { return a + f(x); }, 0); }

  function summary(courses, st, today, studyDays) {
    var sessions = st.sessions;
    var states = [], lessonsDone = 0, labsDone = 0;
    values(st.cards).forEach(function (m) { values(m).forEach(function (s) { states.push(s); }); });
    values(st.lessons).forEach(function (m) { lessonsDone += values(m).filter(function (l) { return l.done === true; }).length; });
    values(st.labs).forEach(function (m) { labsDone += values(m).filter(function (l) { return l.done === true; }).length; });
    var grades = [];
    states.forEach(function (s) { (s.grades || []).forEach(function (g) { grades.push(g); }); });
    var base = st.checks.filter(function (d) { return (d.mode || 'baseline') === 'baseline'; });
    var first = base.length ? base[0] : null, latest = base.length ? base[base.length - 1] : null;
    var last7 = [];
    for (var i = 6; i >= 0; i--) {
      var d = D.addDays(today, -i);
      last7.push({ date: d, minutes: sum(sessions.filter(function (s) { return s.date === d; }), function (s) { return s.minutes; }) });
    }
    var regular = courses.filter(function (c) { return c.kind !== 'notes'; }), notes = courses.filter(function (c) { return c.kind === 'notes'; });
    var per = {};
    regular.forEach(function (c) { per[c.id] = M.summary(c, st); });
    var dates = {};
    sessions.forEach(function (s) { dates[s.date] = true; });
    return {
      date: today,
      streak: streak(sessions.map(function (s) { return s.date; }), today, studyDays),
      study_days_total: Object.keys(dates).length,
      total_minutes: sum(sessions, function (s) { return s.minutes; }),
      total_reviewed: sum(sessions, function (s) { return s.reviewed; }),
      cards_seen: states.length,
      cards_due_today: states.filter(function (s) { return s.due && s.due <= today; }).length,
      accuracy: grades.length ? grades.filter(function (g) { return g >= C.GRADE_VALUES.good; }).length / grades.length : null,
      lessons_done: lessonsDone,
      lessons_total: sum(regular, function (c) { return K.index(c).tocLessons.length; }),
      labs_done: labsDone,
      drills: st.drills.length,
      quizzes: st.quizzes.length,
      journal_entries: st.journal.length,
      last7: last7,
      diagnostic: first ? first.scores : null,
      diagnostic_latest: latest && latest !== first ? latest.scores : null,
      checks: st.checks.length,
      knowledge: sum(notes, function (c) { return Object.keys(c.lessons || {}).length; }),
      knowledge_cards: sum(notes, function (c) { return Object.keys(c.cards || {}).length; }),
      courses: per
    };
  }

  return { streak: streak, summary: summary };
});
