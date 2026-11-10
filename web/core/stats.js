/* MyLearner web/core/stats.js — 연속 학습일·요약 통계. MWL web/engine.js(MiddlewareLearner@e55b9c0) streak·summary 를 옮겨 과정 여러 개로 넓혔다.
 * Phase 3(보류 결정 1): 통계 화면 ①~⑥ — overview(학습량·목표·연속·7일 예정)·trend(복습량·정답률)·cardStates(상태 분포·정착률)·
 * progress(진도·숙련도)·weak(틀림이 많은 카드·단원)·checkCompare(점검 전·후). filter = 과정 ID 목록(없으면 전체)
 * 입력: 과정 목록·replay 상태·오늘·설정 / 출력: MyLearner.stats / 트리거: 통계 화면(web/app/stats_view.js)
 * 문서: docs/P2_요구사항정의서_Core.md FR-242, docs/P2_설계서_Core.md 3.5절, docs/P3_요구사항정의서_PC.md FR-340~347, docs/P3_설계서_PC.md 3.7절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.stats = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants'), D = dep('dates'), M = dep('mastery'), K = dep('course'), S = dep('srs');

  function streak(dates, today, studyDays) {
    var days = Object.create(null), set = Object.create(null);
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
    var dates = Object.create(null);
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

  // ---- Phase 3 통계 ①~⑥ — 밖에서 온 ID 로 표를 읽을 때는 자기 키만(P2 독립 점검 F5)
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function sub(map, key) { return own(map, key) ? map[key] : {}; }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function pick(courses, filter) {
    if (!filter) return courses;
    var want = Object.create(null);
    filter.forEach(function (id) { want[id] = true; });
    return courses.filter(function (c) { return want[c.id] === true; });
  }
  function wanted(filter) {
    if (!filter) return null;
    var w = Object.create(null);
    filter.forEach(function (id) { w[id] = true; });
    return w;
  }
  function minutesOn(st, d) { return sum((st.sessions || []).filter(function (s) { return s.date === d; }), function (s) { return s.minutes; }); }

  function overview(courses, st, today, settings, filter) {
    settings = Object.assign({}, C.PLAN_DEFAULTS, settings || {});
    var days = settings.study_days;
    function goal(d) { return days.indexOf(D.isoWeekday(d)) >= 0 ? settings.weekday_minutes : settings.weekend_minutes; }
    var monday = D.addDays(today, 1 - D.isoWeekday(today)), weekMin = 0, weekGoal = 0;
    for (var i = 0; i < 7; i++) {
      var d = D.addDays(monday, i);
      weekGoal += goal(d);
      if (d <= today) weekMin += minutesOn(st, d);
    }
    var due7 = [];
    for (var j = 0; j < 7; j++) due7.push({ date: D.addDays(today, j), count: 0 });
    var last = due7[6].date;
    pick(courses, filter).forEach(function (c) {
      var cards = sub(st.cards, c.id), held = sub(st.held, c.id);
      Object.keys(cards).forEach(function (cid) {
        var s = cards[cid];
        if (!own(c.cards, cid) || own(held, cid) || !s.due || s.due > last) return;
        due7[s.due <= today ? 0 : D.diffDays(today, s.due)].count += 1;
      });
    });
    return { today_minutes: minutesOn(st, today), today_goal: goal(today), week_minutes: weekMin, week_goal: weekGoal,
      streak: streak((st.sessions || []).map(function (s) { return s.date; }), today, days), due7: due7 };
  }

  function trend(st, today, days, filter) {
    var w = wanted(filter), first = D.addDays(today, 1 - days), byDay = Object.create(null);
    (st.reviews || []).forEach(function (r) {
      if ((w && w[r.course] !== true) || r.day < first || r.day > today) return;
      var x = byDay[r.day] || (byDay[r.day] = { reviews: 0, good: 0 });
      x.reviews += 1;
      if (C.GRADE_VALUES[r.grade] >= C.GRADE_VALUES.good) x.good += 1;
    });
    var daily = [], weeks = [], wk = null;
    for (var i = 0; i < days; i++) {
      var d = D.addDays(first, i), x = byDay[d] || { reviews: 0, good: 0 };
      daily.push({ date: d, reviews: x.reviews, good: x.good, accuracy: x.reviews ? x.good / x.reviews : null });
      var ws = D.addDays(d, 1 - D.isoWeekday(d));
      if (!wk || wk.week_start !== ws) { wk = { week_start: ws, reviews: 0, good: 0 }; weeks.push(wk); }
      wk.reviews += x.reviews; wk.good += x.good;
    }
    return { daily: daily, weekly: weeks.map(function (k) { return { week_start: k.week_start, reviews: k.reviews, accuracy: k.reviews ? k.good / k.reviews : null }; }) };
  }

  function settled(s) {
    var g = s.grades || [];
    return g.length >= 3 && g.slice(-3).every(function (x) { return x >= C.GRADE_VALUES.good; });
  }
  function cardStates(courses, st, filter) {
    var out = { new: 0, learning: 0, settled: 0, held: 0, total: 0, settle_rate: null }, rets = [];
    pick(courses, filter).forEach(function (c) {
      var cards = sub(st.cards, c.id), held = sub(st.held, c.id);
      Object.keys(c.cards || {}).forEach(function (cid) {
        out.total += 1;
        var s = own(cards, cid) ? cards[cid] : null;
        if (s) { var r = S.retention(s); if (r !== null) rets.push(r); }
        if (own(held, cid)) out.held += 1;
        else if (!s) out.new += 1;
        else if (settled(s)) out.settled += 1;
        else out.learning += 1;
      });
    });
    out.settle_rate = rets.length ? sum(rets, function (x) { return x; }) / rets.length : null;
    return out;
  }

  function progress(courses, st, filter) {
    var out = {};
    pick(courses, filter).filter(function (c) { return c.kind !== 'notes'; }).forEach(function (c) {
      var ls = sub(st.lessons, c.id), toc = K.index(c).tocLessons;
      out[c.id] = { lessons_done: toc.filter(function (l) { return own(ls, l) && ls[l].done === true; }).length, lessons_total: toc.length, parts: M.summary(c, st) };
    });
    return out;
  }

  function weak(courses, st, filter, nCards, nUnits) {
    var list = pick(courses, filter), byId = Object.create(null);
    list.forEach(function (c) { byId[c.id] = c; });
    var counts = Object.create(null);
    (st.reviews || []).forEach(function (r) {
      var c = byId[r.course];
      if (!c || !own(c.cards, r.card)) return;
      var k = r.course + '\u0000' + r.card, x = counts[k] || (counts[k] = { course: r.course, card: r.card, lesson: c.cards[r.card].lesson, again: 0, reviews: 0 });
      x.reviews += 1;
      if (r.grade === 'again') x.again += 1;
    });
    var cards = Object.keys(counts).map(function (k) { return counts[k]; }).filter(function (x) { return x.again > 0; });
    cards.sort(function (a, b) { return (b.again - a.again) || cmp(a.course, b.course) || cmp(a.card, b.card); });
    var units = Object.create(null);
    cards.forEach(function (x) {
      var c = byId[x.course], uid = K.index(c).unitOf(x.lesson);
      if (!uid) return;
      var k = x.course + '\u0000' + uid;
      if (!units[k]) units[k] = { course: x.course, unit: uid, title: K.index(c).units[uid].title || uid, again: 0, retention: M.retention(c, st, uid) };
      units[k].again += x.again;
    });
    var ul = Object.keys(units).map(function (k) { return units[k]; });
    ul.sort(function (a, b) { return (b.again - a.again) || cmp(a.course, b.course) || cmp(a.unit, b.unit); });
    return { cards: cards.slice(0, nCards), units: ul.slice(0, nUnits) };
  }

  function checkCompare(st, courseId) {
    var base = (st.checks || []).filter(function (d) { return d.course === courseId && (d.mode || 'baseline') === 'baseline'; });
    function one(d) { return d ? { at: d.at, scores: d.scores } : null; }
    return { first: one(base[0]), latest: base.length > 1 ? one(base[base.length - 1]) : null };
  }

  return { streak: streak, summary: summary, overview: overview, trend: trend, cardStates: cardStates, progress: progress, weak: weak, checkCompare: checkCompare };
});
