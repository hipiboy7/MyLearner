// 등급 A — 교환 파일(zip)로 오가는 기록 유실 0 속성 시험(P4 NFR-402, S3). 시드 고정 난수(helpers.rng) — 같은 시드 = 같은 사례.
// 기기 셋(폰·내 PC·폐쇄망)이 각자 브라우저 어댑터(가짜 저장소)에 쓰고, 폰·PC 는 교환 파일을 만들어(exchange.build → 바이트) 상대가 연다
// (exchange.open → merge.preview → store.append). 폐쇄망은 들여오기만 한다. 옛 파일을 다시 들여오기·같은 파일 두 번·순서 뒤섞기를 섞는다.
// 확인: ① 어느 기기도 줄이 줄지 않는다 ② 마지막 왕복 뒤 폰 = PC ③ 폐쇄망 = PC ∪ 폐쇄망이 쓴 줄 ④ 폐쇄망 줄은 밖에 없다 ⑤ 같은 입력 = 같은 교환 파일 바이트
// 문서: docs/P4_요구사항정의서_Mobile.md NFR-402, docs/P4_설계서_Mobile.md 3.10절
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT, core, rng, pick } = require('./helpers');
const L = core('log'), D = core('dates'), X = core('exchange'), M = core('merge'), R = core('replay');
const SB = require(path.join(ROOT, 'web', 'store', 'browser.js'));

function fakeLs() {
  const m = new Map();
  return { get length() { return m.size; }, key(i) { const k = Array.from(m.keys())[i]; return k === undefined ? null : k; },
    getItem(k) { return m.has(k) ? m.get(k) : null; }, setItem(k, v) { m.set(k, String(v)); }, removeItem(k) { m.delete(k); } };
}
function fakeKv() {
  const s = {};
  const st = (n) => (s[n] = s[n] || new Map());
  return { get: (n, k) => Promise.resolve(st(n).get(k)), put: (n, k, v) => Promise.resolve(void st(n).set(k, v)),
    keys: (n) => Promise.resolve(Array.from(st(n).keys())), del: (n, k) => Promise.resolve(void st(n).delete(k)) };
}

async function device(name, r) {
  let n = 0;
  const now = () => new Date(Date.UTC(2026, 10, 1) + (n += 1000));
  const rand = (k) => { const b = new Uint8Array(k); for (let i = 0; i < k; i++) b[i] = Math.floor(r() * 256); return b; };
  const st = SB.create({ ls: fakeLs(), kv: fakeKv(), now, random: rand });
  const info = await st.init();
  return { name, st, dev: info.dev, seq: 0, made: [], last: new Set() };
}
async function lines(d) { return (await d.st.loadLog()).map(M.keyOf); }
async function write(d, r, day) {
  const k = 1 + Math.floor(r() * 3), out = [];
  for (let i = 0; i < k; i++) {
    d.seq += 1;
    const kind = r();
    const f = kind < 0.7 ? { type: 'review', course: 'mwl', card: pick(r, ['k1', 'k2', 'k3', 'k4']), grade: pick(r, ['again', 'hard', 'good', 'easy']) }
      : kind < 0.85 ? { type: 'session', minutes: Math.floor(r() * 20), reviewed: 1 } : { type: 'lesson', course: 'mwl', lesson: pick(r, ['L1', 'L2']), done: true };
    out.push(L.make(Object.assign({ dev: d.dev, seq: d.seq, t: day + 'T0' + Math.floor(r() * 9) + ':00:00.000Z', day: day }, f)).line);
  }
  await d.st.append(out, day);
  d.made.push(...out);
}
async function exportFrom(d, day) {
  const have = await d.st.loadLog(), merged = L.merge([have]);
  const f = X.build({ lines: merged.events.map((e) => e.line), raw: merged.raw, courses: [], app: { version: '0.4.0', edition: d.name, label: d.name },
    dev: d.dev, now: new Date(day + 'T12:00:00.000Z'), dayStartHour: 0 });
  const again = X.build({ lines: merged.events.map((e) => e.line), raw: merged.raw, courses: [], app: { version: '0.4.0', edition: d.name, label: d.name },
    dev: d.dev, now: new Date(day + 'T12:00:00.000Z'), dayStartHour: 0 });
  assert.deepEqual(f.bytes, again.bytes, '같은 입력 = 같은 교환 파일 바이트');
  return f.bytes;
}
async function importInto(d, bytes, today) {
  const o = await X.open(bytes, {});
  assert.equal(o.ok, true, o.error + ' ' + o.msg);
  const have = await d.st.loadLog();
  const pv = M.preview({ have: have, file: o.lines, today: today, isOwn: (x) => x === d.dev, known: R.KNOWN });
  if (pv.fresh) await d.st.append(pv.freshLines, today);
  const after = await d.st.loadLog();
  assert.deepEqual(M.present(after, o.lines), { present: pv.total, total: pv.total }, d.name + ': 파일의 줄 N/N');
}
async function monotone(d) {
  const now = new Set(await lines(d));
  for (const l of d.last) assert.ok(now.has(l), d.name + ': 줄이 사라졌다');
  d.last = now;
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test('교환 파일 왕복·폐쇄망 반입 — 유실 0 (시드 ' + seed + ')', async () => {
    const r = rng(20261110 + seed);
    const phone = await device('mobile', r), pc = await device('internet', r), closed = await device('closed', r);
    const files = [];
    let day = '2026-11-01';
    for (let round = 0; round < 25; round++) {
      if (r() < 0.5) day = D.addDays(day, 1);
      for (const d of [phone, pc, closed]) if (r() < 0.6) await write(d, r, day);
      const op = r();
      if (op < 0.3) { const b = await exportFrom(phone, day); files.push(b); await importInto(pc, b, day); }
      else if (op < 0.55) { const b = await exportFrom(pc, day); files.push(b); await importInto(phone, b, day); }
      else if (op < 0.75) { const b = await exportFrom(pc, day); files.push(b); await importInto(closed, b, day); }
      else if (op < 0.9 && files.length) { await importInto(pick(r, [phone, pc, closed]), pick(r, files), day); }   // 옛 파일 다시
      else if (files.length) { const b = files[files.length - 1]; const to = pick(r, [phone, pc]); await importInto(to, b, day); await importInto(to, b, day); }
      for (const d of [phone, pc, closed]) await monotone(d);
    }
    // 마지막 왕복: 폰 → PC → 폰, PC → 폐쇄망
    await importInto(pc, await exportFrom(phone, day), day);
    const fromPc = await exportFrom(pc, day);
    await importInto(phone, fromPc, day);
    await importInto(closed, fromPc, day);
    const P = new Set(await lines(phone)), C = new Set(await lines(pc)), Z = new Set(await lines(closed));
    assert.deepEqual([...P].sort(), [...C].sort(), '폰 = PC');
    for (const l of [...phone.made, ...pc.made]) { assert.ok(C.has(l), 'PC 에 없는 줄'); assert.ok(Z.has(l), '폐쇄망에 없는 줄'); }
    for (const l of closed.made) { assert.ok(Z.has(l), '폐쇄망이 쓴 줄이 사라졌다'); assert.ok(!C.has(l) && !P.has(l), '폐쇄망 줄이 밖에 있다'); }
    assert.deepEqual([...Z].sort(), [...new Set([...C, ...closed.made])].sort(), '폐쇄망 = PC ∪ 폐쇄망이 쓴 줄');
  });
}
