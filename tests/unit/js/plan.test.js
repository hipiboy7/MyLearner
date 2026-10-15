// 등급 A — web/core/plan.js 여러 과정(FR-240·241, 인터뷰 1번 A)·보류·계획 없는 과정, mastery·stats 의 일반화(FR-243). 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers');
const L = core('log'), R = core('replay'), P = core('plan'), M = core('mastery'), T = core('stats');

function course(id, nLessons, extra) {
  const lessons = {}, cards = {};
  const ids = [];
  for (let i = 1; i <= nLessons; i++) {
    const lid = id.toUpperCase() + '1-' + i; ids.push(lid);
    lessons[lid] = { title: lid, minutes: 10, level: 1, prereqs: [], tags: [], confidence: 'likely', sources: [], body: '' };
    for (let k = 1; k <= 3; k++) cards[lid + '-c0' + k] = { lesson: lid, type: 'concept', q: 'q', a: 'a' };
  }
  return Object.assign({ format: 'mylearner-course', version: 1, min_reader: 1, id: id, title: id, kind: 'course',
    parts: [{ id: id.toUpperCase(), title: 'p', units: [{ id: id.toUpperCase() + '1', title: 'u', lessons: ids }] }], lessons: lessons, cards: cards }, extra || {});
}
let seq = 0;
function e(day, type, f) { seq += 1; return L.make(Object.assign({ dev: 'a', seq: seq, t: day + 'T01:00:00.000Z', day: day, type: type }, f)).line; }
function state(lines, today) { const s = R.run(L.merge([lines]).events, { today: today }); seq = 0; return s; }
const TUE = '2026-10-13', SAT = '2026-10-17';

test('복습은 모든 과정에서 (due, 과정, 카드) 순, 상한 하나', () => {
  const a = course('a', 2), b = course('b', 2);
  const lines = [];
  for (const [c, l] of [['a', 'A1-1'], ['b', 'B1-1']]) for (let k = 1; k <= 3; k++) lines.push(e('2026-10-12', 'review', { course: c, card: l + '-c0' + k, grade: 'good' }));
  lines.push(e('2026-10-12', 'review', { course: 'b', card: 'GONE-c01', grade: 'good' }));   // 과정 파일에 없는 카드는 내지 않는다
  const st = state(lines, TUE);
  const p = P.build([a, b], st, { max_reviews_per_day: 4 }, TUE);
  assert.deepEqual(p.reviews.map((x) => x.course + ':' + x.id), ['a:A1-1-c01', 'a:A1-1-c02', 'a:A1-1-c03', 'b:B1-1-c01']);
});

test('새 카드는 메모 과정 먼저, 그다음 모든 과정의 마친 강의 순(마친 날, 과정 순서), 합쳐 상한 하나', () => {
  const a = course('a', 2), b = course('b', 2);
  const notes = { format: 'mylearner-course', version: 1, min_reader: 1, id: 'n', title: 'n', kind: 'notes',
    parts: [{ id: 'N', title: 'n', units: [{ id: 'N1', title: 'n', lessons: ['K2', 'K1'] }] }],
    lessons: { K1: { title: 'k1', created: '2026-10-01', body: '' }, K2: { title: 'k2', created: '2026-10-02', body: '' } },
    cards: { 'K1-c01': { lesson: 'K1', type: 'concept', q: 'q', a: 'a' }, 'K2-c01': { lesson: 'K2', type: 'concept', q: 'q', a: 'a' } } };
  const st = state([e('2026-10-10', 'lesson', { course: 'b', lesson: 'B1-2', done: true }), e('2026-10-11', 'lesson', { course: 'a', lesson: 'A1-1', done: true }),
    e('2026-10-11', 'lesson', { course: 'b', lesson: 'B1-1', done: true })], TUE);
  const p = P.build([a, b, notes], st, { new_cards_per_day: 6 }, TUE);
  assert.deepEqual(p.new_cards.map((x) => x.course + ':' + x.id), ['n:K1-c01', 'n:K2-c01', 'b:B1-2-c01', 'b:B1-2-c02', 'b:B1-2-c03', 'a:A1-1-c01']);
  assert.equal(p.minutes_estimate.review, 2);
});

test('새 강의는 주 과정 하나에서 — main_course, 없으면 첫 일반 과정. 계획이 없으면 목차 순', () => {
  const a = course('a', 2), b = course('b', 2);
  const st = state([e('2026-10-11', 'lesson', { course: 'b', lesson: 'B1-1', done: true })], TUE);
  assert.deepEqual(P.build([a, b], st, {}, TUE).lesson, { course: 'a', id: 'A1-1' });
  const pb = P.build([a, b], st, { main_course: 'b' }, TUE);
  assert.deepEqual(pb.lesson, { course: 'b', id: 'B1-2' });
  assert.equal(pb.course, 'b');
  assert.equal(pb.minutes_estimate.lesson, 10);
  assert.deepEqual(P.build([a, b], st, { main_course: 'zzz' }, TUE).lesson, { course: 'a', id: 'A1-1' }, '없는 과정이면 첫 일반 과정');
  assert.equal(P.build([], st, {}, TUE).lesson, null);
  assert.equal(P.build([], st, {}, TUE).course, null);
});

test('보류한 카드는 복습·새 카드에서 빠진다', () => {
  const a = course('a', 1);
  const lines = [e('2026-10-11', 'lesson', { course: 'a', lesson: 'A1-1', done: true }), e('2026-10-12', 'review', { course: 'a', card: 'A1-1-c01', grade: 'good' }),
    e('2026-10-12', 'card.hold', { course: 'a', card: 'A1-1-c01', on: true }), e('2026-10-12', 'card.hold', { course: 'a', card: 'A1-1-c02', on: true })];
  const p = P.build([a], state(lines, TUE), {}, TUE);
  assert.deepEqual(p.reviews, []);
  assert.deepEqual(p.new_cards.map((x) => x.id), ['A1-1-c03']);
});

test('주말 — 복습만, 분으로 상한', () => {
  const a = course('a', 2);
  const lines = [];
  for (let k = 1; k <= 3; k++) lines.push(e('2026-10-12', 'review', { course: 'a', card: 'A1-1-c0' + k, grade: 'good' }));
  const p = P.build([a], state(lines, SAT), { weekend_minutes: 0.5 }, SAT);
  assert.equal(p.is_study_day, false);
  assert.deepEqual(p.reviews.map((x) => x.id), ['A1-1-c01', 'A1-1-c02']);
  assert.equal(p.lesson, null); assert.equal(p.journal, false);
});

test('퀴즈 — 주 과정 먼저, 그다음 다른 일반 과정', () => {
  const qa = { 'QZ-A1': { unit: 'A1', items: [] } }, qb = { 'QZ-B1': { unit: 'B1', items: [] } };
  const a = course('a', 1, { quizzes: qa }), b = course('b', 1, { quizzes: qb });
  const st = state([e('2026-10-11', 'lesson', { course: 'b', lesson: 'B1-1', done: true })], TUE);
  assert.deepEqual(P.build([a, b], st, {}, TUE).quiz, { course: 'b', id: 'QZ-B1' });
  const st2 = state([e('2026-10-11', 'lesson', { course: 'b', lesson: 'B1-1', done: true }), e('2026-10-11', 'lesson', { course: 'a', lesson: 'A1-1', done: true }),
    e('2026-10-12', 'quiz', { course: 'a', quiz: 'QZ-A1', score: 10, answers: {} })], TUE);
  assert.deepEqual(P.build([a, b], st2, {}, TUE).quiz, { course: 'b', id: 'QZ-B1' }, '푼 퀴즈는 다시 내지 않는다');
});

test('숙련도 — 실습·퀴즈·드릴이 없는 단원은 그 조건을 건너뛴다(L4 까지), 일지는 그 과정 것만', () => {
  const a = course('a', 2);
  const lines = [e('2026-10-01', 'lesson', { course: 'a', lesson: 'A1-1', done: true }), e('2026-10-01', 'lesson', { course: 'a', lesson: 'A1-2', done: true })];
  for (const l of ['A1-1', 'A1-2']) for (let k = 1; k <= 3; k++) lines.push(e('2026-10-02', 'review', { course: 'a', card: l + '-c0' + k, grade: 'good' }));
  assert.equal(M.unit(a, state(lines, TUE), 'A1'), 4);
  lines.push(e('2026-10-03', 'journal', { course: 'b', teach: 'A1 을 가르쳤다' }));
  assert.equal(M.unit(a, state(lines, TUE), 'A1'), 4, '다른 과정의 일지');
  lines.push(e('2026-10-03', 'journal', { teach: 'A1 을 가르쳤다' }));
  assert.equal(M.unit(a, state(lines, TUE), 'A1'), 5, '과정이 없는 일지');
  assert.equal(M.unit(a, state([], TUE), 'NOPE'), 0);
});

test('통계 — 메모 과정 수, 여러 과정 합계', () => {
  const a = course('a', 2);
  const notes = { format: 'mylearner-course', version: 1, min_reader: 1, id: 'n', title: 'n', kind: 'notes',
    parts: [{ id: 'N', title: 'n', units: [{ id: 'N1', title: 'n', lessons: ['K1'] }] }], lessons: { K1: { title: 'k', body: '' } },
    cards: { 'K1-c01': { lesson: 'K1', type: 'concept', q: 'q', a: 'a' } } };
  const s = T.summary([a, notes], state([e(TUE, 'session', { minutes: 7, reviewed: 2 })], TUE), TUE, [1, 2, 3, 4, 5]);
  assert.equal(s.knowledge, 1); assert.equal(s.knowledge_cards, 1); assert.equal(s.lessons_total, 2);
  assert.equal(s.streak, 1); assert.equal(s.total_minutes, 7); assert.equal(s.accuracy, null);
  assert.deepEqual(Object.keys(s.courses), ['a']);
  assert.equal(T.streak([], TUE, []), 0);
});
