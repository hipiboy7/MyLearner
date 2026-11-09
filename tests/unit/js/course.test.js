// 등급 A — web/core/course.js (FR-210~212). 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers');
const K = core('course');

function base() {
  return {
    format: 'mylearner-course', version: 1, min_reader: 1, id: 'demo', title: '데모', kind: 'course', lang: 'ko', confidence: 'likely',
    readonly: false, origin: { type: 'user', ref: 'test', hash: '' }, default_plan: 'default', summary: '',
    parts: [{ id: 'A', title: '영역', code: 'A', summary: '', units: [{ id: 'A1', title: '단원', goal: '', lessons: ['A1-1', 'A1-2'] }] },
      { id: 'B', title: '영역2', units: [{ id: 'B1', title: '단원2', lessons: ['B1-1'] }] }],
    lessons: {
      'A1-1': { title: '첫', minutes: 20, level: 1, prereqs: [], tags: ['t'], confidence: 'verified', sources: ['s'], body: '## 결론\n본문' },
      'A1-2': { title: '둘', minutes: 15, level: 2, prereqs: ['A1-1'], tags: [], confidence: 'likely', sources: [], body: '' },
      'B1-1': { title: '셋', minutes: 10, level: 1, prereqs: [], tags: [], confidence: 'unverified', sources: [], body: 'x' } },
    cards: { 'A1-1-c01': { lesson: 'A1-1', type: 'concept', q: 'Q', a: 'A', hint: '', tags: [], difficulty: 1 },
      'A1-1-c02': { lesson: 'A1-1', type: 'command', q: 'Q2', a: 'A2' }, 'B1-1-c01': { lesson: 'B1-1', type: 'concept', q: 'q', a: 'a' } },
    quizzes: { 'QZ-A1': { unit: 'A1', items: [
      { id: 'q1', type: 'mcq', q: '?', options: ['a', 'b'], answer: 'a', explain: '', lesson: 'A1-1' },
      { id: 'q2', type: 'multi', q: '?', options: ['a', 'b', 'c'], answer: ['a', 'c'], explain: '', lesson: 'A1-1' },
      { id: 'q3', type: 'order', q: '?', options: ['x', 'y'], answer: ['y', 'x'], explain: '', lesson: 'A1-2' },
      { id: 'q4', type: 'short', q: '?', options: [], answer: '답', explain: '', lesson: 'A1-2' }] } },
    labs: { 'LAB-A1-1': { title: '실습', tier: 'L1', unit: 'A1', lessons: ['A1-1'], minutes: 15, env: 'docker', body: 'b',
      checks: [{ id: 'c1', q: '?', type: 'choice', options: ['a', 'b'], answer: 'b', explain: '' }, { id: 'c2', q: '?', type: 'regex', options: [], answer: 'Launcher-\\d+', explain: '' },
        { id: 'c3', q: '?', type: 'text', options: [], answer: 'ok', explain: '' }] } },
    drills: { 'DR-01': { title: '드릴', parts: ['A'], difficulty: 1, minutes: 15, lessons: ['A1-1'], situation: '상황', start: 's1', max_score: 20, debrief: '',
      steps: { s1: { prompt: '1', options: [{ text: '좋음', next: 's2', score: 10, feedback: '' }] }, s2: { prompt: '2', options: [{ text: '끝', next: null, score: 10, feedback: '' }] } } } },
    glossary: [{ id: 'T-001', term: '용어', en: 'term', short: '짧게', part: 'A', lesson: 'A1-1' }, { id: 'T-002', term: '용어2', en: '', short: '', part: 'B', lesson: null }],
    diagnostic: [{ id: 'dg-01', type: 'mcq', q: '?', options: ['a', 'b'], answer: 'b', explain: '', lesson: 'B1-1' }],
    plans: { default: { weeks: [{ week: 1, theme: '테마', drill: 'DR-01', days: [{ day: 1, lesson: 'A1-1', lab: 'LAB-A1-1' }, { day: 2, lesson: 'B1-1', lab: null }, { day: 3, lesson: 'A1-2' }] }] },
      short: { weeks: [{ week: 1, theme: '짧게', days: [{ day: 1, lesson: 'B1-1' }] }] } },
    assets: { 'fig.png': 'data:image/png;base64,iVBORw0KGgo=' },
  };
}
function codes(r) { return r.errors.map((e) => e.code + ' ' + e.path).sort(); }
function mutate(fn) { const c = base(); fn(c); return K.validate(c); }

test('맞는 과정 — 오류·경고 0, 개수', () => {
  const r = K.validate(base());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { parts: 2, units: 2, lessons: 3, cards: 3, quizzes: 1, quiz_items: 4, labs: 1, drills: 1, glossary: 2, diagnostic: 1, plans: 2 });
  // 선택 묶음이 없어도 된다
  const min = { format: 'mylearner-course', version: 1, min_reader: 1, id: 'm', title: 'm', kind: 'notes', parts: [], lessons: {} };
  assert.equal(K.validate(min).ok, true);
});

test('머리 — 형식·판·읽는 쪽 판', () => {
  assert.deepEqual(codes(mutate((c) => { c.format = 'other'; })), ['E-FORMAT format']);
  assert.deepEqual(codes(mutate((c) => { c.version = '1'; })), ['E-VERSION version']);
  assert.deepEqual(codes(mutate((c) => { c.min_reader = 2; c.version = 2; })), ['E-READER min_reader']);
  assert.deepEqual(codes(mutate((c) => { c.min_reader = 3; c.version = 2; })), ['E-READER min_reader']);
  assert.equal(K.validate(null).errors[0].code, 'E-TYPE');
  assert.equal(K.validate([]).errors[0].code, 'E-TYPE');
  // 판이 높아도 min_reader 가 맞으면 읽는다(모르는 키는 경고)
  const r = mutate((c) => { c.version = 3; c.future_block = {}; });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.map((w) => w.code + ' ' + w.path), ['W-UNKNOWN future_block']);
});

test('ID 규칙·중복·없는 것을 가리킴', () => {
  assert.deepEqual(codes(mutate((c) => { c.id = 'Demo'; })), ['E-ID id']);
  assert.deepEqual(codes(mutate((c) => { c.parts[1].units[0].id = 'A1'; })), ['E-DUP parts[1].units[0].id']);
  assert.deepEqual(codes(mutate((c) => { c.parts[1].units[0].lessons.push('A1-1'); })), ['E-DUP parts[1].units[0].lessons[1]']);
  assert.deepEqual(codes(mutate((c) => { c.parts[0].units[0].lessons.push('Z9-9'); })), ['E-REF parts[0].units[0].lessons[2]']);
  assert.deepEqual(codes(mutate((c) => { c.cards['bad id'] = { lesson: 'A1-1', type: 'concept', q: 'q', a: 'a' }; })), ['E-ID cards.bad id']);
  assert.deepEqual(codes(mutate((c) => { c.cards['A1-1-c01'].lesson = 'nope'; })), ['E-REF cards.A1-1-c01.lesson']);
  assert.deepEqual(codes(mutate((c) => { c.lessons['A1-2'].prereqs = ['nope']; })), ['E-REF lessons.A1-2.prereqs[0]']);
  assert.deepEqual(codes(mutate((c) => { c.quizzes['QZ-A1'].unit = 'Z1'; })), ['E-REF quizzes.QZ-A1.unit']);
  assert.deepEqual(codes(mutate((c) => { c.labs['LAB-A1-1'].lessons = ['A1-1', 'x']; })), ['E-REF labs.LAB-A1-1.lessons[1]']);
  assert.deepEqual(codes(mutate((c) => { c.drills['DR-01'].steps.s1.options[0].next = 's9'; })), ['E-REF drills.DR-01.steps.s1.options[0].next']);
  assert.deepEqual(codes(mutate((c) => { c.drills['DR-01'].start = 's9'; })), ['E-REF drills.DR-01.start']);
  assert.deepEqual(codes(mutate((c) => { c.drills['DR-01'].parts = ['Q']; })), ['E-REF drills.DR-01.parts[0]']);
  assert.deepEqual(codes(mutate((c) => { c.plans.default.weeks[0].days[0].lab = 'LAB-9'; })), ['E-REF plans.default.weeks[0].days[0].lab']);
  assert.deepEqual(codes(mutate((c) => { c.plans.default.weeks[0].drill = 'DR-9'; })), ['E-REF plans.default.weeks[0].drill']);
  assert.deepEqual(codes(mutate((c) => { c.default_plan = 'none'; })), ['E-REF default_plan']);
  assert.deepEqual(codes(mutate((c) => { c.glossary[1].id = 'T-001'; })), ['E-DUP glossary[1].id']);
  assert.deepEqual(codes(mutate((c) => { c.glossary[0].part = 'Q'; })), ['E-REF glossary[0].part']);
  assert.deepEqual(codes(mutate((c) => { c.quizzes['QZ-A1'].items[1].id = 'q1'; })), ['E-DUP quizzes.QZ-A1.items[1].id']);
  assert.deepEqual(codes(mutate((c) => { c.diagnostic[0].lesson = 'x'; })), ['E-REF diagnostic[0].lesson']);
});

test('값의 꼴·범위·정해진 값', () => {
  assert.deepEqual(codes(mutate((c) => { c.kind = 'book'; })), ['E-ENUM kind']);
  assert.deepEqual(codes(mutate((c) => { c.title = ' '; })), ['E-EMPTY title']);
  assert.deepEqual(codes(mutate((c) => { c.confidence = 'sure'; })), ['E-ENUM confidence']);
  assert.deepEqual(codes(mutate((c) => { c.lessons['A1-1'].minutes = 0; })), ['E-RANGE lessons.A1-1.minutes']);
  assert.deepEqual(codes(mutate((c) => { c.lessons['A1-1'].body = 3; })), ['E-TYPE lessons.A1-1.body']);
  assert.deepEqual(codes(mutate((c) => { c.lessons['A1-1'].tags = 'x'; })), ['E-TYPE lessons.A1-1.tags']);
  assert.deepEqual(codes(mutate((c) => { c.cards['A1-1-c01'].q = ''; })), ['E-EMPTY cards.A1-1-c01.q']);
  assert.deepEqual(codes(mutate((c) => { c.cards['A1-1-c01'].difficulty = 9; })), ['E-RANGE cards.A1-1-c01.difficulty']);
  assert.deepEqual(codes(mutate((c) => { c.cards['A1-1-c01'].type = 'Concept!'; })), ['E-ENUM cards.A1-1-c01.type']);
  assert.ok(codes(mutate((c) => { c.parts = {}; })).includes('E-TYPE parts'));
  assert.deepEqual(codes(mutate((c) => { c.readonly = 'yes'; })), ['E-TYPE readonly']);
  assert.deepEqual(codes(mutate((c) => { c.plans.default.weeks[0].days[0].day = 8; })), ['E-RANGE plans.default.weeks[0].days[0].day']);
  assert.deepEqual(codes(mutate((c) => { c.assets['x.svg'] = 'data:image/svg+xml;base64,PHN2Zz4='; })), ['E-TYPE assets.x.svg']);
});

test('답 — 문항 꼴과 맞아야 한다', () => {
  const q = (i, v) => mutate((c) => { Object.assign(c.quizzes['QZ-A1'].items[i], v); });
  assert.deepEqual(codes(q(0, { answer: 'z' })), ['E-ANSWER quizzes.QZ-A1.items[0].answer']);
  assert.deepEqual(codes(q(0, { options: ['a'] })), ['E-ANSWER quizzes.QZ-A1.items[0].answer']);
  assert.deepEqual(codes(q(1, { answer: [] })), ['E-ANSWER quizzes.QZ-A1.items[1].answer']);
  assert.deepEqual(codes(q(1, { answer: ['a', 'z'] })), ['E-ANSWER quizzes.QZ-A1.items[1].answer']);
  assert.deepEqual(codes(q(2, { answer: ['x', 'x'] })), ['E-ANSWER quizzes.QZ-A1.items[2].answer']);
  assert.deepEqual(codes(q(3, { answer: '' })), ['E-ANSWER quizzes.QZ-A1.items[3].answer']);
  assert.deepEqual(codes(q(3, { type: 'essay' })), ['E-ENUM quizzes.QZ-A1.items[3].type']);
  const l = (i, v) => mutate((c) => { Object.assign(c.labs['LAB-A1-1'].checks[i], v); });
  assert.deepEqual(codes(l(0, { answer: 'z' })), ['E-ANSWER labs.LAB-A1-1.checks[0].answer']);
  assert.deepEqual(codes(l(2, { answer: '' })), ['E-ANSWER labs.LAB-A1-1.checks[2].answer']);
  assert.deepEqual(codes(l(1, { answer: '(a)\\1' })), ['E-REGEX labs.LAB-A1-1.checks[1].answer']);
  assert.deepEqual(codes(l(1, { answer: '([' })), ['E-REGEX labs.LAB-A1-1.checks[1].answer']);
  assert.deepEqual(codes(l(1, { answer: 'a)|(b' })), ['E-REGEX labs.LAB-A1-1.checks[1].answer'], '감싸개를 닫는 패턴(독립 점검 ② F5)');
  assert.deepEqual(codes(l(1, { answer: '(a+)+' })), [], '겹친 반복도 이제 선형으로 맞춰 보므로 받는다');
});

test('경고 — 모르는 키는 지우지 않고 알린다, 목차에 없는 강의', () => {
  const c = base();
  c.lessons['A1-1'].mood = 'x';
  c.lessons['X1-1'] = { title: '고아', minutes: 5, level: 1, prereqs: [], tags: [], confidence: 'likely', sources: [], body: '' };
  const r = K.validate(c);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.map((w) => w.code + ' ' + w.path).sort(), ['W-ORPHAN lessons.X1-1', 'W-UNKNOWN lessons.A1-1.mood']);
  assert.equal(c.lessons['A1-1'].mood, 'x');
});

test('오류는 200개까지 담고 수는 모두 센다', () => {
  const c = base();
  for (let i = 0; i < 300; i++) c.cards['Z-' + i] = { lesson: 'none', type: 'concept', q: 'q', a: 'a' };
  const r = K.validate(c);
  assert.equal(r.errors.length, 200);
  assert.equal(r.error_count, 300);
});

test('index — 학습 순서·단원·카드·실습·퀴즈·주', () => {
  const c = base();
  const ix = K.index(c);
  assert.equal(ix, K.index(c), '같은 객체면 다시 만들지 않는다');
  assert.deepEqual(ix.tocLessons, ['A1-1', 'A1-2', 'B1-1']);
  assert.deepEqual(ix.sequence('default'), ['A1-1', 'B1-1', 'A1-2']);
  assert.deepEqual(ix.sequence('short'), ['B1-1']);
  assert.deepEqual(ix.sequence('nope'), ['A1-1', 'B1-1', 'A1-2'], '없는 변형 → default_plan');
  assert.equal(ix.unitOf('A1-2'), 'A1');
  assert.equal(ix.partOf('A1'), 'A');
  assert.deepEqual(ix.cardsOf('A1-1'), ['A1-1-c01', 'A1-1-c02']);
  assert.deepEqual(ix.labsOf('A1-1'), ['LAB-A1-1']);
  assert.deepEqual(ix.labsOfUnit('A1'), ['LAB-A1-1']);
  assert.deepEqual(ix.quizzesOfUnit('A1'), ['QZ-A1']);
  assert.deepEqual(ix.unitIds, ['A1', 'B1']);
  assert.equal(ix.weekOf('default', 'B1-1').week, 1);
  assert.equal(ix.weekOf('default', 'zz'), null);
  const noPlan = base(); delete noPlan.plans; noPlan.default_plan = null;
  assert.deepEqual(K.index(noPlan).sequence('default'), ['A1-1', 'A1-2', 'B1-1'], '계획이 없으면 목차 순');
  const firstPlan = base(); firstPlan.default_plan = null;
  assert.deepEqual(K.index(firstPlan).sequence('x'), ['A1-1', 'B1-1', 'A1-2'], 'default_plan 이 없으면 첫 계획(이름 순)');
});
