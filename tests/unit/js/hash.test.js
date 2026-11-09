// 등급 A — web/core/hash.js. 기대값은 Python hashlib.sha256(s.encode('utf-8')) 로 만들었다(2026-10-15). 시험 먼저.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers');
const H = core('hash');

test('SHA-256 — Python hashlib 과 같다', () => {
  assert.equal(H.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(H.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(H.sha256Hex('한국어 기록 — 합치기'), '962125612198ffa61412e5f07e3705b04671831f806a242f80599077e23da79b');
  assert.equal(H.sha256Hex('a'.repeat(1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  assert.equal(H.sha256Hex('\u{1F600}x\u2028'), '301333ba2403c0e0d6f3e1ab7ec1ebd11141f91e8767011db10d36b76f3a875b');
});

test('블록 경계(55·56·63·64·65 바이트)도 Node crypto 와 같다', () => {
  const crypto = require('crypto');
  for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 128]) {
    const s = 'x'.repeat(n);
    assert.equal(H.sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'), String(n));
  }
});

test('짝 없는 서로게이트는 U+FFFD 로 부호화한다(TextEncoder 와 같다)', () => {
  const crypto = require('crypto');
  const s = 'a\uD800b';
  assert.equal(H.sha256Hex(s), crypto.createHash('sha256').update(Buffer.from(new TextEncoder().encode(s))).digest('hex'));
});
