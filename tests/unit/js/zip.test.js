// 등급 A — web/core/zip.js (FR-420·423, docs/P4_설계서_Mobile.md 3.4절). 교환 파일의 zip 쓰기·읽기, CRC-32, 거부 사례.
// 시험 먼저 2026-11-10 — 모듈이 없을 때 실패를 보고 구현했다(테스트결과서 7절).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { core } = require('./helpers');
const Z = core('zip');

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const inflate = (data, max) => Promise.resolve(new Uint8Array(zlib.inflateRawSync(Buffer.from(data), { maxOutputLength: Math.max(1, max) })));

// 손으로 zip 을 짠다 — 저장(0)·deflate(8)·데이터 서술자·암호 플래그·zip64 표시 같은 사례를 만들려고
function u16(n) { return [n & 255, (n >>> 8) & 255]; }
function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
function handZip(items, opts) {
  opts = opts || {};
  const parts = [], cd = [];
  let off = 0;
  for (const it of items) {
    const name = enc(it.name), raw = enc(it.text || '');
    const method = it.method === undefined ? 0 : it.method;
    const data = method === 8 ? new Uint8Array(zlib.deflateRawSync(Buffer.from(raw))) : (it.data || raw);
    const crc = it.crc === undefined ? Z.crc32(raw) : it.crc;
    const size = it.size === undefined ? raw.length : it.size, csize = it.csize === undefined ? data.length : it.csize;
    const flag = (it.flag || 0) | 0x0800;
    const descr = (flag & 8) !== 0;
    const local = [].concat(u32(0x04034b50), u16(20), u16(flag), u16(method), u16(0), u16(0x21),
      u32(descr ? 0 : crc), u32(descr ? 0 : csize), u32(descr ? 0 : size), u16(name.length), u16(0));
    parts.push(Uint8Array.from(local), name, data);
    if (descr) parts.push(Uint8Array.from([].concat(u32(0x08074b50), u32(crc), u32(csize), u32(size))));
    cd.push(Uint8Array.from([].concat(u32(0x02014b50), u16(20), u16(20), u16(flag), u16(method), u16(0), u16(0x21),
      u32(crc), u32(csize), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(it.offset === undefined ? off : it.offset))), name);
    off += local.length + name.length + data.length + (descr ? 16 : 0);
  }
  const cdLen = cd.reduce((a, b) => a + b.length, 0);
  const n = opts.count === undefined ? items.length : opts.count;
  const comment = enc(opts.comment || '');
  const end = Uint8Array.from([].concat(u32(0x06054b50), u16(opts.disk || 0), u16(0), u16(n), u16(n), u32(cdLen), u32(opts.cdOffset === undefined ? off : opts.cdOffset), u16(comment.length)));
  const all = parts.concat(cd, [end, comment]);
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

test('CRC-32 — 표준 확인값', () => {
  assert.equal(Z.crc32(enc('123456789')), 0xCBF43926);
  assert.equal(Z.crc32(new Uint8Array(0)), 0);
  assert.equal(Z.crc32(enc('가')), Z.crc32(Uint8Array.from([0xEA, 0xB0, 0x80])));
});

test('쓰기 → 읽기 왕복 — 한글 이름·빈 항목, 같은 입력이면 같은 바이트', async () => {
  const items = [{ name: 'manifest.json', bytes: enc('{"a":1}') }, { name: 'courses/메모.json', bytes: enc('{"가":"나"}') }, { name: 'empty.txt', bytes: new Uint8Array(0) }];
  const a = Z.write(items), b = Z.write(items.map((x) => ({ name: x.name, bytes: Uint8Array.from(x.bytes) })));
  assert.deepEqual(a, b);
  const l = Z.list(a);
  assert.equal(l.ok, true, l.error);
  assert.deepEqual(l.entries.map((e) => e.name), items.map((x) => x.name));
  for (let i = 0; i < items.length; i++) {
    assert.equal(l.entries[i].method, 0);
    assert.deepEqual(await Z.extract(a, l.entries[i], inflate), items[i].bytes);
  }
  // 지역 머리: 서명·UTF-8 플래그·시각 1980-01-01 00:00(DOS 날짜 0x21, 시각 0)
  assert.deepEqual(Array.from(a.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(a[6] | (a[7] << 8), 0x0800);
  assert.equal(a[10] | (a[11] << 8), 0);
  assert.equal(a[12] | (a[13] << 8), 0x21);
});

test('쓰기는 이름 규칙을 지킨다 — 빈 이름·같은 이름·.. 는 던진다', () => {
  assert.throws(() => Z.write([{ name: '', bytes: new Uint8Array(0) }]), /이름/);
  assert.throws(() => Z.write([{ name: 'a', bytes: new Uint8Array(0) }, { name: 'a', bytes: new Uint8Array(0) }]), /같은 이름/);
  assert.throws(() => Z.write([{ name: '../a', bytes: new Uint8Array(0) }]), /이름/);
});

test('deflate 항목·데이터 서술자·끝 주석 — 사용자가 풀었다 다시 묶은 zip 도 읽는다', async () => {
  const z = handZip([{ name: 'log.jsonl', text: 'x'.repeat(5000) + '\n가나다', method: 8, flag: 8 }, { name: 'b.txt', text: 'hello' }], { comment: 'made by tool' });
  const l = Z.list(z);
  assert.equal(l.ok, true, l.error);
  assert.equal(l.entries[0].method, 8);
  assert.equal(dec(await Z.extract(z, l.entries[0], inflate)), 'x'.repeat(5000) + '\n가나다');
  assert.equal(dec(await Z.extract(z, l.entries[1], inflate)), 'hello');
});

test('거부 — zip 이 아님·끝 레코드 없음·여러 디스크·디렉터리 범위 밖', () => {
  assert.equal(Z.list(enc('not a zip at all')).error, 'E-ZIP');
  assert.equal(Z.list(new Uint8Array(0)).error, 'E-ZIP');
  assert.equal(Z.list(handZip([{ name: 'a', text: 'a' }], { disk: 1 })).error, 'E-ZIP');
  assert.equal(Z.list(handZip([{ name: 'a', text: 'a' }], { cdOffset: 99999 })).error, 'E-ZIP');
  assert.equal(Z.list(handZip([{ name: 'a', text: 'a' }], { count: 3 })).error, 'E-ZIP');
});

test('거부 — 위험한 이름(절대 경로·..·역슬래시·NUL)·같은 이름 두 번', () => {
  for (const name of ['/etc/passwd', '../x', 'a/../../x', 'a\\b', 'a\u0000b']) {
    const r = Z.list(handZip([{ name: name, text: 'a' }]));
    assert.equal(r.ok, false, name);
    assert.equal(r.error, 'E-ZIP', name);
  }
  assert.equal(Z.list(handZip([{ name: 'a', text: '1' }, { name: 'a', text: '2' }])).error, 'E-ZIP');
});

test('거부 — 암호·모르는 압축·zip64 표시', () => {
  assert.equal(Z.list(handZip([{ name: 'a', text: 'a', flag: 1 }])).error, 'E-ZIP-METHOD');
  assert.equal(Z.list(handZip([{ name: 'a', text: 'a', method: 12 }])).error, 'E-ZIP-METHOD');
  assert.equal(Z.list(handZip([{ name: 'a', text: 'a', size: 0xFFFFFFFF }])).error, 'E-ZIP-METHOD');
});

test('한도 — 항목 수·항목 크기·모두 풀린 크기·파일 크기', () => {
  const lim = { file: 1 << 20, entries: 2, entry: 100, total: 150 };
  assert.equal(Z.list(handZip([{ name: 'a', text: 'a' }, { name: 'b', text: 'b' }, { name: 'c', text: 'c' }]), lim).error, 'E-ZIP-LIMIT');
  assert.equal(Z.list(handZip([{ name: 'a', text: 'x'.repeat(101) }]), lim).error, 'E-ZIP-LIMIT');
  assert.equal(Z.list(handZip([{ name: 'a', text: 'x'.repeat(80) }, { name: 'b', text: 'x'.repeat(80) }]), lim).error, 'E-ZIP-LIMIT');
  assert.equal(Z.list(handZip([{ name: 'a', text: 'a' }]), { file: 10, entries: 9, entry: 9, total: 9 }).error, 'E-ZIP-LIMIT');
  assert.equal(Z.list(handZip([{ name: 'a', text: 'a' }]), lim).ok, true);
  assert.ok(Z.LIMITS.file >= 256 * 1024 * 1024 && Z.LIMITS.entries === 1000);
});

test('풀기 — CRC·크기가 다르면 거부, 압축 풀기에 상한(적힌 크기)을 넘긴다', async () => {
  const bad = handZip([{ name: 'a', text: 'hello', crc: 1234 }]);
  await assert.rejects(Z.extract(bad, Z.list(bad).entries[0], inflate), /E-ZIP/);
  const z = handZip([{ name: 'a', text: 'hello world', method: 8, size: 5 }]);   // 적힌 크기 5 < 실제 11 — 폭탄 방어
  await assert.rejects(Z.extract(z, Z.list(z).entries[0], inflate), /E-ZIP/);
  let seen = null;
  const z2 = handZip([{ name: 'a', text: 'abc', method: 8 }]);
  await Z.extract(z2, Z.list(z2).entries[0], (d, max) => { seen = max; return inflate(d, max); });
  assert.equal(seen, 3);
  const z3 = handZip([{ name: 'a', text: 'abc', method: 8 }]);
  await assert.rejects(Z.extract(z3, Z.list(z3).entries[0], null), /E-ZIP-METHOD/);   // 압축 풀기가 없는 곳
});

test('지역 머리가 중앙 디렉터리와 다른 이름이면 거부', async () => {
  const z = handZip([{ name: 'ab', text: 'x' }]);
  z[30] = 0x7a;   // 지역 머리의 이름 첫 글자 'a' → 'z'
  await assert.rejects(Z.extract(z, Z.list(z).entries[0], inflate), /E-ZIP/);
});

test('UTF-8 — 잘못된 바이트는 E-UTF8', () => {
  assert.equal(Z.text(enc('가나')), '가나');
  assert.throws(() => Z.text(Uint8Array.from([0xff, 0xfe, 0x41])), /E-UTF8/);
  assert.deepEqual(Z.utf8('A가'), Uint8Array.from([0x41, 0xEA, 0xB0, 0x80]));
});
