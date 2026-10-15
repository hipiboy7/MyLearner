/* MyLearner web/core/replay.js — 사건 목록 → 학습 상태(다시 계산). 늦은 복습 규칙·미래 사건·시계 이상.
 * 뼈대는 hub src/learnhub/engine/events.py(8dee3b8) 의 replay. 늦은 복습 규칙은 BRIEF 5.3-2.
 * 입력: log.merge(...).events(정해진 순서), {today} / 출력: MyLearner.replay.run → 상태 / 트리거: plan·mastery·stats·mwl_import.verify
 * 문서: docs/P2_요구사항정의서_Core.md FR-224·225, docs/P2_설계서_Core.md 3.4절(사례 표) */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.replay = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants'), D = dep('dates'), S = dep('srs');
  var COURSE = new RegExp(C.SHARED.COURSE_ID_RE), ITEM = new RegExp(C.SHARED.ITEM_ID_RE), KEY = new RegExp(C.SETTING_KEY_RE);
  var MODE = /^[a-z][a-z0-9_-]{0,19}$/;

  function isCourse(v) { return typeof v === 'string' && COURSE.test(v); }
  function isItem(v) { return typeof v === 'string' && ITEM.test(v); }
  function isCount(v) { return Number.isInteger(v) && v >= 0; }
  function optCount(v) { return v === undefined || v === null || isCount(v); }
  function optText(v) { return v === undefined || v === null || typeof v === 'string'; }
  function optItem(v) { return v === undefined || v === null || isItem(v); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function copy(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function slot(map, key) { return (map[key] = map[key] || {}); }

  // 늦은 복습 규칙: due 보다 이른 날의 복습은 again 일 때만 계산에 쓴다. 같은 날 이미 again 이 들어간 카드에는 다시 넣지 않는다
  function applies(cur, grade, day) {
    if (!cur.due || day >= cur.due) return true;
    if (grade !== 'again') return false;
    var g = cur.grades || [];
    return !(cur.last === day && g.length && g[g.length - 1] === 0);
  }

  var H = {
    'review': function (st, d, e) {
      if (!isCourse(d.course) || !isItem(d.card) || !Object.prototype.hasOwnProperty.call(C.GRADE_VALUES, d.grade)) return false;
      var m = slot(st.cards, d.course);
      var cur = m[d.card] || S.newCardState();
      var ok = applies(cur, d.grade, e.day);
      if (ok) { m[d.card] = S.review(cur, d.grade, e.day); st.counts.applied += 1; } else st.counts.early += 1;
      st.reviews.push({ course: d.course, card: d.card, day: e.day, grade: d.grade, applied: ok });
      return true;
    },
    'card.state': function (st, d) {
      if (!isCourse(d.course) || !isItem(d.card) || !S.validState(d.state)) return false;
      var s = d.state;
      slot(st.cards, d.course)[d.card] = { ef: s.ef, interval: s.interval, reps: s.reps, lapses: s.lapses, due: s.due, last: s.last, grades: s.grades.slice() };
      st.counts.imported += 1;
      return true;
    },
    'card.hold': function (st, d) {
      if (!isCourse(d.course) || !isItem(d.card) || typeof d.on !== 'boolean' || !optText(d.why)) return false;
      if (d.on) slot(st.held, d.course)[d.card] = true;
      else if (st.held[d.course]) delete st.held[d.course][d.card];
      return true;
    },
    'lesson': function (st, d, e) {
      var conf = d.confidence;
      if (!isCourse(d.course) || !isItem(d.lesson) || typeof d.done !== 'boolean') return false;
      if (!(conf === undefined || conf === null || (Number.isInteger(conf) && conf >= 1 && conf <= 5))) return false;
      slot(st.lessons, d.course)[d.lesson] = d.done ? { done: true, done_at: e.day, confidence: conf === undefined ? null : conf }
        : { done: false, done_at: null, confidence: null };
      return true;
    },
    'lab': function (st, d, e) {
      if (!isCourse(d.course) || !isItem(d.lab) || typeof d.done !== 'boolean' || !optCount(d.score) || !optCount(d.total) || !optText(d.notes)) return false;
      slot(st.labs, d.course)[d.lab] = d.done
        ? { done: true, done_at: e.day, score: d.score === undefined ? null : d.score, total: d.total === undefined ? null : d.total, notes: d.notes || '' }
        : { done: false, done_at: null, score: null, total: null, notes: '' };
      return true;
    },
    'drill': function (st, d, e) {
      if (!isCourse(d.course) || !isItem(d.drill) || !isCount(d.score) || !isCount(d.max) || !Array.isArray(d.path) ||
          !d.path.every(function (p) { return typeof p === 'string'; })) return false;
      st.drills.push({ course: d.course, id: d.drill, score: d.score, max: d.max, at: e.day, path: d.path.slice() });
      return true;
    },
    'quiz': function (st, d, e) {
      if (!isCourse(d.course) || !isItem(d.quiz) || !Number.isInteger(d.score) || d.score < 0 || d.score > 100 ||
          !(d.answers === undefined || isObj(d.answers))) return false;
      st.quizzes.push({ course: d.course, id: d.quiz, score: d.score, at: e.day, answers: copy(d.answers) || {} });
      return true;
    },
    'check': function (st, d, e) {
      if (!isCourse(d.course) || typeof d.mode !== 'string' || !MODE.test(d.mode) || !isObj(d.scores) || !optCount(d.total) || !Array.isArray(d.items)) return false;
      if (!Object.keys(d.scores).every(function (k) { return isCount(d.scores[k]); })) return false;
      st.checks.push({ course: d.course, at: e.day, mode: d.mode, scores: copy(d.scores), total: d.total === undefined ? null : d.total, items: copy(d.items) });
      return true;
    },
    'session': function (st, d, e) {
      if (!isCount(d.minutes) || !isCount(d.reviewed) || !(d.course === undefined || d.course === null || isCourse(d.course)) ||
          !optItem(d.lesson) || !optItem(d.lab)) return false;
      var s = st._sessions[e.day];
      if (!s) s = st._sessions[e.day] = { date: e.day, minutes: 0, reviewed: 0, lesson: null, lab: null };
      s.minutes += d.minutes; s.reviewed += d.reviewed;
      if (d.lesson) s.lesson = d.lesson;
      if (d.lab) s.lab = d.lab;
      return true;
    },
    'journal': function (st, d, e) {
      var keys = ['summary', 'apply', 'unclear', 'teach'];
      if (!(d.course === undefined || d.course === null || isCourse(d.course)) || !keys.every(function (k) { return optText(d[k]); })) return false;
      var j = { course: d.course || null, date: e.day };
      keys.forEach(function (k) { j[k] = d[k] || ''; });
      st.journal.push(j);
      return true;
    },
    'setting': function (st, d) {
      if (typeof d.key !== 'string' || !KEY.test(d.key) || d.value === undefined) return false;
      st.settings[d.key] = copy(d.value);
      return true;
    }
  };

  function run(events, opts) {
    opts = opts || {};
    var limit = opts.today ? D.addDays(opts.today, C.FUTURE_DAYS) : null;
    var st = { cards: {}, held: {}, lessons: {}, labs: {}, drills: [], quizzes: [], checks: [], journal: [], sessions: [], settings: {},
      reviews: [], future: [], _sessions: {},
      counts: { events: 0, applied: 0, early: 0, imported: 0, future: 0, unknown: 0, invalid: 0, clock_back: 0 } };
    var maxDay = {};
    (events || []).forEach(function (e) {
      st.counts.events += 1;
      if (maxDay[e.dev] && e.day < maxDay[e.dev]) st.counts.clock_back += 1;
      else maxDay[e.dev] = e.day;
      if (limit && e.day > limit) { st.future.push(e); st.counts.future += 1; return; }
      var h = H[e.type];
      if (!h) { st.counts.unknown += 1; return; }
      if (!h(st, e.data, e)) st.counts.invalid += 1;
    });
    st.sessions = Object.keys(st._sessions).sort().map(function (k) { return st._sessions[k]; });
    delete st._sessions;
    return st;
  }

  return { run: run, applies: applies };
});
