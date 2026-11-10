// 등급 A — web/core/stats.js 넓히기(FR-340~347, 보류 결정 1: ①~⑥). 옛 summary 는 golden.test.js 가 MWL 골든 벡터로 본다.
// 시험 먼저 2026-11-09 — 새 함수가 없을 때 실패를 보고 구현했다(테스트결과서 7절).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers');
const T = core('stats');

const A = {
  id: 'a', kind: 'course', parts: [{ id: 'P', title: '영역', units: [{ id: 'U1', title: '하나', lessons: ['l1', 'l2'] }, { id: 'U2', title: '둘', lessons: ['l3'] }] }],
  lessons: { l1: { title: 'L1' }, l2: { title: 'L2' }, l3: { title: 'L3' } },
  cards: { c1: { lesson: 'l1' }, c2: { lesson: 'l1' }, c3: { lesson: 'l2' }, c4: { lesson: 'l3' }, c5: { lesson: 'l3' } }
};
const B = { id: 'b', kind: 'course', parts: [{ id: 'Q', title: 'Q', units: [{ id: 'V', title: 'V', lessons: ['m1'] }] }], lessons: { m1: {} }, cards: { d1: { lesson: 'm1' } } };
const N = { id: 'n', kind: 'notes', parts: [], lessons: { k1: {} }, cards: { 'k1-c01': { lesson: 'k1' } } };

function card(due, grades, interval) { return { ef: 2.5, interval: interval || 1, reps: grades.length, lapses: 0, due: due, last: '2026-11-01', grades: grades }; }
function emptySt() { return { cards: {}, held: {}, lessons: {}, labs: {}, drills: [], quizzes: [], checks: [], journal: [], sessions: [], settings: {}, reviews: [] }; }

test('① 개요 — 오늘·이번 주(월~일) 분과 목표, 연속 학습일, 7일 예정(밀린 것은 오늘에, 보류·과정 밖 카드 제외)', () => {
  const st = emptySt();
  // 2026-11-11 은 수요일
  st.sessions = [{ date: '2026-11-09', minutes: 30, reviewed: 0 }, { date: '2026-11-10', minutes: 20, reviewed: 0 }, { date: '2026-11-11', minutes: 15, reviewed: 0 },
    { date: '2026-11-08', minutes: 99, reviewed: 0 }];
  st.cards = { a: { c1: card('2026-11-05', [2]), c2: card('2026-11-11', [2]), c3: card('2026-11-12', [2]), c4: card('2026-11-17', [2]), c5: card('2026-11-18', [2]), zz: card('2026-11-11', [2]) },
    b: { d1: card('2026-11-13', [2]) } };
  st.held = { a: { c2: true } };
  const settings = { weekday_minutes: 50, weekend_minutes: 15, study_days: [1, 2, 3, 4, 5] };
  const o = T.overview([A, B, N], st, '2026-11-11', settings);
  assert.equal(o.today_minutes, 15);
  assert.equal(o.today_goal, 50);
  assert.equal(o.week_minutes, 65, '월 9일부터 — 8일(일)은 지난주');
  assert.equal(o.week_goal, 5 * 50 + 2 * 15);
  assert.equal(o.streak, 4, '공부 요일이 아닌 날(8일 일요일)에 한 것도 이어 센다 — MWL streak');
  assert.deepEqual(o.due7, [
    { date: '2026-11-11', count: 1 }, { date: '2026-11-12', count: 1 }, { date: '2026-11-13', count: 1 }, { date: '2026-11-14', count: 0 },
    { date: '2026-11-15', count: 0 }, { date: '2026-11-16', count: 0 }, { date: '2026-11-17', count: 1 }]);
  const onlyB = T.overview([A, B, N], st, '2026-11-11', settings, ['b']);
  assert.deepEqual(onlyB.due7.map((d) => d.count), [0, 0, 1, 0, 0, 0, 0], '과정을 고르면 그 과정 카드만');
  const weekend = T.overview([A], st, '2026-11-14', settings);
  assert.equal(weekend.today_goal, 15, '공부 요일이 아니면 주말 목표');
});

test('② 추이 — 날마다 복습 수·good 이상 비율(없으면 null), 주마다(월요일 시작), 과정 고르기', () => {
  const st = emptySt();
  st.reviews = [
    { course: 'a', card: 'c1', day: '2026-11-10', grade: 'good', applied: true },
    { course: 'a', card: 'c2', day: '2026-11-10', grade: 'again', applied: true },
    { course: 'b', card: 'd1', day: '2026-11-10', grade: 'easy', applied: false },
    { course: 'a', card: 'c1', day: '2026-11-11', grade: 'hard', applied: true },
    { course: 'a', card: 'c3', day: '2026-11-02', grade: 'good', applied: true },
    { course: 'a', card: 'c3', day: '2026-10-01', grade: 'good', applied: true }];
  const t = T.trend(st, '2026-11-11', 14);
  assert.equal(t.daily.length, 14);
  assert.deepEqual(t.daily[0], { date: '2026-10-29', reviews: 0, good: 0, accuracy: null });
  assert.deepEqual(t.daily[12], { date: '2026-11-10', reviews: 3, good: 2, accuracy: 2 / 3 }, '이른 복습도 센다');
  assert.deepEqual(t.daily[13], { date: '2026-11-11', reviews: 1, good: 0, accuracy: 0 });
  assert.deepEqual(t.weekly.map((w) => [w.week_start, w.reviews]), [['2026-10-26', 0], ['2026-11-02', 1], ['2026-11-09', 4]]);
  assert.equal(t.weekly[2].accuracy, 0.5);
  assert.equal(t.weekly[0].accuracy, null);
  const ta = T.trend(st, '2026-11-11', 14, ['a']);
  assert.equal(ta.daily[12].reviews, 2);
});

test('③ 카드 상태 — 새·배우는 중·정착(3회 이상·최근 3회 모두 good 이상)·보류, 정착률 = 본 카드의 최근 3회 비율 평균', () => {
  const st = emptySt();
  st.cards = { a: { c1: card('2026-12-01', [2, 2, 3]), c2: card('2026-12-01', [0, 2, 2, 2]), c3: card('2026-11-12', [2, 0]), zz: card('2026-11-12', [2, 2, 2]) } };
  st.held = { a: { c3: true, c4: true } };
  const s = T.cardStates([A, B], st);
  assert.deepEqual({ n: s.new, l: s.learning, s: s.settled, h: s.held, t: s.total }, { n: 2, l: 0, s: 2, h: 2, t: 6 });
  assert.equal(s.settle_rate, (1 + 1 + 0.5) / 3, '보류한 카드도 본 카드면 정착률에 든다 — 과정 밖 zz 는 뺀다');
  const sb = T.cardStates([A, B], st, ['b']);
  assert.deepEqual([sb.new, sb.total, sb.settle_rate], [1, 1, null]);
  const learning = T.cardStates([A], { cards: { a: { c1: card('x', [2, 2]) } }, held: {} });
  assert.equal(learning.learning, 1, '2회뿐이면 배우는 중');
});

test('④ 진도 — 과정마다 강의 n/N 과 숙련도 요약(메모 과정은 뺀다)', () => {
  const st = emptySt();
  st.lessons = { a: { l1: { done: true }, l2: { done: false } } };
  const p = T.progress([A, B, N], st);
  assert.deepEqual(Object.keys(p), ['a', 'b']);
  assert.equal(p.a.lessons_done, 1);
  assert.equal(p.a.lessons_total, 3);
  assert.equal(p.a.parts.P.units.U1.lessons_done, 1);
  assert.deepEqual(Object.keys(T.progress([A, B, N], st, ['b'])), ['b']);
});

test('⑤ 틀림이 많은 것 — again 수 많은 카드(상위 n)·단원, 같으면 ID 순', () => {
  const st = emptySt();
  const r = (course, c, g) => ({ course: course, card: c, day: '2026-11-10', grade: g, applied: true });
  st.reviews = [r('a', 'c4', 'again'), r('a', 'c4', 'again'), r('a', 'c1', 'again'), r('a', 'c1', 'good'), r('a', 'c3', 'again'), r('b', 'd1', 'again'),
    r('a', 'zz', 'again'), r('a', 'c2', 'good')];
  st.cards = { a: { c1: card('x', [0, 2]), c3: card('x', [0]), c4: card('x', [0, 0]) } };
  const w = T.weak([A, B], st, null, 3, 5);
  assert.deepEqual(w.cards.map((x) => [x.course, x.card, x.again, x.reviews, x.lesson]), [['a', 'c4', 2, 2, 'l3'], ['a', 'c1', 1, 2, 'l1'], ['a', 'c3', 1, 1, 'l2']]);
  assert.deepEqual(w.units.map((u) => [u.course, u.unit, u.again]), [['a', 'U1', 2], ['a', 'U2', 2], ['b', 'V', 1]]);
  assert.equal(w.units[0].title, '하나');
  assert.deepEqual(T.weak([A, B], st, ['b'], 3, 5).cards.map((x) => x.card), ['d1']);
  assert.deepEqual(T.weak([A], emptySt(), null, 3, 5), { cards: [], units: [] });
});

test('⑥ 점검 전·후 — 그 과정의 첫·가장 최근 기준선, 하나뿐이면 latest null', () => {
  const st = emptySt();
  st.checks = [{ course: 'a', mode: 'random', scores: { P: 10 } }, { course: 'a', mode: 'baseline', at: '2026-11-01', scores: { P: 40 } },
    { course: 'b', mode: 'baseline', at: '2026-11-02', scores: { Q: 90 } }, { course: 'a', mode: 'baseline', at: '2026-11-09', scores: { P: 80 } }];
  assert.deepEqual(T.checkCompare(st, 'a'), { first: { at: '2026-11-01', scores: { P: 40 } }, latest: { at: '2026-11-09', scores: { P: 80 } } });
  assert.deepEqual(T.checkCompare(st, 'b'), { first: { at: '2026-11-02', scores: { Q: 90 } }, latest: null });
  assert.deepEqual(T.checkCompare(st, 'z'), { first: null, latest: null });
});
