// 등급 A — web/core/mwl_import.js (FR-261·262, S5). 진도 자료는 MWL 골든 벡터 scheduler_cases.json(e55b9c0) 의 19+2+2가지. 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core, fixture } = require('./helpers');
const I = core('mwl_import'), L = core('log'), R = core('replay'), S = core('srs'), K = core('course');

const cases = fixture('mwl/scheduler_cases.json');
const allProgress = [].concat(cases.scheduler_cases, cases.mastery_cases, cases.stats_cases).map((c) => ({ name: c.name, progress: c.progress, today: c.today || '2026-09-15' }));

function richProgress() {
  return {
    schema: 2, created: '2026-09-01', version: '1.7.2',
    cards: {
      'A1-1-c01': { ef: 2.36, interval: 8, reps: 3, lapses: 1, due: '2026-09-20', last: '2026-09-12', grades: [0, 2, 2, 1] },
      'A1-1-c02': { ef: 2.5, interval: 1, reps: 1, lapses: 0, due: '2026-09-13', last: '2026-09-12', grades: [2] },
      'K0001-c01': { ef: 2.5, interval: 3, reps: 2, lapses: 0, due: '2026-09-15', last: '2026-09-12', grades: [2, 2] },
      'K0009-c01': { ef: 2.5, interval: 1, reps: 1, lapses: 0, due: '2026-09-11', last: '2026-09-10', grades: [2] } },   // 지운 지식의 카드
    lessons: { 'A1-1': { status: 'done', confidence: 3, done_at: '2026-09-10' }, 'A1-2': { status: 'in_progress', confidence: null, done_at: null } },
    labs: { 'LAB-A1-1': { status: 'done', done_at: '2026-09-11', notes: '메모', score: 1, total: 2 }, 'LAB-A1-2': { status: 'todo', done_at: null, notes: '', score: null, total: null } },
    drills: [{ id: 'DR-01', score: 15, max: 20, at: '2026-09-11', path: ['s1', 's2'] }],
    quizzes: [{ id: 'QZ-A1', score: 50, at: '2026-09-12', answers: { q1: 'a', q2: '틀림' } }],
    diagnostics: [{ at: '2026-09-01', scores: { A: 40, B: 60 }, mode: 'baseline', total: 50, items: [{ id: 'dg-01', answer: 'a', correct: true }] },
      { at: '2026-09-12', scores: { A: 80 } }],
    sessions: [{ date: '2026-09-10', minutes: 50, reviewed: 10, lesson: 'A1-1', lab: null }, { date: '2026-09-12', minutes: 15, reviewed: 3, lesson: null, lab: 'LAB-A1-1' }],
    journal: [{ date: '2026-09-12', summary: '요약', apply: '', unclear: '모름', teach: 'A1 을 설명했다' }],
    knowledge: [
      { id: 'K0002', title: '둘째', domain: 'B', kind: 'concept', body: '## 본문 둘', cards: [{ q: 'Q2', a: 'A2' }], created: '2026-09-11', module: null, source: '', confidence: 'unverified', tags: [], origin: 'manual', updated: null },
      { id: 'K0001', title: '첫째', domain: 'A', kind: 'command', body: '본문 하나', cards: [{ q: ' Q1 ', a: 'A1 ' }, { q: 'Q1b', a: 'A1b' }], created: '2026-09-11', module: 'A1', source: '매뉴얼 3장', confidence: 'likely', tags: ['t'], origin: 'prompt', updated: '2026-09-12' }],
    knowledge_seq: 2,
  };
}
function replayOf(conv, today) { return R.run(L.merge([conv.lines]).events, { today: today }); }

test('골든 진도 23가지 — 바꿔 다시 계산하면 카드 상태가 N/N 같다(S5)', () => {
  for (const c of allProgress) {
    const conv = I.convert(c.progress);
    const v = I.verify(c.progress, replayOf(conv, c.today));
    assert.equal(v.match, v.total, c.name);
    assert.deepEqual(v.mismatches, [], c.name);
  }
});

test('사건 — 종류·과정·학습일·가상 기기·순번', () => {
  const p = richProgress();
  const conv = I.convert(p);
  const ev = L.merge([conv.lines]).events;
  assert.ok(ev.every((e) => /^mwl-[0-9a-f]{12}$/.test(e.dev)));
  assert.deepEqual(ev.map((e) => e.seq).sort((a, b) => a - b), ev.map((_, i) => i + 1));
  const by = (t) => ev.filter((e) => e.type === t);
  assert.equal(by('card.state').length, 4);
  assert.deepEqual(by('card.state').map((e) => e.data.course + ':' + e.data.card).sort(), ['mwl-notes:K0001-c01', 'mwl-notes:K0009-c01', 'mwl:A1-1-c01', 'mwl:A1-1-c02']);
  assert.equal(by('card.state')[0].data.src, 'mwl');
  assert.deepEqual(by('lesson').map((e) => [e.data.lesson, e.day, e.data.confidence]), [['A1-1', '2026-09-10', 3]]);
  assert.deepEqual(by('lab').map((e) => [e.data.lab, e.day, e.data.score, e.data.total, e.data.notes]), [['LAB-A1-1', '2026-09-11', 1, 2, '메모']]);
  assert.equal(by('drill')[0].data.max, 20);
  assert.deepEqual(by('quiz')[0].data.answers, { q1: 'a', q2: '틀림' });
  assert.deepEqual(by('check').map((e) => [e.day, e.data.mode, e.data.total]), [['2026-09-01', 'baseline', 50], ['2026-09-12', 'baseline', null]]);
  assert.equal(by('session').length, 2);
  assert.equal(by('journal')[0].data.teach, 'A1 을 설명했다');
  assert.ok(ev.every((e) => e.t === e.day + 'T00:00:00.000Z'));
  assert.deepEqual(conv.report.skipped, { lessons: 1, labs: 1 });
  assert.equal(conv.report.cards, 4);
});

test('같은 진도는 같은 줄 — 두 번 들여와도 늘지 않는다(멱등), 다른 진도는 다른 기기', () => {
  const p = richProgress();
  const a = I.convert(p), b = I.convert(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(a.lines, b.lines);
  assert.equal(L.writeFile(L.merge([a.lines, b.lines])), L.writeFile(L.merge([a.lines])));
  const later = richProgress();
  later.cards['A1-1-c02'] = S.review(later.cards['A1-1-c02'], 'good', '2026-09-13');
  const c = I.convert(later);
  assert.notEqual(c.events[0].dev, a.events[0].dev);
  // 둘 다 들여오면 나중 진도의 상태가 뒤에 와서 이긴다
  const st = R.run(L.merge([a.lines, c.lines]).events, { today: '2026-09-20' });
  assert.deepEqual(st.cards.mwl['A1-1-c02'], later.cards['A1-1-c02']);
});

test('글로 받아도 되고, 스키마 1 은 올리고, 모르는 스키마·JSON 이 아닌 것은 거부한다', () => {
  const p = richProgress();
  assert.deepEqual(I.convert(JSON.stringify(p)).lines, I.convert(p).lines);
  const v1 = JSON.parse(JSON.stringify(p)); v1.schema = 1; delete v1.knowledge; delete v1.knowledge_seq;
  const conv1 = I.convert(v1);
  assert.equal(conv1.notes, null);
  assert.equal(conv1.report.schema, 1);
  assert.throws(() => I.convert({ schema: 3, cards: {} }), /스키마/);
  assert.throws(() => I.convert('{not json'), /JSON/);
  assert.throws(() => I.convert('[1]'), /객체/);
  assert.throws(() => I.convert({ schema: 2, created: 'x', cards: { 'A1-1-c01': { ef: 'bad' } } }), /카드/);
});

test('내 지식 → 메모 과정(mwl-notes) — 과정 검사 통과, ID 고정, 순서·본문', () => {
  const conv = I.convert(richProgress());
  const n = conv.notes;
  assert.equal(n.id, 'mwl-notes'); assert.equal(n.kind, 'notes'); assert.equal(n.readonly, false);
  const r = K.validate(n);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(n.parts[0].units[0].lessons, ['K0001', 'K0002'], '만든 날·ID 순');
  assert.deepEqual(Object.keys(n.cards).sort(), ['K0001-c01', 'K0001-c02', 'K0002-c01']);
  assert.deepEqual(n.cards['K0001-c01'], { lesson: 'K0001', type: 'concept', q: 'Q1', a: 'A1', hint: '', tags: ['t'], difficulty: 1 });
  assert.equal(n.lessons.K0001.body, '본문 하나');
  assert.equal(n.lessons.K0001.created, '2026-09-11');
  assert.equal(n.lessons.K0001.source, '매뉴얼 3장');
  assert.deepEqual(n.lessons.K0001.related, { course: 'mwl', part: 'A', unit: 'A1' });
  assert.equal(n.lessons.K0001.confidence, 'likely');
  assert.equal(I.convert({ schema: 2, created: '2026-09-01', cards: {}, lessons: {}, labs: {}, drills: [], quizzes: [], diagnostics: [], sessions: [], journal: [], knowledge: [] }).notes, null);
});

test('verify — 다르면 카드와 칸을 알려 준다', () => {
  const p = richProgress();
  const st = replayOf(I.convert(p), '2026-09-20');
  st.cards.mwl['A1-1-c01'].interval = 99;
  delete st.cards['mwl-notes']['K0009-c01'];
  const v = I.verify(p, st);
  assert.equal(v.total, 4); assert.equal(v.match, 2);
  assert.deepEqual(v.mismatches.map((m) => m.card + ':' + m.fields.join(',')).sort(), ['A1-1-c01:interval', 'K0009-c01:missing']);
});
