// 등급 A — web/core/regex.js (FR-244, 독립 점검 ② F1·F2·F5). 실습 정규식 답을 선형 시간(톰프슨 NFA)으로 맞춰 본다.
// 대조 기준은 V8 의 RegExp(유니코드 아닌 모드 — 지금까지 checkLab 이 쓰던 것)다: 짧은 무작위 패턴·답에서 결과가 같아야 한다.
// 시험 먼저 2026-11-09.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core, rng, pick } = require('./helpers');
const R = core('regex');

function native(p, ic) { return new RegExp('^(?:' + p + ')$', ic ? 'i' : ''); }
function same(p, ic, inputs) {
  const c = R.compile(p, ic);
  assert.equal(c.why, undefined, p + ' → ' + c.why);
  for (const s of inputs) assert.equal(R.fullMatch(c.prog, s), native(p, ic).test(s), JSON.stringify(p) + (ic ? '/i' : '') + ' ' + JSON.stringify(s));
}

test('전체 일치·대안·반복·묶음·글자 묶음 — V8 과 같다', () => {
  same('a|b', false, ['a', 'b', 'ab', '', 'c']);
  same('(?:ab)*c?', false, ['', 'ab', 'abab', 'ababc', 'abc', 'aba', 'c']);
  same('[^a]\\d{2,3}', false, ['b12', 'b123', 'b1234', 'a12', '\n12']);
  same('^a$|^b', false, ['a', 'b', 'ba']);
  same('\\bfoo\\b.*', false, ['foo', 'foo bar', 'foobar']);
  same('a{0}b{1,}c{2}', false, ['bcc', 'bbbcc', 'abcc', 'cc']);
  same('[]?x|[^]y', false, ['x', 'y', '\ny', 'xy']);
  same('[\\d-z]+', false, ['1-z', 'a', '-']);
  same('a{,2}|x{', false, ['a{,2}', 'aa', 'x{']);
  same('\\x41\\u00e9\\cA\\t\\0', false, ['Aé\u0001\t\u0000', 'Ae\u0001\t\u0000']);
  same('\\c1', false, ['\\c1', '\u0011']);
  same('[\\c1\\c_]', false, ['\u0011', '\u001f', 'c']);
  same('[\\c.][\\t\\n][\\x41\\u00e9\\q\\x4\\u00e]+', false, ['\\\tA', 'c\nAéq', '.\tx4', 'c\tu00e', '\\\nAA', 'q\tq']);
  same('(a*)*b|(a|)+c', false, ['b', 'aab', 'c', 'aac', 'a']);
  same('.', false, ['\n', '\r', '\u2028', 'x', '\uD83D']);
  same('\\s\\S', false, ['\uFEFFx', '\u3000 ', ' \u00A0']);
  same('(?<n>a)b', false, ['ab']);
});

test('대소문자 무시 — V8 의 유니코드 아닌 모드 규칙(Canonicalize)과 같다', () => {
  same('[ς]', true, ['σ', 'Σ', 'ς', 's']);
  same('µ|[a-z]+|\\w', true, ['Μ', 'μ', 'ABC', 'ſ', 'K', '\u212A']);
  same('[^a]', true, ['A', 'a', 'b']);
  same('ß', true, ['SS', 'ß', 'ẞ']);
  same('\\W', true, ['k', 'ſ', '\u212A']);
});

test('지원하지 않는 문법은 이유와 함께 거부 — 뒤돌아보기·역참조·옛 8진수', () => {
  for (const [p, why] of [['(?=a)a', '지원하지 않는 문법'], ['(?!a)b', '지원하지 않는 문법'], ['(?<=a)b', '지원하지 않는 문법'], ['(?<!a)b', '지원하지 않는 문법'],
    ['(a)\\1', '역참조'], ['(?<n>a)\\k<n>', '역참조'], ['\\01', '지원하지 않는 문법'], ['[\\1]', '지원하지 않는 문법']])
    assert.equal(R.compile(p, false).why, why, p);
  for (const p of ['a)|(b', '(a', 'a**', '*a', '[b-a]', 'a{2,1}', '\\', '[a', '^*', '\\b+'])
    assert.equal(R.compile(p, false).why, '문법', p);
  assert.equal(R.compile('(a{100}){100}', false).why, '너무 큼');
  assert.equal(R.compile('(){99999999}', false).why, '너무 큼');
});

test('무작위 패턴 × 답 — V8 과 같은 결과(시드 고정, 패턴 4천 × 답 10)', () => {
  const r = rng(20261109);
  const ATOMS = ['a', 'b', 'A', 'é', 'É', 'σ', 'ς', 'Σ', '.', '\\d', '\\D', '\\w', '\\W', '\\s', '\\S', '[ab]', '[^a]', '[a-c]', '[A-Z]', '[\\d-]',
    '[\\w.]', '[^\\s]', '[]', '[^]', '[-a]', '[a-]', '[\\b]', '\\.', '\\(', '\\)', '\\[', '\\]', '\\x41', '\\u00e9', '\\cA', '\\t', '\\n', '\\-', '\\/',
    '-', '{', '}', ']', ',', '1', '_', ' ', '\\b', '\\B', '^', '$', '\\c', '\\k', '\\p'];
  const QUANT = ['', '', '', '*', '+', '?', '{2}', '{1,3}', '{0,}', '{2,}', '*?', '+?', '??', '{1}', '{0,1}'];
  const INPUT = ['a', 'b', 'A', 'B', 'c', 'é', 'É', 'σ', 'ς', 'Σ', '1', '_', '-', ' ', '\t', '\n', '.', '(', ')', '[', ']', '\u0001', '\b', '{', '}', '/', ',', '\\', 'k', 'p'];
  function gen(depth) {
    let out = '';
    const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      if (depth < 3 && r() < 0.25) out += pick(r, ['(', '(?:']) + gen(depth + 1) + ')' + pick(r, QUANT);
      else out += pick(r, ATOMS) + pick(r, QUANT);
      if (r() < 0.12) out += '|';
    }
    return out;
  }
  let compared = 0, matched = 0, rejected = 0;
  for (let k = 0; k < 4000; k++) {
    const p = gen(0), ic = r() < 0.3;
    try { native(p, ic); new RegExp(p, ic ? 'i' : ''); } catch (e) { rejected++; assert.ok(R.compile(p, ic).why, 'V8 이 거부하는데 받음: ' + p); continue; }
    const c = R.compile(p, ic);
    assert.equal(c.why, undefined, JSON.stringify(p) + ' → ' + c.why);
    for (let j = 0; j < 10; j++) {
      let s = '';
      const len = Math.floor(r() * 7);
      for (let q = 0; q < len; q++) s += pick(r, INPUT);
      const want = native(p, ic).test(s);
      assert.equal(R.fullMatch(c.prog, s), want, JSON.stringify(p) + (ic ? '/i' : '') + ' ' + JSON.stringify(s));
      compared++; if (want) matched++;
    }
  }
  assert.ok(compared > 30000 && matched > compared * 0.03, 'compared ' + compared + ' matched ' + matched + ' rejected ' + rejected);
});

test('선형 시간 — 되짚기 정규식이 멈추던 패턴도 답 500자에서 빨리 끝난다(독립 점검 ② F1·F2)', () => {
  const cases = [['.*.*.*.*b', 'a'.repeat(500)], ['.*a.*a.*a.*b', 'a'.repeat(500)], ['\\w*\\w*\\w*\\w*!', 'a'.repeat(500)], ['a+a+a+a+a+a+a+b', 'a'.repeat(500)],
    ['(a+){20}b', 'a'.repeat(500)], ['(?:a+){2}(?:a+){2}(?:a+){2}b', 'a'.repeat(500)], ['(a|a)'.repeat(40), 'a'.repeat(40) + 'x'], ['[]?(a+)+$]', 'a'.repeat(500)],
    ['(a+)+$', 'a'.repeat(499) + 'b'], ['(.*a){3,}', 'a'.repeat(499) + 'b'], ['(x{2,})+', 'x'.repeat(499) + 'y'], ['(a|aa)+', 'a'.repeat(499) + 'b'], ['(a*)*b', 'a'.repeat(500)]];
  for (const [p, s] of cases) {
    const t0 = Date.now(), c = R.compile(p, false);
    assert.equal(c.why, undefined, p);
    assert.equal(R.fullMatch(c.prog, s), false, p);
    assert.ok(Date.now() - t0 < 300, p + ' ' + (Date.now() - t0) + 'ms');
  }
});
