// 등급 A — web/core/replay.js (FR-224·225). 사례 번호는 docs/P2_설계서_Core.md 3.4절 표. 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core, fixture } = require('./helpers');
const L = core('log'), R = core('replay'), S = core('srs');

let seqs = {};
function at(dev, day, hh, type, extra) {
  seqs[dev] = (Object.prototype.hasOwnProperty.call(seqs, dev) ? seqs[dev] : 0) + 1;   // 기기 이름이 'constructor' 여도
  return L.make(Object.assign({ dev: dev, seq: seqs[dev], t: day + 'T' + String(hh).padStart(2, '0') + ':00:00.000Z', day: day, type: type }, extra));
}
function rv(dev, day, grade, hh, card) { return at(dev, day, hh === undefined ? 1 : hh, 'review', { course: 'c', card: card || 'k1', grade: grade }); }
function run(events, today) { seqs = {}; return R.run(L.merge([events.map((e) => e.line)]).events, { today: today || '2026-12-31' }); }
function card(state, id) { return state.cards.c[id || 'k1']; }
function single(grades, start) { let st = S.newCardState(); let d = start; for (const g of grades) { st = S.review(st, g, d); d = st.due; } return st; }

test('1 한 기기가 늘 due 날 복습 — MWL 골든 벡터 12가지와 같다', () => {
  const v = fixture('mwl/srs_vectors.json');
  for (const c of v.cases) {
    seqs = {};
    let day = v.start; const evs = []; let st = S.newCardState();
    for (const g of c.grades) { evs.push(rv('a', day, g)); st = S.review(st, g, day); day = st.due; }
    const got = card(R.run(L.merge([evs.map((e) => e.line)]).events, { today: '2099-01-01' }));
    assert.deepEqual(got, st, c.name);
    assert.equal(got.due, c.states[c.states.length - 1].due, c.name);
  }
});

test('2 두 기기가 같은 due 날 good·good — 간격은 한 번만 자란다', () => {
  seqs = {};
  const ev = [rv('a', '2026-01-01', 'good'), rv('a', '2026-01-02', 'good'),          // A: due 01-05
    rv('b', '2026-01-01', 'good', 2), rv('b', '2026-01-02', 'good', 2)];           // B 도 같은 날 같은 등급(합치지 않은 채)
  const st = run(ev);
  assert.deepEqual(card(st), single(['good', 'good'], '2026-01-01'));
  assert.equal(st.counts.early, 2);
  assert.deepEqual(st.reviews.map((r) => r.applied), [true, false, true, false]);
});

test('3 새 카드를 두 기기가 같은 날 처음 good·good — 앞의 것만', () => {
  const st = run([rv('b', '2026-01-01', 'good', 5), rv('a', '2026-01-01', 'good', 4)]);
  assert.equal(card(st).reps, 1);
  assert.equal(card(st).due, '2026-01-02');
  assert.equal(st.counts.early, 1);
});

test('4 A 가 due 날 good, B 가 A 의 새 due 전에 good — B 는 이른 복습', () => {
  const st = run([rv('a', '2026-01-01', 'good'), rv('a', '2026-01-02', 'good'), rv('b', '2026-01-04', 'good')]);
  assert.equal(card(st).due, '2026-01-05');
  assert.equal(st.counts.early, 1);
});

test('5 A 가 due 날 good, B 가 A 의 새 due 전에 again — again 은 반영', () => {
  const st = run([rv('a', '2026-01-01', 'good'), rv('a', '2026-01-02', 'good'), rv('b', '2026-01-03', 'again')]);
  assert.equal(card(st).lapses, 1);
  assert.equal(card(st).due, '2026-01-04');
  assert.equal(st.counts.early, 0);
});

test('6 같은 날 A again·B good — 어느 순서든 again 상태로 끝난다', () => {
  function scenario(aHour, bHour) {
    seqs = {};
    const base = [rv('a', '2026-01-01', 'good'), rv('a', '2026-01-02', 'good'), rv('a', '2026-01-05', 'good')];   // due 01-13
    return run(base.concat([rv('a', '2026-01-13', 'again', aHour), rv('b', '2026-01-13', 'good', bHour)]));
  }
  const x = scenario(3, 9);
  const y = scenario(9, 3);
  for (const st of [x, y]) {
    const c = card(st);
    assert.equal(c.reps, 0); assert.equal(c.interval, 1); assert.equal(c.ef, 2.3); assert.equal(c.due, '2026-01-14');
  }
});

test('6b 같은 날 again 이 두 번 오면 한 번만 반영한다(두 기기가 같은 날 틀림)', () => {
  const st = run([rv('a', '2026-01-01', 'good'), rv('a', '2026-01-02', 'again', 1), rv('b', '2026-01-02', 'again', 2)]);
  assert.equal(card(st).lapses, 1);
  assert.equal(card(st).ef, 2.3);
  assert.equal(st.counts.early, 1);
  // 다른 날의 again 은 이른 복습이어도 반영한다
  const st2 = run([rv('a', '2026-01-01', 'good'), rv('a', '2026-01-02', 'good'), rv('b', '2026-01-03', 'again'), rv('a', '2026-01-03', 'easy', 9)]);
  assert.equal(card(st2).lapses, 1);
  assert.equal(st2.counts.early, 1);
});

test('7 계산하는 날 +1 보다 뒤의 사건은 빼고 future 로', () => {
  seqs = {};
  const evs = [rv('a', '2026-01-01', 'good'), rv('a', '2026-01-02', 'good'), rv('a', '2026-01-05', 'good'), rv('a', '2027-06-01', 'easy')];
  const st = R.run(L.merge([evs.map((e) => e.line)]).events, { today: '2026-01-04' });
  assert.equal(card(st).reps, 3);          // 01-05 는 내일이라 받는다
  assert.equal(st.future.length, 1);
  assert.equal(st.future[0].day, '2027-06-01');
  assert.equal(st.counts.future, 1);
  const later = R.run(L.merge([evs.map((e) => e.line)]).events, { today: '2027-06-01' });
  assert.equal(later.future.length, 0);
  assert.equal(card(later).reps, 4);
});

test('8 한 기기의 학습일이 순번을 따라 뒤로 가면 시계 이상으로 센다', () => {
  const st = run([rv('a', '2026-01-10', 'good'), rv('a', '2026-01-05', 'good', 1, 'k2'), rv('b', '2026-01-01', 'good', 1, 'k3')]);
  assert.equal(st.counts.clock_back, 1);
  assert.ok(card(st, 'k2'));
});

function state(fields) { return Object.assign({ ef: 2.36, interval: 8, reps: 3, lapses: 1, due: '2026-02-10', last: '2026-02-02', grades: [0, 2, 2] }, fields || {}); }
function imp(day, st) { return at('mwl-00000000000a', day, 0, 'card.state', { course: 'c', card: 'k1', state: st, src: 'mwl' }); }

test('9 card.state 뒤의 복습은 그 상태에서 이어진다(S5)', () => {
  const st = run([imp('2026-02-02', state()), rv('a', '2026-02-10', 'good')]);
  assert.deepEqual(card(st), S.review(state(), 'good', '2026-02-10'));
  assert.equal(st.counts.imported, 1);
});

test('10 card.state 의 날까지의 다른 복습은 그 상태가 덮는다', () => {
  const st = run([rv('a', '2026-02-01', 'easy'), rv('a', '2026-02-02', 'again', 23), imp('2026-02-02', state())]);
  assert.deepEqual(card(st), state());
});

test('11 모르는 종류·꼴이 틀린 알려진 종류는 계산하지 않고 센다', () => {
  const ev = [at('a', '2026-01-01', 1, 'future.kind', { x: 1 }), at('a', '2026-01-01', 1, 'review', { course: 'c', card: 'k1', grade: 'great' }),
    at('a', '2026-01-01', 1, 'review', { course: 'C!', card: 'k1', grade: 'good' }), at('a', '2026-01-01', 1, 'card.state', { course: 'c', card: 'k1', state: { ef: 1 } }),
    at('a', '2026-01-01', 1, 'lesson', { course: 'c', lesson: 'L1' }), at('a', '2026-01-01', 1, 'setting', { key: 'Bad Key', value: 1 })];
  const st = run(ev);
  assert.equal(st.counts.unknown, 1);
  assert.equal(st.counts.invalid, 5);
  assert.deepEqual(st.cards, {});
});

test('그 밖의 사건 — 강의·실습·드릴·퀴즈·점검·학습 시간·일지·보류·설정', () => {
  const ev = [   // 기기마다 학습일 순서로 만든다(순번 순서 = 시간 순서)
    at('a', '2026-03-01', 1, 'lesson', { course: 'c', lesson: 'L1', done: true, confidence: 3 }),
    at('a', '2026-03-01', 2, 'lab', { course: 'c', lab: 'LAB-1', done: true, score: 2, total: 3, notes: 'n' }),
    at('a', '2026-03-01', 3, 'drill', { course: 'c', drill: 'DR-01', score: 10, max: 20, path: ['s1'] }),
    at('a', '2026-03-01', 4, 'quiz', { course: 'c', quiz: 'QZ-1', score: 80, answers: { q1: 'a' } }),
    at('a', '2026-03-01', 5, 'check', { course: 'c', mode: 'baseline', scores: { A: 40 }, total: 40, items: [] }),
    at('a', '2026-03-01', 6, 'session', { minutes: 20, reviewed: 0, course: 'c', lesson: 'L1' }),
    at('b', '2026-03-01', 7, 'session', { minutes: 5, reviewed: 12 }),
    at('a', '2026-03-01', 8, 'journal', { course: 'c', summary: 's', teach: 'L1 을 가르쳤다' }),
    at('a', '2026-03-01', 9, 'card.hold', { course: 'c', card: 'k9', on: true, why: 'wrong' }),
    at('a', '2026-03-01', 10, 'card.hold', { course: 'c', card: 'k8', on: true }),
    at('a', '2026-03-01', 11, 'setting', { key: 'main_course', value: 'c' }),
    at('a', '2026-03-02', 1, 'lesson', { course: 'c', lesson: 'L2', done: true }),
    at('a', '2026-03-02', 1, 'session', { minutes: 3, reviewed: 1, lab: 'LAB-1' }),
    at('a', '2026-03-02', 2, 'card.hold', { course: 'c', card: 'k8', on: false }),
    at('b', '2026-03-02', 11, 'setting', { key: 'main_course', value: 'd' }),
    at('a', '2026-03-03', 1, 'lesson', { course: 'c', lesson: 'L2', done: false }),
  ];
  const st = run(ev);
  assert.deepEqual(st.lessons.c, { L1: { done: true, done_at: '2026-03-01', confidence: 3 }, L2: { done: false, done_at: null, confidence: null } });
  assert.deepEqual(st.labs.c['LAB-1'], { done: true, done_at: '2026-03-01', score: 2, total: 3, notes: 'n' });
  assert.deepEqual(st.drills, [{ course: 'c', id: 'DR-01', score: 10, max: 20, at: '2026-03-01', path: ['s1'] }]);
  assert.deepEqual(st.quizzes, [{ course: 'c', id: 'QZ-1', score: 80, at: '2026-03-01', answers: { q1: 'a' } }]);
  assert.deepEqual(st.checks, [{ course: 'c', at: '2026-03-01', mode: 'baseline', scores: { A: 40 }, total: 40, items: [] }]);
  assert.deepEqual(st.sessions, [{ date: '2026-03-01', minutes: 25, reviewed: 12, lesson: 'L1', lab: null },
    { date: '2026-03-02', minutes: 3, reviewed: 1, lesson: null, lab: 'LAB-1' }]);
  assert.deepEqual(st.journal, [{ course: 'c', date: '2026-03-01', summary: 's', apply: '', unclear: '', teach: 'L1 을 가르쳤다' }]);
  assert.deepEqual(st.held, { c: { k9: true } });
  assert.equal(st.settings.main_course, 'd');
  assert.equal(st.counts.invalid, 0);
  assert.equal(st.counts.clock_back, 0);
});

test('today 를 주지 않으면 미래 사건을 가르지 않는다 · 빈 목록', () => {
  const st = R.run([], {});
  assert.deepEqual(st.cards, {});
  assert.equal(st.counts.events, 0);
  seqs = {};
  const one = R.run(L.merge([[rv('a', '2099-01-01', 'good').line]]).events);
  assert.equal(one.future.length, 0);
  assert.equal(card(one).reps, 1);
});

test('독립 점검 F5 — 상속 이름 ID(toString·constructor)도 보통 카드처럼, 전역을 건드리지 않는다, __proto__ 설정은 받지 않는다', () => {
  seqs = {};
  const st = run([rv('a', '2026-01-01', 'good', 1, 'toString'), at('a', '2026-01-01', 2, 'review', { course: 'constructor', card: 'hasOwnProperty', grade: 'good' }),
    at('a', '2026-01-01', 3, 'lesson', { course: 'constructor', lesson: 'valueOf', done: true }),
    at('a', '2026-01-01', 4, 'setting', { key: '__proto__', value: { ghost: 1 } }), at('a', '2026-01-01', 5, 'setting', { key: 'constructor', value: 3 })]);
  assert.deepEqual(st.cards.c.toString, S.review(S.newCardState(), 'good', '2026-01-01'));
  assert.deepEqual(st.cards.constructor.hasOwnProperty, S.review(S.newCardState(), 'good', '2026-01-01'));
  assert.equal(st.lessons.constructor.valueOf.done, true);
  assert.equal(Object.prototype.hasOwnProperty.call(Object, 'hasOwnProperty'), false, 'Object 에 쓰지 않았다');
  assert.equal(st.settings.ghost, undefined);
  assert.equal(st.settings.constructor, 3);
  assert.equal(st.counts.invalid, 1);
  seqs = {};
  const u = run([at('a', '2026-01-01', 1, 'constructor', {}), at('constructor', '2026-01-01', 1, 'constructor', {})]);
  assert.equal(u.counts.unknown, 2, '상속 이름 종류는 모르는 종류로 센다(기기 이름이 constructor 여도)');
});

test('그날 합계 세션(total) — 같은 기기·같은 날 합계가 또 오면 늘어난 만큼만', () => {
  seqs = {};
  const st = run([at('m', '2026-02-01', 0, 'session', { minutes: 50, reviewed: 10, total: true }), at('m', '2026-02-01', 0, 'session', { minutes: 70, reviewed: 12, total: true }),
    at('m', '2026-02-01', 0, 'session', { minutes: 60, reviewed: 15, total: true }), at('a', '2026-02-01', 9, 'session', { minutes: 5, reviewed: 1 }),
    at('n', '2026-02-01', 0, 'session', { minutes: 10, reviewed: 1, total: true })]);
  assert.deepEqual(st.sessions[0], { date: '2026-02-01', minutes: 85, reviewed: 17, lesson: null, lab: null });
  seqs = {};
  assert.equal(run([at('m', '2026-02-01', 0, 'session', { minutes: 1, reviewed: 1, total: 'yes' })]).counts.invalid, 1);
});
