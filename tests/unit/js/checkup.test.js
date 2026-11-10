// 등급 A — web/core/checkup.js (FR-316). MWL web/engine.js(e55b9c0) 점검 절을 여러 과정으로: 영역은 강의 ID 첫 글자가 아니라 목차로 찾는다.
// 시험 먼저 2026-11-09 — 모듈이 없을 때 실패를 보고 구현했다(테스트결과서 7절).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core, rng } = require('./helpers');
const K = core('checkup');

// 강의 ID 가 영역 글자로 시작하지 않는 과정 — MWL 의 '첫 글자' 규칙이면 영역이 틀린다
const COURSE = {
  id: 'demo', parts: [
    { id: 'net', title: '네트워크', units: [{ id: 'u1', title: '기초', lessons: ['intro-1', 'intro-2'] }] },
    { id: 'db', title: '데이터베이스', units: [{ id: 'u2', title: 'SQL', lessons: ['sql-1'] }] }],
  lessons: { 'intro-1': {}, 'intro-2': {}, 'sql-1': {} },
  diagnostic: [
    { id: 'dg-01', type: 'mcq', q: 'Q1', options: ['a', 'b'], answer: 'a', explain: '', lesson: 'intro-1' },
    { id: 'dg-02', type: 'short', q: 'Q2', answer: 'select', explain: '', lesson: 'sql-1' },
    { id: 'dg-03', type: 'mcq', q: 'Q3', options: ['x', 'y'], answer: 'y', explain: '', lesson: 'nowhere' }],
  quizzes: {
    'QZ-2': { unit: 'u2', items: [{ id: 'q1', type: 'short', q: 'Z1', answer: 'join', explain: '', lesson: 'sql-1' }] },
    'QZ-1': { unit: 'u1', items: [{ id: 'q1', type: 'mcq', q: 'Y1', options: ['p', 'q'], answer: 'p', explain: '', lesson: 'intro-2' },
      { id: 'q2', type: 'multi', q: 'Y2', options: ['p', 'q', 'r'], answer: ['p', 'r'], explain: '', lesson: 'intro-1' }] }
  }
};

test('은행 — 점검 문항 ID 그대로 + 퀴즈 문항 <퀴즈>:<문항>, 자기 키만 있는 표', () => {
  const b = K.bank(COURSE);
  assert.deepEqual(Object.keys(b), ['dg-01', 'dg-02', 'dg-03', 'QZ-1:q1', 'QZ-1:q2', 'QZ-2:q1']);
  assert.equal(Object.getPrototypeOf(b), null);
  assert.equal(b['QZ-1:q2'].answer[1], 'r');
  assert.deepEqual(Object.keys(K.bank({ id: 'e' })), []);
});

test('영역은 목차로 — 강의 → 단원 → 영역, 못 찾으면 "?"', () => {
  assert.equal(K.partOf(COURSE, { lesson: 'intro-2' }), 'net');
  assert.equal(K.partOf(COURSE, { lesson: 'sql-1' }), 'db');
  assert.equal(K.partOf(COURSE, { lesson: 'nowhere' }), '?');
  assert.equal(K.partOf(COURSE, { lesson: 'constructor' }), '?', '상속 키를 읽지 않는다');
  assert.equal(K.partOf(COURSE, {}), '?');
});

test('기준선 ID 는 점검 문항 순서 그대로', () => {
  assert.deepEqual(K.baselineIds(COURSE), ['dg-01', 'dg-02', 'dg-03']);
  assert.deepEqual(K.baselineIds({ id: 'e' }), []);
});

test('무작위 뽑기 — 영역마다 per 개, 같은 시드면 같은 문항, 고른 영역만', () => {
  const b = K.bank(COURSE);
  const a1 = K.sampleIds(COURSE, b, 2, null, rng(7));
  const a2 = K.sampleIds(COURSE, b, 2, null, rng(7));
  assert.deepEqual(a1, a2);
  const parts = a1.map((id) => K.partOf(COURSE, b[id]));
  assert.equal(parts.filter((p) => p === 'net').length, 2);
  assert.equal(parts.filter((p) => p === 'db').length, 2);
  assert.equal(parts.filter((p) => p === '?').length, 1, '영역을 모르는 문항은 "?" 영역으로 묶인다');
  assert.deepEqual(K.sampleIds(COURSE, b, 5, ['db'], rng(1)).sort(), ['QZ-2:q1', 'dg-02']);
  assert.deepEqual(K.sampleIds(COURSE, b, 1, ['db', 'db'], rng(1)).length, 1, '같은 영역을 두 번 골라도 한 번');
  assert.deepEqual(K.sampleIds(COURSE, b, 3, ['zz'], rng(1)), []);
  assert.equal(K.sampleIds(COURSE, b, 1, [], rng(3)).length, 3, '빈 목록 = 전체 영역');
});

test('채점 — 영역 점수(0.5 올림)·총점·문항별, 비운 답은 틀림', () => {
  const b = K.bank(COURSE);
  const r = K.gradeCheck(COURSE, b, ['dg-01', 'dg-02', 'QZ-1:q1', 'QZ-1:q2', 'QZ-2:q1', 'dg-03'],
    { 'dg-01': '1', 'dg-02': 'SELECT', 'QZ-1:q1': 'q', 'QZ-1:q2': ['r', 'p'], 'QZ-2:q1': '', 'dg-03': 'y' });
  assert.deepEqual(r.scores, { '?': 100, db: 50, net: 67 });
  assert.equal(r.total, 67);
  assert.deepEqual(r.items.map((i) => [i.id, i.correct]), [['dg-01', true], ['dg-02', true], ['QZ-1:q1', false], ['QZ-1:q2', true], ['QZ-2:q1', false], ['dg-03', true]]);
  assert.equal(r.items[4].answer, '');
  const empty = K.gradeCheck(COURSE, b, ['dg-01'], {});
  assert.deepEqual(empty, { scores: { net: 0 }, total: 0, items: [{ id: 'dg-01', answer: '', correct: false }] });
  assert.deepEqual(K.gradeCheck(COURSE, b, [], {}), { scores: {}, total: 0, items: [] });
  assert.equal(K.gradeCheck(COURSE, b, ['QZ-1:q2'], { 'QZ-1:q2': [] }).items[0].correct, false, '빈 배열도 비운 답');
});

test('기록 한 건의 문항별 줄 — 지금 은행에 없는 문항은 뺀다', () => {
  const b = K.bank(COURSE);
  const rows = K.detail({ items: [{ id: 'dg-02', answer: 'x', correct: false }, { id: 'gone', answer: 'a', correct: true }, { id: 'QZ-1:q2', correct: true }] }, b);
  assert.deepEqual(rows.map((r) => r.id), ['dg-02', 'QZ-1:q2']);
  assert.equal(rows[0].expected, 'select');
  assert.equal(rows[0].explain, '');
  assert.equal(rows[1].answer, '');
  assert.deepEqual(K.detail({}, b), []);
});

function st(quizzes, checks) { return { quizzes: quizzes, checks: checks }; }

test('오답노트 — 그 과정의 퀴즈·점검 시도, 마지막이 맞으면 고침, MWL 정렬', () => {
  const b = K.bank(COURSE);
  const s = st([
    { course: 'demo', id: 'QZ-1', at: '2026-11-01', answers: { q1: 'q', q2: 'p' } },        // 둘 다 틀림
    { course: 'other', id: 'QZ-1', at: '2026-11-01', answers: { q1: 'q' } },                // 다른 과정 — 빼기
    { course: 'demo', id: 'QZ-1', at: '2026-11-03', answers: { q1: 'p' } },                 // q1 고침
    { course: 'demo', id: 'QZ-9', at: '2026-11-03', answers: { q1: 'x' } }                  // 은행에 없는 퀴즈
  ], [
    { course: 'demo', at: '2026-11-02', mode: 'random', items: [{ id: 'dg-02', answer: 'x', correct: false }, { id: 'QZ-1:q2', answer: 'r', correct: false }] },
    { course: 'demo', at: '2026-11-03', mode: 'retry', items: [{ id: 'dg-02', correct: false }] }
  ]);
  const notes = K.wrongNotes(COURSE, s, b);
  assert.deepEqual(notes.map((n) => [n.id, n.wrong, n.attempts, n.resolved, n.last_wrong_at]), [
    ['dg-02', 2, 2, false, '2026-11-03'],
    ['QZ-1:q2', 2, 2, false, '2026-11-02'],
    ['QZ-1:q1', 1, 2, true, '2026-11-01']]);
  assert.equal(notes[0].last_answer, '', '답이 없던 시도는 빈 글');
  assert.deepEqual(K.retryIds(notes, 1), ['dg-02']);
  assert.deepEqual(K.retryIds(notes, 10), ['dg-02', 'QZ-1:q2']);
  assert.deepEqual(K.wrongNotes(COURSE, st([], []), b), []);
});

test('오답노트 정렬 — 같은 날 퀴즈가 점검보다 앞(시도 순서), 틀린 횟수가 같으면 최근 → ID', () => {
  const b = K.bank(COURSE);
  const s = st([{ course: 'demo', id: 'QZ-2', at: '2026-11-05', answers: { q1: 'x' } }],
    [{ course: 'demo', at: '2026-11-05', mode: 'random', items: [{ id: 'QZ-2:q1', answer: 'join', correct: true }, { id: 'dg-01', answer: 'b', correct: false }] }]);
  const notes = K.wrongNotes(COURSE, s, b);
  assert.deepEqual(notes.map((n) => [n.id, n.resolved]), [['dg-01', false], ['QZ-2:q1', true]]);
});
