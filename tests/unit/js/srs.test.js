// 등급 A — web/core/srs.js (FR-230). MWL 골든 벡터 tests/fixtures/mwl/srs_vectors.json(MiddlewareLearner@e55b9c0). 시험 먼저.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core, fixture } = require('./helpers');
const S = core('srs');

test('MWL srs_vectors 12가지를 그대로 낸다', () => {
  const v = fixture('mwl/srs_vectors.json');
  assert.equal(v.cases.length, 12);
  for (const c of v.cases) {
    let st = S.newCardState(); let day = v.start; const got = [];
    for (const g of c.grades) {
      st = S.review(st, g, day);
      got.push({ ef: st.ef, interval: st.interval, reps: st.reps, lapses: st.lapses, due: st.due });
      day = st.due;
    }
    assert.deepEqual(got, c.states, c.name);
  }
});

test('review — 등급 기록은 20개까지, 모르는 등급은 거부, 원래 상태를 바꾸지 않는다', () => {
  let st = S.newCardState();
  const first = st;
  for (let i = 0; i < 25; i++) st = S.review(st, 'good', '2026-01-01');
  assert.equal(st.grades.length, 20);
  assert.deepEqual(first, S.newCardState());
  assert.throws(() => S.review(st, 'great', '2026-01-01'), /등급/);
  assert.equal(S.review(S.newCardState(), 'easy', '2026-01-01').last, '2026-01-01');
});

test('isDue·retention', () => {
  const st = S.review(S.newCardState(), 'good', '2026-01-01');
  assert.equal(S.isDue(st, '2026-01-01'), false);
  assert.equal(S.isDue(st, '2026-01-02'), true);
  assert.equal(S.isDue(S.newCardState(), '2026-01-02'), false);
  assert.equal(S.retention(S.newCardState()), null);
  assert.equal(S.retention({ grades: [0, 2, 3, 1] }), 2 / 3);
  assert.equal(S.retention({ grades: [0, 2, 3, 1] }, 2), 0.5);
});

test('validState — card.state 사건에 담을 수 있는 꼴', () => {
  const st = S.review(S.newCardState(), 'good', '2026-01-01');
  assert.equal(S.validState(st), true);
  assert.equal(S.validState(S.newCardState()), true);
  for (const bad of [null, {}, Object.assign({}, st, { ef: 1.2 }), Object.assign({}, st, { ef: 'x' }), Object.assign({}, st, { interval: -1 }),
    Object.assign({}, st, { reps: 1.5 }), Object.assign({}, st, { due: '2026-02-30' }), Object.assign({}, st, { grades: [4] }),
    Object.assign({}, st, { grades: new Array(21).fill(2) }), Object.assign({}, st, { lapses: true }), Object.assign({}, st, { interval: 40000 })])
    assert.equal(S.validState(bad), false, JSON.stringify(bad));
});
