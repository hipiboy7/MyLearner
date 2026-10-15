/* MyLearner web/core/mwl_import.js — MWL 진도(스키마 1·2, 폐쇄망 브라우저의 mwl.progress) → 사건 줄 + 메모 과정, N/N 대조.
 * 앱 안에서 바꾼다 — 사용자의 MWL 진도는 폐쇄망 브라우저에만 있고 밖으로 못 나온다(BRIEF 4.1·5.7).
 * MWL 진도 꼴: mwl/domain/models.py Progress·migrate(MiddlewareLearner@e55b9c0).
 * 입력: 진도 객체 또는 JSON 글 / 출력: MyLearner.mwl_import.convert·verify / 트리거: (Phase 3) MWL 진도 들여오기 화면
 * 문서: docs/P2_요구사항정의서_Core.md FR-261·262, docs/P2_설계서_Core.md 3.8절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.mwl_import = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants'), D = dep('dates'), H = dep('hash'), S = dep('srs'), L = dep('log');
  var SH = C.SHARED;
  var MWL = SH.MWL_COURSE_ID, NOTES = SH.MWL_NOTES_ID;
  var ITEM = new RegExp(SH.ITEM_ID_RE), CARD_K = /^K\d{4}-c\d{2}$/;
  var STATE_KEYS = ['ef', 'interval', 'reps', 'lapses', 'due', 'last', 'grades'];
  var KIND = { lesson: 1, lab: 2, quiz: 3, drill: 4, check: 5, session: 6, journal: 7, 'card.state': 9 };

  function parse(input) {
    var p = input;
    if (typeof input === 'string') { try { p = JSON.parse(input); } catch (e) { throw new Error('진도 파일이 JSON 이 아니다'); } }
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('진도 파일이 JSON 객체가 아니다');
    return p;
  }
  // MWL models.migrate 와 같다 — 모르는 스키마는 거부한다(조용히 버리지 않는다)
  function migrate(p) {
    if (p.schema === 2 || p.schema === 1) {
      var up = Object.assign({}, p, { schema: 2 });
      if (!up.knowledge) up.knowledge = [];
      if (up.knowledge_seq === undefined) up.knowledge_seq = 0;
      return up;
    }
    throw new Error('진도 파일 스키마를 모른다. 받는 판: 1·2');
  }
  function courseOf(cardId) { return CARD_K.test(cardId) ? NOTES : MWL; }
  function dayOr(v, fallback, what) {
    var d = v || fallback;
    if (!D.isDay(d)) throw new Error(what + ' 의 날짜가 틀렸다');
    return d;
  }
  function list(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

  function convert(input) {
    var raw = parse(input);
    var schemaIn = raw.schema;
    var p = migrate(raw);
    var created = p.created;
    var dev = 'mwl-' + H.sha256Hex(L.canonical(p)).slice(0, 12);
    var items = [], skipped = { lessons: 0, labs: 0 };
    function add(day, type, order, fields) { items.push({ day: day, kind: KIND[type], order: order, fields: Object.assign({ type: type }, fields) }); }
    function idx(i) { return String(i).padStart(8, '0'); }

    var cards = obj(p.cards);
    Object.keys(cards).sort().forEach(function (id) {
      if (!ITEM.test(id)) throw new Error('카드 ID 가 틀렸다');
      var s = cards[id];
      if (!S.validState(s)) throw new Error('카드 상태가 틀렸다: ' + id);
      var state = {};
      STATE_KEYS.forEach(function (k) { state[k] = k === 'grades' ? s.grades.slice() : s[k]; });
      add(dayOr(s.last, created, '카드'), 'card.state', id, { course: courseOf(id), card: id, state: state, src: 'mwl' });
    });
    var lessons = obj(p.lessons);
    Object.keys(lessons).sort().forEach(function (id) {
      var st = obj(lessons[id]);
      if (st.status !== 'done' || !ITEM.test(id)) { skipped.lessons += 1; return; }
      add(dayOr(st.done_at, created, '강의'), 'lesson', id, { course: MWL, lesson: id, done: true, confidence: st.confidence === undefined ? null : st.confidence });
    });
    var labs = obj(p.labs);
    Object.keys(labs).sort().forEach(function (id) {
      var st = obj(labs[id]);
      if (st.status !== 'done' || !ITEM.test(id)) { skipped.labs += 1; return; }
      add(dayOr(st.done_at, created, '실습'), 'lab', id, { course: MWL, lab: id, done: true,
        score: st.score === undefined ? null : st.score, total: st.total === undefined ? null : st.total, notes: st.notes || '' });
    });
    list(p.drills).forEach(function (r, i) { add(dayOr(r.at, null, '드릴'), 'drill', idx(i), { course: MWL, drill: r.id, score: r.score, max: r.max, path: list(r.path).slice() }); });
    list(p.quizzes).forEach(function (r, i) { add(dayOr(r.at, null, '퀴즈'), 'quiz', idx(i), { course: MWL, quiz: r.id, score: r.score, answers: Object.assign({}, obj(r.answers)) }); });
    list(p.diagnostics).forEach(function (r, i) {
      add(dayOr(r.at, null, '점검'), 'check', idx(i), { course: MWL, mode: r.mode || 'baseline', scores: Object.assign({}, obj(r.scores)),
        total: r.total === undefined ? null : r.total, items: list(r.items).slice() });
    });
    list(p.sessions).forEach(function (r, i) {
      add(dayOr(r.date, null, '학습 시간'), 'session', idx(i), { course: MWL, minutes: r.minutes, reviewed: r.reviewed, lesson: r.lesson || null, lab: r.lab || null });
    });
    list(p.journal).forEach(function (r, i) {
      add(dayOr(r.date, null, '일지'), 'journal', idx(i), { course: MWL, summary: r.summary || '', apply: r.apply || '', unclear: r.unclear || '', teach: r.teach || '' });
    });

    items.sort(function (a, b) {
      return (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || (a.kind - b.kind) || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
    });
    var events = items.map(function (it, i) {
      return L.make(Object.assign({ dev: dev, seq: i + 1, t: it.day + 'T00:00:00.000Z', day: it.day }, it.fields));
    });
    var notes = notesCourse(list(p.knowledge));
    return { lines: events.map(function (e) { return e.line; }), events: events, notes: notes,
      report: { schema: schemaIn, events: events.length, cards: Object.keys(cards).length, skipped: skipped,
        notes_lessons: notes ? Object.keys(notes.lessons).length : 0, notes_cards: notes ? Object.keys(notes.cards).length : 0 } };
  }

  // MWL 내 지식 → 메모 과정. 카드 ID(K0001-c01)는 지금의 목록 위치로 정해 과정 파일에 적는다 — 이제 바뀌지 않는다
  function notesCourse(knowledge) {
    if (!knowledge.length) return null;
    var order = knowledge.slice().sort(function (a, b) {
      return (a.created < b.created ? -1 : a.created > b.created ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    var lessons = {}, cards = {}, worst = 0;
    order.forEach(function (e) {
      var conf = SH.CONFIDENCE_LEVELS.indexOf(e.confidence) >= 0 ? e.confidence : 'unverified';
      worst = Math.max(worst, SH.CONFIDENCE_LEVELS.indexOf(conf));
      var l = { title: e.title, level: 1, prereqs: [], tags: list(e.tags).slice(), confidence: conf, sources: e.source ? [e.source] : [],
        body: e.body || '', created: e.created, kind: e.kind || '', origin: e.origin || 'manual', source: e.source || '',
        related: { course: MWL, part: e.domain || null, unit: e.module || null } };
      if (e.updated) l.updated = e.updated;
      lessons[e.id] = l;
      list(e.cards).forEach(function (c, i) {
        cards[e.id + '-c' + String(i + 1).padStart(2, '0')] = { lesson: e.id, type: 'concept', q: String(c.q).trim(), a: String(c.a).trim(),
          hint: '', tags: list(e.tags).slice(), difficulty: 1 };
      });
    });
    return { format: SH.COURSE_FORMAT, version: SH.COURSE_VERSION, min_reader: SH.COURSE_MIN_READER, id: NOTES, title: 'MWL 내 메모',
      kind: 'notes', lang: 'ko', confidence: SH.CONFIDENCE_LEVELS[worst], readonly: false,
      origin: { type: 'mwl-notes', ref: 'MiddlewareLearner 진도', hash: H.sha256Hex(L.canonical(knowledge)) }, default_plan: null, summary: '',
      parts: [{ id: 'notes', title: '내 메모', code: '', summary: '', units: [{ id: 'notes-all', title: '모두', goal: '', lessons: order.map(function (e) { return e.id; }) }] }],
      lessons: lessons, cards: cards, quizzes: {}, labs: {}, drills: {}, glossary: [], diagnostic: [], plans: {} };
  }

  function verify(input, state) {
    var p = migrate(parse(input));
    var cards = obj(p.cards), mismatches = [], match = 0;
    Object.keys(cards).sort().forEach(function (id) {
      var course = courseOf(id), want = cards[id];
      var got = (state.cards[course] || {})[id];
      var fields = !got ? ['missing'] : STATE_KEYS.filter(function (k) { return JSON.stringify(got[k]) !== JSON.stringify(want[k]); });
      if (fields.length) mismatches.push({ course: course, card: id, fields: fields }); else match += 1;
    });
    return { total: Object.keys(cards).length, match: match, mismatches: mismatches };
  }

  return { convert: convert, verify: verify, migrate: migrate };
});
