// 등급 A — web/core/grade.js (FR-244). MWL tests/js/engine_test.js(e55b9c0)의 채점 사례 + 정규식 안전. 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers');
const G = core('grade');

test('퀴즈 채점 — MWL 과 같다', () => {
  assert.equal(G.checkAnswer({ type: 'mcq', options: ['a', 'b'], answer: 'b' }, '2'), true);
  assert.equal(G.checkAnswer({ type: 'mcq', options: ['a', 'b'], answer: 'b' }, ' B '), true);
  assert.equal(G.checkAnswer({ type: 'mcq', options: ['a', 'b'], answer: 'b' }, '3'), false);
  assert.equal(G.checkAnswer({ type: 'multi', options: ['x', 'y', 'z'], answer: ['x', 'z'] }, 'z;x'), true);
  assert.equal(G.checkAnswer({ type: 'multi', options: ['x', 'y', 'z'], answer: ['x', 'z'] }, ['Z', 'x']), true);
  assert.equal(G.checkAnswer({ type: 'order', options: ['x', 'y'], answer: ['x', 'y'] }, 'y;x'), false);
  assert.equal(G.checkAnswer({ type: 'order', options: ['x', 'y'], answer: ['x', 'y'] }, 'x ; y'), true);
  assert.equal(G.checkAnswer({ type: 'short', answer: '스레드 풀' }, ' 스레드 풀 '), true);
  assert.deepEqual(G.gradeItems([{ id: 'q1', type: 'short', answer: 'a' }, { id: 'q2', type: 'short', answer: 'b' }, { id: 'q3', type: 'short', answer: 'c' }], { q1: 'a', q3: 'x' }),
    { score: 33, correct: ['q1'] });
  assert.deepEqual(G.gradeItems([], {}), { score: 0, correct: [] });
});

test('실습 채점 — 고르기·글·정규식(Python re.fullmatch 와 같게, (?i) 를 받는다)', () => {
  assert.equal(G.checkLab({ type: 'regex', answer: 'Launcher-\\d+' }, 'Launcher-0058'), true);
  assert.equal(G.checkLab({ type: 'regex', answer: 'Launcher-\\d+' }, 'xLauncher-0058'), false);
  assert.equal(G.checkLab({ type: 'regex', answer: '(?i)IS\\s+NULL' }, 'is   null'), true);
  assert.equal(G.checkLab({ type: 'regex', answer: 'IS\\s+NULL' }, 'is null'), false);
  assert.equal(G.checkLab({ type: 'regex', answer: 'a|b' }, 'b'), true, '전체 일치 — 대안 전체를 감싼다');
  assert.equal(G.checkLab({ type: 'choice', options: ['a', 'b'], answer: 'b' }, '2'), true);
  assert.equal(G.checkLab({ type: 'text', answer: 'OK' }, ' ok '), true);
  assert.equal(G.checkLab({ type: 'regex', answer: '([' }, 'x'), false);
});

test('실습 정규식 — 쓸 수 없는 패턴은 이유, 멈추던 패턴은 선형으로 빨리(독립 점검 ② F1·F2·F5)', () => {
  for (const [p, why] of [['(a)\\1', '역참조'], ['(?<n>a)\\k<n>', '역참조'], ['a'.repeat(201), '길이'], ['([', '문법'], ['a)|(b', '문법'], ['(?=a)a', '지원하지 않는 문법'],
    ['(a{100}){100}', '너무 큼']])
    assert.equal(G.labPattern(p).why, why, p);
  for (const p of ['^[0-9]+(\\.[0-9]+)?$', '^(MinProc( ?= ?2)?|MinProc 2|2)$', '(?i)(full\\s*gc|풀\\s*gc)', 'modify-logger.*jeus\\.jdbc\\.sql.*FINE',
    '^\\[?SERVER-0300\\]?$', '[(]a+[)]+', '\\(a+\\)+', '(ab){2}', '(a|b)', 'SQLNET\\.EXPIRE_TIME\\s*=?\\s*([1-9]|[1-5][0-9])', '(a+)+', '(.*a){3,}'])
    assert.equal(G.labPattern(p).why, undefined, p);
  assert.equal(G.checkLab({ type: 'regex', answer: 'a)|(b' }, 'abc'), false, '감싸개를 닫는 패턴은 오답(전에는 abc 가 맞았다)');
  assert.equal(G.checkLab({ type: 'regex', answer: '(?i)SQLNET\\.EXPIRE_TIME\\s*=?\\s*([1-9]|[1-5][0-9])' }, 'sqlnet.expire_time = 10'), true);
  const t0 = Date.now();
  for (const [p, s] of [['.*.*.*.*b', 'a'.repeat(500)], ['(a+){20}b', 'a'.repeat(500)], ['[]?(a+)+$]', 'a'.repeat(500)], ['(a|a)'.repeat(40), 'a'.repeat(40) + 'x']])
    assert.equal(G.checkLab({ type: 'regex', answer: p }, s), false, p);
  assert.ok(Date.now() - t0 < 1000, (Date.now() - t0) + 'ms');
  assert.equal(G.checkLab({ type: 'regex', answer: '(a+)+$' }, 'a'.repeat(37) + 'b'), false);
  assert.equal(G.checkLab({ type: 'regex', answer: '(a+)+' }, 'a'.repeat(37)), true, '겹친 반복도 맞으면 맞다');
  assert.equal(G.checkLab({ type: 'regex', answer: 'a+' }, 'a'.repeat(501)), false, '답 길이 상한');
});

test('드릴 — 경로·점수, 범위 밖 선택은 거부', () => {
  const drill = { start: 's1', max_score: 20, steps: { s1: { prompt: '1', options: [{ text: '좋음', next: 's2', score: 10, feedback: 'f' }, { text: '나쁨', next: 's2', score: 0, feedback: '' }] },
    s2: { prompt: '2', options: [{ text: '끝', next: null, score: 10, feedback: '' }] } } };
  const run = G.runDrill(drill, [0, 0]);
  assert.deepEqual({ score: run.score, finished: run.finished, path: run.path, max: run.max }, { score: 20, finished: true, path: ['s1', 's2'], max: 20 });
  assert.equal(run.steps[0].option_text, '좋음');
  const half = G.runDrill(drill, [1]);
  assert.deepEqual({ score: half.score, finished: half.finished, next: half.next_step }, { score: 0, finished: false, next: 's2' });
  assert.throws(() => G.runDrill(drill, [5]), /범위/);
  assert.equal(G.runDrill(drill, [0, 0, 0]).steps.length, 2, '끝난 뒤의 선택은 버린다');
});
