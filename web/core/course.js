/* MyLearner web/core/course.js — 과정 파일 v1 검사(오류·경고 코드)와 목차 색인.
 * 검사 규칙은 MWL mwl/domain/models.py(MiddlewareLearner@e55b9c0)의 __post_init__ 검사를 과정 하나에 묶이지 않게 일반화했다.
 * 입력: 과정 객체(JSON.parse 한 것) / 출력: MyLearner.course.validate·index / 트리거: 과정 가져오기 관문(Phase 3·5), plan·mastery·stats
 * 문서: docs/P2_요구사항정의서_Core.md FR-210~212, docs/P2_설계서_Core.md 3.2절(코드 표) */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.course = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants'), G = dep('grade');
  var S = C.SHARED;
  var COURSE = new RegExp(S.COURSE_ID_RE), ITEM = new RegExp(S.ITEM_ID_RE);
  var CARD_TYPE = /^[a-z][a-z0-9_-]{0,23}$/, LANG = /^[a-z]{2}(-[A-Z]{2})?$/;
  var DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  var KEYS = {
    top: ['format', 'version', 'min_reader', 'id', 'title', 'kind', 'lang', 'summary', 'confidence', 'readonly', 'origin', 'default_plan',
      'parts', 'lessons', 'cards', 'quizzes', 'labs', 'drills', 'glossary', 'diagnostic', 'plans', 'assets'],
    origin: ['type', 'ref', 'hash'], part: ['id', 'title', 'code', 'summary', 'units'], unit: ['id', 'title', 'goal', 'lessons'],
    lesson: ['title', 'minutes', 'level', 'prereqs', 'tags', 'confidence', 'sources', 'body', 'created', 'updated', 'kind', 'origin', 'source', 'related'],
    card: ['lesson', 'type', 'q', 'a', 'hint', 'tags', 'difficulty', 'source'], quiz: ['unit', 'title', 'items'],
    item: ['id', 'type', 'q', 'options', 'answer', 'explain', 'lesson'],
    lab: ['title', 'tier', 'unit', 'lessons', 'minutes', 'env', 'body', 'checks'], check: ['id', 'q', 'type', 'options', 'answer', 'explain'],
    drill: ['title', 'parts', 'difficulty', 'minutes', 'lessons', 'situation', 'start', 'steps', 'debrief', 'max_score'],
    step: ['prompt', 'options'], option: ['text', 'next', 'score', 'feedback'], term: ['id', 'term', 'en', 'short', 'part', 'lesson'],
    plan: ['weeks'], week: ['week', 'theme', 'drill', 'days'], day: ['day', 'lesson', 'lab']
  };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function validate(c) {
    var errors = [], warnings = [], nErr = 0, nWarn = 0;
    function err(code, path, msg) { nErr += 1; if (errors.length < C.MAX_REPORTED) errors.push({ code: code, path: path, msg: msg }); }
    function warn(code, path, msg) { nWarn += 1; if (warnings.length < C.MAX_REPORTED) warnings.push({ code: code, path: path, msg: msg }); }
    function done() { return { ok: nErr === 0, errors: errors, warnings: warnings, error_count: nErr, warning_count: nWarn, counts: counts }; }
    var counts = { parts: 0, units: 0, lessons: 0, cards: 0, quizzes: 0, quiz_items: 0, labs: 0, drills: 0, glossary: 0, diagnostic: 0, plans: 0 };
    if (!isObj(c)) { err('E-TYPE', '', '과정 파일은 JSON 객체여야 한다'); return done(); }

    function keys(o, allowed, path) { Object.keys(o).forEach(function (k) { if (allowed.indexOf(k) < 0) warn('W-UNKNOWN', path ? path + '.' + k : k, '모르는 키(지우지 않는다)'); }); }
    function text(o, k, path, required) {
      if (!own(o, k) || o[k] === undefined) { if (required) err('E-EMPTY', path, '필요하다'); return false; }
      if (typeof o[k] !== 'string') { err('E-TYPE', path, '글이어야 한다'); return false; }
      if (required && !o[k].trim()) { err('E-EMPTY', path, '비어 있다'); return false; }
      return true;
    }
    function int(o, k, path, lo, hi, required) {
      if (!own(o, k) || o[k] === undefined) { if (required) err('E-EMPTY', path, '필요하다'); return; }
      if (!Number.isInteger(o[k])) err('E-TYPE', path, '정수여야 한다');
      else if (o[k] < lo || (hi !== null && o[k] > hi)) err('E-RANGE', path, lo + '~' + (hi === null ? '' : hi));
    }
    function list(o, k, path, required) {
      if (!own(o, k) || o[k] === undefined) { if (required) err('E-EMPTY', path, '필요하다'); return []; }
      if (!Array.isArray(o[k])) { err('E-TYPE', path, '목록이어야 한다'); return []; }
      return o[k];
    }
    function strings(o, k, path) {
      list(o, k, path, false).forEach(function (v, i) { if (typeof v !== 'string') err('E-TYPE', path + '[' + i + ']', '글이어야 한다'); });
    }
    function map(o, k, path) {
      if (!own(o, k) || o[k] === undefined) return {};
      if (!isObj(o[k])) { err('E-TYPE', path, '객체여야 한다'); return {}; }
      return o[k];
    }
    function enumOf(o, k, path, allowed, required) {
      if (!own(o, k) || o[k] === undefined) { if (required) err('E-EMPTY', path, '필요하다'); return; }
      if (allowed.indexOf(o[k]) < 0) err('E-ENUM', path, allowed.join('·') + ' 가운데 하나');
    }
    function itemId(id, path) { if (typeof id !== 'string' || !ITEM.test(id)) { err('E-ID', path, '항목 ID 규칙 ' + S.ITEM_ID_RE); return false; } return true; }
    function ref(v, set, path, what) { if (typeof v !== 'string' || !own(set, v)) err('E-REF', path, '없는 ' + what); }

    // ---- 머리
    if (c.format !== S.COURSE_FORMAT) err('E-FORMAT', 'format', S.COURSE_FORMAT + ' 이 아니다');
    if (!Number.isInteger(c.version) || c.version < 1) err('E-VERSION', 'version', '1 이상의 정수');
    if (!Number.isInteger(c.min_reader) || c.min_reader < 1) err('E-VERSION', 'min_reader', '1 이상의 정수');
    else if (c.min_reader > S.COURSE_READER) err('E-READER', 'min_reader', '이 판(' + S.COURSE_READER + ')보다 새 판이 필요하다');
    if (nErr) return done();
    keys(c, KEYS.top, '');
    if (typeof c.id !== 'string' || !COURSE.test(c.id)) err('E-ID', 'id', '과정 ID 규칙 ' + S.COURSE_ID_RE);
    text(c, 'title', 'title', true);
    enumOf(c, 'kind', 'kind', S.COURSE_KINDS, true);
    if (own(c, 'lang') && (typeof c.lang !== 'string' || !LANG.test(c.lang))) err('E-TYPE', 'lang', 'ko·en-US 꼴');
    text(c, 'summary', 'summary', false);
    enumOf(c, 'confidence', 'confidence', S.CONFIDENCE_LEVELS, false);
    if (own(c, 'readonly') && typeof c.readonly !== 'boolean') err('E-TYPE', 'readonly', 'true·false');
    if (own(c, 'origin')) {
      if (!isObj(c.origin)) err('E-TYPE', 'origin', '객체여야 한다');
      else { keys(c.origin, KEYS.origin, 'origin'); ['type', 'ref', 'hash'].forEach(function (k) { text(c.origin, k, 'origin.' + k, false); }); }
    }

    // ---- 목차
    var partSet = {}, unitSet = {}, lessonInToc = {};
    var lessons = map(c, 'lessons', 'lessons');
    if (!own(c, 'parts')) err('E-EMPTY', 'parts', '필요하다');
    list(c, 'parts', 'parts', false).forEach(function (p, pi) {
      var pp = 'parts[' + pi + ']';
      if (!isObj(p)) { err('E-TYPE', pp, '객체여야 한다'); return; }
      keys(p, KEYS.part, pp); counts.parts += 1;
      if (itemId(p.id, pp + '.id')) { if (own(partSet, p.id) || own(unitSet, p.id)) err('E-DUP', pp + '.id', '영역·단원 ID 중복'); partSet[p.id] = p; }
      text(p, 'title', pp + '.title', true); text(p, 'code', pp + '.code', false); text(p, 'summary', pp + '.summary', false);
      list(p, 'units', pp + '.units', true).forEach(function (u, ui) {
        var up = pp + '.units[' + ui + ']';
        if (!isObj(u)) { err('E-TYPE', up, '객체여야 한다'); return; }
        keys(u, KEYS.unit, up); counts.units += 1;
        if (itemId(u.id, up + '.id')) { if (own(unitSet, u.id) || own(partSet, u.id)) err('E-DUP', up + '.id', '영역·단원 ID 중복'); unitSet[u.id] = u; }
        text(u, 'title', up + '.title', true); text(u, 'goal', up + '.goal', false);
        list(u, 'lessons', up + '.lessons', true).forEach(function (lid, li) {
          var lp = up + '.lessons[' + li + ']';
          if (!itemId(lid, lp)) return;
          if (own(lessonInToc, lid)) err('E-DUP', lp, '강의가 두 곳에 있다');
          else if (!own(lessons, lid)) err('E-REF', lp, '없는 강의');
          lessonInToc[lid] = true;
        });
      });
    });

    // ---- 강의
    Object.keys(lessons).forEach(function (lid) {
      var l = lessons[lid], lp = 'lessons.' + lid;
      if (!itemId(lid, lp)) return;
      if (!isObj(l)) { err('E-TYPE', lp, '객체여야 한다'); return; }
      keys(l, KEYS.lesson, lp); counts.lessons += 1;
      if (!own(lessonInToc, lid)) warn('W-ORPHAN', lp, '목차에 없는 강의');
      text(l, 'title', lp + '.title', true); text(l, 'body', lp + '.body', false);
      int(l, 'minutes', lp + '.minutes', 1, 600, false); int(l, 'level', lp + '.level', 0, 5, false);
      strings(l, 'tags', lp + '.tags'); strings(l, 'sources', lp + '.sources');
      enumOf(l, 'confidence', lp + '.confidence', S.CONFIDENCE_LEVELS, false);
      list(l, 'prereqs', lp + '.prereqs', false).forEach(function (p, i) { ref(p, lessons, lp + '.prereqs[' + i + ']', '강의'); });
      ['created', 'updated', 'kind', 'origin', 'source'].forEach(function (k) { text(l, k, lp + '.' + k, false); });
    });

    // ---- 카드
    var cards = map(c, 'cards', 'cards');
    Object.keys(cards).forEach(function (cid) {
      var k = cards[cid], cp = 'cards.' + cid;
      if (!itemId(cid, cp)) return;
      if (!isObj(k)) { err('E-TYPE', cp, '객체여야 한다'); return; }
      keys(k, KEYS.card, cp); counts.cards += 1;
      ref(k.lesson, lessons, cp + '.lesson', '강의');
      if (typeof k.type !== 'string' || !CARD_TYPE.test(k.type)) err('E-ENUM', cp + '.type', '영문 소문자 종류');
      text(k, 'q', cp + '.q', true); text(k, 'a', cp + '.a', true); text(k, 'hint', cp + '.hint', false); text(k, 'source', cp + '.source', false);
      strings(k, 'tags', cp + '.tags'); int(k, 'difficulty', cp + '.difficulty', 1, 5, false);
    });

    // ---- 퀴즈·점검 문항
    function quizItem(it, ip, seen) {
      if (!isObj(it)) { err('E-TYPE', ip, '객체여야 한다'); return; }
      keys(it, KEYS.item, ip);
      if (itemId(it.id, ip + '.id')) { if (own(seen, it.id)) err('E-DUP', ip + '.id', '문항 ID 중복'); seen[it.id] = true; }
      text(it, 'q', ip + '.q', true); text(it, 'explain', ip + '.explain', false);
      ref(it.lesson, lessons, ip + '.lesson', '강의');
      var opts = list(it, 'options', ip + '.options', false);
      if (S.QUIZ_ITEM_TYPES.indexOf(it.type) < 0) { err('E-ENUM', ip + '.type', S.QUIZ_ITEM_TYPES.join('·')); return; }
      var a = it.answer, bad = false;
      if (it.type === 'mcq') bad = opts.length < 2 || opts.indexOf(a) < 0;
      else if (it.type === 'multi') bad = opts.length < 2 || !Array.isArray(a) || !a.length || a.some(function (x) { return opts.indexOf(x) < 0; });
      else if (it.type === 'order') bad = opts.length < 2 || !Array.isArray(a) || a.slice().sort().join('\u0000') !== opts.slice().sort().join('\u0000');
      else bad = typeof a !== 'string' || !a.trim();
      if (bad) err('E-ANSWER', ip + '.answer', it.type + ' 문항의 답 꼴이 아니다');
    }
    var quizzes = map(c, 'quizzes', 'quizzes');
    Object.keys(quizzes).forEach(function (qid) {
      var q = quizzes[qid], qp = 'quizzes.' + qid;
      if (!itemId(qid, qp)) return;
      if (!isObj(q)) { err('E-TYPE', qp, '객체여야 한다'); return; }
      keys(q, KEYS.quiz, qp); counts.quizzes += 1;
      ref(q.unit, unitSet, qp + '.unit', '단원'); text(q, 'title', qp + '.title', false);
      var seen = {};
      list(q, 'items', qp + '.items', true).forEach(function (it, i) { counts.quiz_items += 1; quizItem(it, qp + '.items[' + i + ']', seen); });
    });
    var dseen = {};
    list(c, 'diagnostic', 'diagnostic', false).forEach(function (it, i) { counts.diagnostic += 1; quizItem(it, 'diagnostic[' + i + ']', dseen); });

    // ---- 실습
    var labs = map(c, 'labs', 'labs');
    Object.keys(labs).forEach(function (id) {
      var b = labs[id], bp = 'labs.' + id;
      if (!itemId(id, bp)) return;
      if (!isObj(b)) { err('E-TYPE', bp, '객체여야 한다'); return; }
      keys(b, KEYS.lab, bp); counts.labs += 1;
      text(b, 'title', bp + '.title', true); text(b, 'tier', bp + '.tier', false); text(b, 'env', bp + '.env', false); text(b, 'body', bp + '.body', false);
      ref(b.unit, unitSet, bp + '.unit', '단원'); int(b, 'minutes', bp + '.minutes', 1, 600, false);
      list(b, 'lessons', bp + '.lessons', false).forEach(function (l, i) { ref(l, lessons, bp + '.lessons[' + i + ']', '강의'); });
      var seen = {};
      list(b, 'checks', bp + '.checks', false).forEach(function (k, i) {
        var kp = bp + '.checks[' + i + ']';
        if (!isObj(k)) { err('E-TYPE', kp, '객체여야 한다'); return; }
        keys(k, KEYS.check, kp);
        if (itemId(k.id, kp + '.id')) { if (own(seen, k.id)) err('E-DUP', kp + '.id', '문항 ID 중복'); seen[k.id] = true; }
        text(k, 'q', kp + '.q', true); text(k, 'explain', kp + '.explain', false);
        var opts = list(k, 'options', kp + '.options', false);
        if (S.LAB_CHECK_TYPES.indexOf(k.type) < 0) { err('E-ENUM', kp + '.type', S.LAB_CHECK_TYPES.join('·')); return; }
        if (k.type === 'choice') { if (!opts.length || opts.indexOf(k.answer) < 0) err('E-ANSWER', kp + '.answer', '답이 보기에 없다'); return; }
        if (typeof k.answer !== 'string' || !k.answer.trim()) { err('E-ANSWER', kp + '.answer', '답이 비어 있다'); return; }
        if (k.type === 'regex') {
          var why = G.unsafeRegex(k.answer);
          if (!why) { try { G.compileLab(k.answer); } catch (e) { why = '컴파일되지 않는다'; } }
          if (why) err('E-REGEX', kp + '.answer', why);
        }
      });
    });

    // ---- 드릴
    var drills = map(c, 'drills', 'drills');
    Object.keys(drills).forEach(function (id) {
      var d = drills[id], dp = 'drills.' + id;
      if (!itemId(id, dp)) return;
      if (!isObj(d)) { err('E-TYPE', dp, '객체여야 한다'); return; }
      keys(d, KEYS.drill, dp); counts.drills += 1;
      text(d, 'title', dp + '.title', true); text(d, 'situation', dp + '.situation', true); text(d, 'debrief', dp + '.debrief', false);
      int(d, 'difficulty', dp + '.difficulty', 1, 5, false); int(d, 'minutes', dp + '.minutes', 1, 600, false); int(d, 'max_score', dp + '.max_score', 0, null, false);
      list(d, 'parts', dp + '.parts', false).forEach(function (p, i) { ref(p, partSet, dp + '.parts[' + i + ']', '영역'); });
      list(d, 'lessons', dp + '.lessons', false).forEach(function (l, i) { ref(l, lessons, dp + '.lessons[' + i + ']', '강의'); });
      var steps = map(d, 'steps', dp + '.steps');
      ref(d.start, steps, dp + '.start', '단계');
      Object.keys(steps).forEach(function (sid) {
        var s = steps[sid], sp = dp + '.steps.' + sid;
        if (!itemId(sid, sp)) return;
        if (!isObj(s)) { err('E-TYPE', sp, '객체여야 한다'); return; }
        keys(s, KEYS.step.concat(['id']), sp);
        if (own(s, 'id') && s.id !== sid) err('E-REF', sp + '.id', '키와 다르다');
        text(s, 'prompt', sp + '.prompt', true);
        var opts = list(s, 'options', sp + '.options', true);
        if (own(s, 'options') && !opts.length) err('E-EMPTY', sp + '.options', '선택지가 하나 이상');
        opts.forEach(function (o, i) {
          var op = sp + '.options[' + i + ']';
          if (!isObj(o)) { err('E-TYPE', op, '객체여야 한다'); return; }
          keys(o, KEYS.option, op);
          text(o, 'text', op + '.text', true); text(o, 'feedback', op + '.feedback', false); int(o, 'score', op + '.score', 0, null, true);
          if (o.next !== null && o.next !== undefined) ref(o.next, steps, op + '.next', '단계');
        });
      });
    });

    // ---- 용어
    var gseen = {};
    list(c, 'glossary', 'glossary', false).forEach(function (t, i) {
      var tp = 'glossary[' + i + ']';
      if (!isObj(t)) { err('E-TYPE', tp, '객체여야 한다'); return; }
      keys(t, KEYS.term, tp); counts.glossary += 1;
      if (itemId(t.id, tp + '.id')) { if (own(gseen, t.id)) err('E-DUP', tp + '.id', '용어 ID 중복'); gseen[t.id] = true; }
      text(t, 'term', tp + '.term', true); text(t, 'en', tp + '.en', false); text(t, 'short', tp + '.short', false);
      if (t.part !== undefined && t.part !== null) ref(t.part, partSet, tp + '.part', '영역');
      if (t.lesson !== undefined && t.lesson !== null) ref(t.lesson, lessons, tp + '.lesson', '강의');
    });

    // ---- 학습 계획
    var plans = map(c, 'plans', 'plans');
    Object.keys(plans).forEach(function (name) {
      var pl = plans[name], pp = 'plans.' + name;
      if (!itemId(name, pp)) return;
      if (!isObj(pl)) { err('E-TYPE', pp, '객체여야 한다'); return; }
      keys(pl, KEYS.plan, pp); counts.plans += 1;
      list(pl, 'weeks', pp + '.weeks', true).forEach(function (w, wi) {
        var wp = pp + '.weeks[' + wi + ']';
        if (!isObj(w)) { err('E-TYPE', wp, '객체여야 한다'); return; }
        keys(w, KEYS.week, wp);
        int(w, 'week', wp + '.week', 1, null, true); text(w, 'theme', wp + '.theme', true);
        if (w.drill !== null && w.drill !== undefined) ref(w.drill, drills, wp + '.drill', '드릴');
        list(w, 'days', wp + '.days', true).forEach(function (d, di) {
          var dp = wp + '.days[' + di + ']';
          if (!isObj(d)) { err('E-TYPE', dp, '객체여야 한다'); return; }
          keys(d, KEYS.day, dp);
          int(d, 'day', dp + '.day', 1, 7, true);
          ref(d.lesson, lessons, dp + '.lesson', '강의');
          if (d.lab !== null && d.lab !== undefined) ref(d.lab, labs, dp + '.lab', '실습');
        });
      });
    });
    if (c.default_plan !== null && c.default_plan !== undefined) ref(c.default_plan, plans, 'default_plan', '계획');

    // ---- 그림(렌더러가 과정 안의 그림만 쓴다 — FR-252)
    var assets = map(c, 'assets', 'assets');
    Object.keys(assets).forEach(function (name) {
      if (!itemId(name, 'assets.' + name)) return;
      if (typeof assets[name] !== 'string' || !DATA_IMAGE.test(assets[name])) err('E-TYPE', 'assets.' + name, 'data:image/png·jpeg·gif·webp;base64 만');
    });
    return done();
  }

  // ---- 색인(검사를 통과한 과정에 쓴다). 같은 객체면 다시 만들지 않는다
  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function index(c) {
    if (cache && cache.has(c)) return cache.get(c);
    var tocLessons = [], unitOfLesson = {}, partOfUnit = {}, unitIds = [], units = {};
    (c.parts || []).forEach(function (p) {
      (p.units || []).forEach(function (u) {
        unitIds.push(u.id); units[u.id] = u; partOfUnit[u.id] = p.id;
        (u.lessons || []).forEach(function (lid) { tocLessons.push(lid); unitOfLesson[lid] = u.id; });
      });
    });
    function byId(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
    var cardsByLesson = {};
    Object.keys(c.cards || {}).sort(byId).forEach(function (cid) { var l = c.cards[cid].lesson; (cardsByLesson[l] = cardsByLesson[l] || []).push(cid); });
    var labsByLesson = {}, labsByUnit = {};
    Object.keys(c.labs || {}).sort(byId).forEach(function (id) {
      var b = c.labs[id];
      (labsByUnit[b.unit] = labsByUnit[b.unit] || []).push(id);
      (b.lessons || []).forEach(function (l) { (labsByLesson[l] = labsByLesson[l] || []).push(id); });
    });
    var quizzesByUnit = {};
    Object.keys(c.quizzes || {}).sort(byId).forEach(function (id) { var u = c.quizzes[id].unit; (quizzesByUnit[u] = quizzesByUnit[u] || []).push(id); });
    var plans = c.plans || {};
    function planOf(variant) {
      if (own(plans, variant)) return plans[variant];
      if (c.default_plan && own(plans, c.default_plan)) return plans[c.default_plan];
      var names = Object.keys(plans).sort(byId);
      return names.length ? plans[names[0]] : null;
    }
    var seqCache = {};
    function sequence(variant) {
      var plan = planOf(variant);
      var key = plan ? JSON.stringify([variant]) : '';
      if (own(seqCache, key)) return seqCache[key];
      var seq = [];
      if (plan) plan.weeks.forEach(function (w) { w.days.forEach(function (d) { seq.push(d.lesson); }); });
      else seq = tocLessons.slice();
      seqCache[key] = seq;
      return seq;
    }
    function weekOf(variant, lid) {
      var plan = planOf(variant);
      if (!plan) return null;
      for (var i = 0; i < plan.weeks.length; i++) if (plan.weeks[i].days.some(function (d) { return d.lesson === lid; })) return plan.weeks[i];
      return null;
    }
    var ix = {
      tocLessons: tocLessons, unitIds: unitIds, units: units,
      unitOf: function (lid) { return unitOfLesson[lid] || null; },
      partOf: function (uid) { return partOfUnit[uid] || null; },
      cardsOf: function (lid) { return cardsByLesson[lid] || []; },
      labsOf: function (lid) { return labsByLesson[lid] || []; },
      labsOfUnit: function (uid) { return labsByUnit[uid] || []; },
      quizzesOfUnit: function (uid) { return quizzesByUnit[uid] || []; },
      planOf: planOf, sequence: sequence, weekOf: weekOf
    };
    if (cache) cache.set(c, ix);
    return ix;
  }

  return { validate: validate, index: index };
});
