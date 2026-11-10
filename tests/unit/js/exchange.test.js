// 등급 A — web/core/exchange.js (FR-420~424, docs/P4_설계서_Mobile.md 3.4절). 교환 파일 만들기·열기, 파일 종류, 해시 대조, 한도.
// 시험 먼저 2026-11-10 — 모듈이 없을 때 실패를 보고 구현했다(테스트결과서 7절).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const zlib = require('zlib');
const { ROOT, core } = require('./helpers');
const X = core('exchange'), Z = core('zip'), L = core('log'), H = core('hash');
const SC = require(path.join(ROOT, 'web', 'store', 'common.js'));

const inflate = (data, max) => Promise.resolve(new Uint8Array(zlib.inflateRawSync(Buffer.from(data), { maxOutputLength: Math.max(1, max) })));
const enc = (s) => new TextEncoder().encode(s);
function ev(dev, seq, day, extra) {
  return L.make(Object.assign({ dev: dev, seq: seq, t: day + 'T01:00:00.000Z', day: day, type: 'review', course: 'c1', card: 'k' + seq, grade: 'good' }, extra || {})).line;
}
const NOTES = { format: 'mylearner-course', version: 1, min_reader: 1, id: 'mwl-notes', title: '내 메모', kind: 'notes', parts: [], lessons: {} };
const APP = { version: '0.4.0', edition: 'mobile', label: '모바일판' };
const NOW = new Date('2026-11-10T14:30:00.000Z');
function sample() {
  return X.build({ lines: [ev('aaaa000000000001', 2, '2026-11-09'), ev('aaaa000000000001', 1, '2026-11-08')], raw: ['not json line'],
    courses: [NOTES], app: APP, dev: 'aaaa000000000001', now: NOW, dayStartHour: 0 });
}
// zip 을 다시 짠다(항목 하나를 바꾸거나 빼서)
async function rezip(bytes, change) {
  const l = Z.list(bytes);
  const items = [];
  for (const e of l.entries) items.push({ name: e.name, bytes: await Z.extract(bytes, e, inflate) });
  return Z.write(change(items));
}

test('만들기 — 이름·항목 순서·머리·기록 파일, 같은 입력이면 같은 바이트', async () => {
  const a = sample(), b = sample();
  assert.equal(a.name, 'mylearner-exchange-2026-11-10-aaaa00.zip');
  assert.deepEqual(a.bytes, b.bytes);
  const l = Z.list(a.bytes);
  assert.deepEqual(l.entries.map((e) => e.name), ['manifest.json', 'log.jsonl', 'courses/mwl-notes.json']);
  const m = JSON.parse(Z.text(await Z.extract(a.bytes, l.entries[0], inflate)));
  assert.equal(m.format, 'mylearner-exchange');
  assert.equal(m.version, 1);
  assert.equal(m.min_reader, 1);
  assert.deepEqual(m.app, { name: 'mylearner', version: '0.4.0', edition: 'mobile', label: '모바일판' });
  assert.equal(m.dev, 'aaaa000000000001');
  assert.equal(m.made_at, '2026-11-10T14:30:00.000Z');
  assert.equal(m.day, '2026-11-10');
  const log = Z.text(await Z.extract(a.bytes, l.entries[1], inflate));
  assert.equal(m.files[0].path, 'log.jsonl');
  assert.equal(m.files[0].lines, 3);
  assert.equal(m.files[0].sha256, H.sha256Hex(log));
  assert.equal(m.files[0].bytes, enc(log).length);
  assert.equal(log.split('\n')[0], L.HEADER);
  assert.equal(log.split('\n')[1], ev('aaaa000000000001', 1, '2026-11-08'));   // 다시 계산 순서
  assert.equal(log.trim().split('\n').pop(), 'not json line');                   // 해석하지 못한 줄도 싣는다
  assert.deepEqual(m.files[1], { path: 'courses/mwl-notes.json', id: 'mwl-notes', bytes: m.files[1].bytes, sha256: m.files[1].sha256 });
});

test('열기 — 교환 파일의 줄과 사용자 과정', async () => {
  const r = await X.open(sample().bytes, { inflateRaw: inflate });
  assert.equal(r.ok, true, r.error + ' ' + r.msg);
  assert.equal(r.kind, 'exchange');
  assert.equal(r.manifest.dev, 'aaaa000000000001');
  assert.deepEqual(r.lines, [ev('aaaa000000000001', 1, '2026-11-08'), ev('aaaa000000000001', 2, '2026-11-09'), 'not json line']);
  assert.equal(r.courses.length, 1);
  assert.equal(r.courses[0].id, 'mwl-notes');
  assert.deepEqual(r.courses[0].obj, NOTES);
});

test('열기 — 풀었다 한 폴더 아래로 다시 묶은 zip(deflate)도 읽는다', async () => {
  const s = sample().bytes, l = Z.list(s);
  const items = [];
  for (const e of l.entries) items.push({ name: 'mylearner-exchange-x/' + e.name, text: Z.text(await Z.extract(s, e, inflate)) });
  // 손으로 deflate zip — zip.test.js 의 방식을 짧게
  const parts = [], cd = [];
  let off = 0;
  const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const it of [{ name: 'mylearner-exchange-x/', text: '' }].concat(items)) {
    const name = enc(it.name), raw = enc(it.text), data = new Uint8Array(zlib.deflateRawSync(Buffer.from(raw))), crc = Z.crc32(raw);
    const local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0x21), u32(crc), u32(data.length), u32(raw.length), u16(name.length), u16(0));
    parts.push(Uint8Array.from(local), name, data);
    cd.push(Uint8Array.from([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0x21), u32(crc), u32(data.length), u32(raw.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), name);
    off += local.length + name.length + data.length;
  }
  const cdLen = cd.reduce((a, b) => a + b.length, 0), n = items.length + 1;
  const all = parts.concat(cd, [Uint8Array.from([].concat(u32(0x06054b50), u16(0), u16(0), u16(n), u16(n), u32(cdLen), u32(off), u16(0)))]);
  const z = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) { z.set(a, p); p += a.length; }
  const r = await X.open(z, { inflateRaw: inflate });
  assert.equal(r.ok, true, r.error + ' ' + r.msg);
  assert.equal(r.lines.length, 3);
  assert.equal(r.courses[0].id, 'mwl-notes');
});

test('열기 — 기록 파일(.jsonl — P3 내려받기·백업)도 받는다', async () => {
  const text = L.writeFile(L.merge([[ev('bb00000000000001', 1, '2026-11-01')]]));
  const r = await X.open(enc('\uFEFF' + text), {});
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'log');
  assert.deepEqual(r.lines, [ev('bb00000000000001', 1, '2026-11-01')]);
  assert.deepEqual(r.courses, []);
  assert.equal(r.manifest, null);
});

test('파일 종류 — MWL 진도·모르는 파일·기록 판이 새것', async () => {
  assert.equal(X.sniff(sample().bytes), 'zip');
  assert.equal(X.sniff(enc(L.HEADER + '\n')), 'log');
  assert.equal(X.sniff(enc('{"schema": 2, "cards": {}}')), 'mwl');
  assert.equal(X.sniff(enc('hello')), 'unknown');
  assert.equal(X.sniff(new Uint8Array(0)), 'unknown');
  assert.equal((await X.open(enc('{"schema": 2, "cards": {}}'), {})).error, 'E-FILE-MWL');
  assert.equal((await X.open(enc('hello'), {})).error, 'E-FILE-KIND');
  assert.equal((await X.open(enc('{"format":"mylearner-log","min_reader":9,"version":9}\n'), {})).error, 'E-LOG-READER');
});

test('거부 — 머리가 없음·형식이 다름·더 새 판·적힌 파일이 없음·해시가 다름', async () => {
  const s = sample().bytes;
  const noManifest = await rezip(s, (it) => it.filter((x) => x.name !== 'manifest.json'));
  assert.equal((await X.open(noManifest, { inflateRaw: inflate })).error, 'E-EX-MISSING');
  const set = (fn) => rezip(s, (it) => it.map((x) => x.name === 'manifest.json' ? { name: x.name, bytes: enc(JSON.stringify(fn(JSON.parse(Z.text(x.bytes))))) } : x));
  assert.equal((await X.open(await set((m) => Object.assign(m, { format: 'other' })), { inflateRaw: inflate })).error, 'E-EX-FORMAT');
  assert.equal((await X.open(await set((m) => Object.assign(m, { min_reader: 2 })), { inflateRaw: inflate })).error, 'E-EX-READER');
  assert.equal((await X.open(await rezip(s, (it) => it.filter((x) => x.name !== 'log.jsonl')), { inflateRaw: inflate })).error, 'E-EX-MISSING');
  const r = await X.open(await rezip(s, (it) => it.map((x) => x.name === 'log.jsonl' ? { name: x.name, bytes: enc(Z.text(x.bytes).replace('good', 'easy')) } : x)), { inflateRaw: inflate });
  assert.equal(r.error, 'E-EX-HASH');
  assert.match(r.msg, /log\.jsonl/);
  const notJson = await rezip(s, (it) => it.map((x) => x.name === 'manifest.json' ? { name: x.name, bytes: enc('{') } : x));
  assert.equal((await X.open(notJson, { inflateRaw: inflate })).error, 'E-EX-FORMAT');
  assert.equal((await X.open(s.subarray(0, s.length - 5), { inflateRaw: inflate })).error, 'E-ZIP');
});

test('거부 — 64 KiB 넘는 줄(저장소가 받지 않는다)·기록 파일 머리가 틀림', async () => {
  assert.equal(X.LINE_MAX, SC.MAX_LINE_BYTES);
  const long = '{"x":"' + 'a'.repeat(70000) + '"}';
  const r = await X.open(enc(L.HEADER + '\n' + long + '\n'), {});
  assert.equal(r.error, 'E-LINE-LONG');
  const bad = await X.open(enc('{"format":"mylearner-course"}\n'), {});
  assert.equal(bad.error, 'E-FILE-KIND');
});

test('사용자 과정 — JSON 이 아니면 그 과정만 오류로 남기고 나머지는 연다', async () => {
  const s = sample().bytes;
  const z = await rezip(s, (it) => it.map((x) => x.name === 'courses/mwl-notes.json' ? { name: x.name, bytes: enc('{oops') } : x));
  // 해시가 먼저 걸리지 않게 머리도 고친다
  const z2 = await rezip(z, (it) => it.map((x) => {
    if (x.name !== 'manifest.json') return x;
    const m = JSON.parse(Z.text(x.bytes));
    m.files[1].sha256 = H.sha256Hex('{oops'); m.files[1].bytes = 5;
    return { name: x.name, bytes: enc(JSON.stringify(m)) };
  }));
  const r = await X.open(z2, { inflateRaw: inflate });
  assert.equal(r.ok, true, r.error + ' ' + r.msg);
  assert.equal(r.courses.length, 1);
  assert.equal(r.courses[0].obj, null);
  assert.match(r.courses[0].error, /JSON/);
});

test('머리의 파일 경로가 위험하거나 과정 경로 꼴이 아니면 거부', async () => {
  const s = sample().bytes;
  const set = (fn) => rezip(s, (it) => it.map((x) => x.name === 'manifest.json' ? { name: x.name, bytes: enc(JSON.stringify(fn(JSON.parse(Z.text(x.bytes))))) } : x));
  assert.equal((await X.open(await set((m) => { m.files[1].path = '../x.json'; return m; }), { inflateRaw: inflate })).error, 'E-EX-FORMAT');
  assert.equal((await X.open(await set((m) => { m.files = 'x'; return m; }), { inflateRaw: inflate })).error, 'E-EX-FORMAT');
});
