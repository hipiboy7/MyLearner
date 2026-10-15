// 등급 A — 합치기 법칙·늦은 복습 규칙의 속성 시험(FR-222~224, S3). 시드 고정 난수(helpers.rng) — 같은 시드 = 같은 사례.
// 문서: docs/P2_설계서_Core.md 3.3·3.4절. 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core, rng, pick, shuffle } = require('./helpers');
const L = core('log'), R = core('replay'), D = core('dates'), S = core('srs');

const GRADES = ['again', 'hard', 'good', 'easy'];
function genLines(r) {
  const lines = [];
  for (const dev of ['p', 'h', 'x', 'mwl-00000000000f']) {
    let day = '2026-01-01', seq = 0;
    const n = Math.floor(r() * 40);
    for (let i = 0; i < n; i++) {
      if (r() < 0.4) day = D.addDays(day, Math.floor(r() * 4));
      if (r() < 0.03) day = D.addDays(day, -2);            // 시계가 뒤로 간 기기
      seq += 1;
      const t = day + 'T' + String(Math.floor(r() * 24)).padStart(2, '0') + ':00:00.000Z';
      const kind = r();
      let f;
      if (kind < 0.6) f = { type: 'review', course: pick(r, ['a', 'b']), card: pick(r, ['k1', 'k2', 'k3']), grade: pick(r, GRADES) };
      else if (kind < 0.7) f = { type: 'lesson', course: 'a', lesson: pick(r, ['L1', 'L2']), done: r() < 0.8 };
      else if (kind < 0.8) f = { type: 'session', minutes: Math.floor(r() * 30), reviewed: Math.floor(r() * 10) };
      else if (kind < 0.85) f = { type: 'card.state', course: 'a', card: 'k1', src: 'mwl', state: { ef: 2.5, interval: 3, reps: 2, lapses: 0, due: D.addDays(day, 3), last: day, grades: [2, 2] } };
      else if (kind < 0.9) f = { type: 'some.future.kind', x: Math.floor(r() * 3) };
      else f = { type: 'card.hold', course: 'b', card: 'k2', on: r() < 0.5 };
      lines.push(L.make(Object.assign({ dev: dev, seq: seq, t: t, day: day }, f)).line);
      if (r() < 0.05) lines.push(L.make(Object.assign({ dev: dev, seq: seq, t: t, day: day }, { type: 'review', course: 'a', card: 'k9', grade: 'easy' })).line);   // 같은 순번·다른 줄
    }
  }
  if (r() < 0.5) lines.push('{"v":1,"dev":"p","broken"');
  if (r() < 0.5) lines.push('{"v":2,"dev":"p","seq":1,"newer":true}');
  return lines;
}
function reverseKeys(v) {   // 같은 사건을 키 순서만 바꿔 쓴다(안쪽 객체까지)
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).reverse().forEach((k) => { o[k] = reverseKeys(v[k]); }); return o; }
  return v;
}
function partition(r, lines) {
  const k = 1 + Math.floor(r() * 4);
  const files = Array.from({ length: k }, () => []);
  for (const l of lines) {
    const copies = 1 + Math.floor(r() * 3);
    for (let c = 0; c < copies; c++) {
      let text = l;
      // 키 순서만 바꾼 같은 사건(앱이 쓰는 v1 사건만 — 해석하지 못한 줄은 글자 그대로가 같음이다)
      if (r() < 0.2 && L.parseLine(l).kind === 'event') text = JSON.stringify(reverseKeys(JSON.parse(l)));
      if (r() < 0.1) text = '  ' + text + '\t';
      pick(r, files).push(text);
    }
  }
  return shuffle(r, files.map((f) => shuffle(r, f)));
}
function bytes(lists) { return L.writeFile(L.merge(lists)); }
function viaFile(lists) { return L.readFile(bytes(lists)).lines; }

test('합치기는 읽는 순서·중복·나눔·키 순서와 무관하다(교환·멱등) — 30 시드 × 15 나눔', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const r = rng(seed);
    const lines = genLines(r);
    const want = bytes([lines]);
    for (let i = 0; i < 15; i++) assert.equal(bytes(partition(r, lines)), want, 'seed ' + seed + ' 나눔 ' + i);
    assert.equal(bytes([lines, lines]), want);
    assert.equal(bytes([viaFile([lines])]), want, '파일로 썼다 읽어도 같다');
  }
});

test('합치기는 결합적이다 — (A∪B)∪C = A∪(B∪C) = A∪B∪C, 파일을 거쳐도', () => {
  for (let seed = 100; seed < 130; seed++) {
    const r = rng(seed);
    const [a, b, c] = [genLines(r), genLines(r), genLines(r)];
    const all = bytes([a, b, c]);
    assert.equal(bytes([viaFile([a, b]), c]), all);
    assert.equal(bytes([a, viaFile([b, c])]), all);
    assert.equal(bytes([viaFile([c]), viaFile([a]), viaFile([b])]), all);
  }
});

test('유실 0 — 들어간 모든 줄(정규형)이 나온 파일에 있고, 없던 줄은 생기지 않는다', () => {
  for (let seed = 200; seed < 240; seed++) {
    const r = rng(seed);
    const lines = genLines(r);
    const expect = new Set(lines.map((l) => { const p = L.parseLine(l); return p.kind === 'event' ? p.event.line : p.text; }));
    const out = L.readFile(bytes(partition(r, lines))).lines;
    assert.deepEqual(new Set(out), expect, 'seed ' + seed);
    assert.equal(out.length, expect.size);
  }
});

test('다시 계산도 나눔과 무관하다 · 중복을 더해도 같다', () => {
  for (let seed = 300; seed < 330; seed++) {
    const r = rng(seed);
    const lines = genLines(r);
    const want = JSON.stringify(R.run(L.merge([lines]).events, { today: '2026-06-01' }));
    for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(R.run(L.merge(partition(r, lines)).events, { today: '2026-06-01' })), want, 'seed ' + seed);
  }
});

// 두 기기가 각자 아는 기록만 보고 due 카드를 복습하고, 가끔 기록을 주고받는다
function simulate(r, days, syncP, gradeOf) {
  const known = { p: [], h: [] }, seq = { p: 0, h: 0 };
  let day = '2026-01-01';
  for (let d = 0; d < days; d++) {
    for (const dev of shuffle(r, ['p', 'h'])) {
      const st = R.run(L.merge([known[dev]]).events, { today: day });
      for (const card of ['k1', 'k2']) {
        const cur = (st.cards.a || {})[card];
        if (!cur || S.isDue(cur, day)) {
          seq[dev] += 1;
          known[dev].push(L.make({ dev: dev, seq: seq[dev], t: day + 'T0' + (dev === 'p' ? 7 : 9) + ':00:00.000Z', day: day, type: 'review', course: 'a', card: card, grade: gradeOf(r) }).line);
        }
      }
    }
    if (r() < syncP) { const both = viaFile([known.p, known.h]); known.p = both.slice(); known.h = both.slice(); }
    day = D.addDays(day, 1);
  }
  return R.run(L.merge([known.p, known.h]).events, { today: day });
}

test('늦은 복습 규칙 — 카드마다 하루에 반영되는 성공 복습은 1번, again 은 1번까지(간격이 부풀지 않는다)', () => {
  for (let seed = 400; seed < 430; seed++) {
    const r = rng(seed);
    const st = simulate(r, 120, 0.15, (rr) => pick(rr, ['again', 'hard', 'good', 'good', 'easy']));
    const per = {};
    for (const x of st.reviews.filter((v) => v.applied)) {
      const k = x.card + x.day + (x.grade === 'again' ? 'A' : 'S');
      per[k] = (per[k] || 0) + 1;
      assert.ok(per[k] <= 1, 'seed ' + seed + ' ' + k);
    }
    for (const c of Object.values(st.cards.a)) assert.ok(c.interval <= 180);
  }
});

test('늦은 복습 규칙 — 합치지 않은 두 기기가 같은 날 같은 등급이면 합친 결과는 한 기기와 같다', () => {
  for (let seed = 500; seed < 520; seed++) {
    const r = rng(seed);
    const grades = Array.from({ length: 12 }, () => pick(r, ['hard', 'good', 'good', 'easy']));
    let i = 0;
    const alone = { p: [], h: [] };
    for (const dev of ['p', 'h']) {
      let st = S.newCardState(), day = '2026-01-01';
      for (i = 0; i < grades.length; i++) {
        alone[dev].push(L.make({ dev: dev, seq: i + 1, t: day + 'T0' + (dev === 'p' ? 7 : 9) + ':00:00.000Z', day: day, type: 'review', course: 'a', card: 'k1', grade: grades[i] }).line);
        st = S.review(st, grades[i], day); day = st.due;
      }
    }
    const merged = R.run(L.merge([alone.p, alone.h]).events, { today: '2099-01-01' }).cards.a.k1;
    const single = R.run(L.merge([alone.p]).events, { today: '2099-01-01' }).cards.a.k1;
    assert.deepEqual(merged, single, 'seed ' + seed);
  }
});
