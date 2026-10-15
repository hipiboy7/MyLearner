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

test('정규식 안전 — 겹친 반복·역참조·길이는 위험, MWL 실습 54개 꼴은 안전', () => {
  for (const p of ['(a+)+', '(a*)*', '(a+)*b', '((ab)+)+', '(a|aa)+', '(x{2,})+', '(.*a){3,}', '(a)\\1', '(?<n>a)\\k<n>', 'a'.repeat(201)])
    assert.ok(G.unsafeRegex(p), p);
  for (const p of ['^[0-9]+(\\.[0-9]+)?$', '^(MinProc( ?= ?2)?|MinProc 2|2)$', '(?i)(full\\s*gc|풀\\s*gc)', 'modify-logger.*jeus\\.jdbc\\.sql.*FINE',
    '^\\[?SERVER-0300\\]?$', '[(]a+[)]+', '\\(a+\\)+', '(ab){2}', '(a|b)', 'SQLNET\\.EXPIRE_TIME\\s*=?\\s*([1-9]|[1-5][0-9])'])
    assert.equal(G.unsafeRegex(p), null, p);
  assert.equal(G.checkLab({ type: 'regex', answer: '(a+)+$' }, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab'), false, '위험한 패턴은 돌리지 않는다');
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
