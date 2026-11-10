// 등급 C(화면 상태) 회귀 — web/app/state.js 를 vm 에 실어 독립 점검(2026-11-10, 테스트결과서 5.2절) F-1·F-4 를 다시 본다. 시험 먼저(구현 전 실패 확인).
// F-4: 다른 탭이 되살려 저장소에서 빠진 줄이, 쓰기를 넘겨받은 탭의 다시 읽기(reloadLog)로 메모리에 되살아나면 안 된다 — 그러면 합치기가 그 줄을 '있음'으로 보고 N/N 을 거짓으로 맞춘다
// F-1: 이 기기 순번이 끝(MAX_SEQ)에 닿았으면 record 가 던지지 않고 띠를 띄우고 false
// 문서: docs/P4_설계서_Mobile.md 3.5·3.6절, docs/P4_테스트결과서_Mobile.md 5.2절
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, core } = require('../../unit/js/helpers');
const L = core('log'), M = core('merge'), R = core('replay'), C = core('constants');
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
function page(banners) {
  const sb = { console, setInterval() { return 0; }, Date, JSON, Math, Object, Array, Promise, Uint8Array, Number, String, RegExp, Error, TextEncoder, TextDecoder,
    localStorage: fakeLs(), crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } },
    addEventListener() {}, document: { addEventListener() {}, querySelectorAll: () => [], hidden: false }, location: { protocol: 'http:', hash: '' }, navigator: {} };
  sb.self = sb; sb.window = sb;
  vm.createContext(sb);
  const run = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sb, { filename: rel });
  ['constants', 'dates', 'srs', 'log', 'replay'].forEach((n) => run('web/core/' + n + '.js'));
  run('web/store/common.js');
  sb.MyLearner.ui = { banner(msg, kind) { banners.push([msg, kind]); }, esc: (x) => x };
  run('web/app/state.js');
  return sb.MyLearner.app;
}
function store() {
  let n = 0;
  return SB.create({ ls: fakeLs(), kv: fakeKv(), now: () => new Date(Date.UTC(2026, 10, 1) + (n += 1000)), random: (k) => Uint8Array.from({ length: k }, (_, i) => i + 1) });
}
const OWN = 'aaaaaaaaaaaaaaaa', OTH = 'bbbbbbbbbbbbbbbb';
const mk = (dev, seq) => L.make({ dev, seq, t: '2026-11-01T10:00:00.000Z', day: '2026-11-01', type: 'review', course: 'mwl', card: 'k' + (seq % 1000), grade: 'good' }).line;

test('F-4 — 되살리기로 저장소에서 빠진 줄은 다시 읽기(쓰기 넘겨받기)로 메모리에 돌아오지 않고, 그 줄을 다시 합치면 새 줄이다', async () => {
  const st = store();
  await st.init();
  const keep = mk(OWN, 1), X = mk(OTH, 1);
  await st.append([keep], '2026-11-01');
  const b = await st.backup('import-merge');
  await st.append([X], '2026-11-01');
  const A = page([]);
  A.store = st; A.dev = OWN; A.devBase = OWN;
  A.setEvents(await st.loadLog()); A.recompute(true);          // 읽기만 하던 탭 — 메모리에 X
  assert.ok(A.allLines().includes(X));
  const diff = await st.backupDiff(b.name);                       // 다른 탭이 되살린다 → 저장소에서 X 가 빠진다
  await st.restore(b.name, M.restorePlan({ onlyCurrent: diff.onlyCurrent, onlyBackup: diff.onlyBackup, isOwn: (d) => d === OWN }).remove);
  assert.ok(!(await st.loadLog()).includes(X));
  await A.reloadLog();                                            // 이 탭이 쓰기를 넘겨받으며 다시 읽는다(leaseTick·takeover)
  assert.equal(A.allLines().includes(X), false, '저장소에서 빠진 줄이 메모리에 남았다');
  assert.ok(A.allLines().includes(keep));
  const pv = M.preview({ have: A.allLines(), file: [X], today: '2026-11-02', isOwn: (d) => d === OWN, known: R.KNOWN });
  assert.equal(pv.fresh, 1);
});

test('F-4 — 다시 읽어도 저장 못 한 줄(pending)은 남는다', async () => {
  const st = store();
  await st.init();
  const A = page([]);
  A.store = st; A.dev = OWN; A.devBase = OWN;
  const p = mk(OWN, 7);
  A.pending.push(p);
  await A.reloadLog();
  assert.ok(A.allLines().includes(p));
});

test('F-1 — 이 기기 순번이 끝(MAX_SEQ)이면 record 는 던지지 않고 띠를 띄운 뒤 false, 아무것도 저장하지 않는다', async () => {
  const st = store();
  await st.init();
  await st.append([mk(OWN, C.MAX_SEQ)], '2026-11-01');
  const banners = [];
  const A = page(banners);
  A.store = st; A.dev = OWN; A.devBase = OWN; A.writer = 'mine';
  A.setEvents(await st.loadLog()); A.recompute(true);
  const before = (await st.loadLog()).length;
  let r;
  try { r = await A.record('review', { course: 'mwl', card: 'k1', grade: 'good' }); } catch (e) { assert.fail('record 가 던졌다: ' + e.message); }
  assert.equal(r, false);
  assert.ok(banners.some(([m, k]) => k === 'bad' && /순번/.test(m)), JSON.stringify(banners));
  assert.equal((await st.loadLog()).length, before);
  assert.equal(A.pending.length, 0);
});
