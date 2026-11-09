// JS 시험 공통 도움 함수 — core 파일 읽기, 고정 자료, 키 정렬 비교, 시드 고정 난수(mulberry32).
// 문서: docs/P2_설계서_Core.md 6절. 시험은 저장소 루트에서 node --test 로 돈다(scripts/run_js_tests.sh).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function core(name) { return require(path.join(ROOT, 'web', 'core', name + '.js')); }
function fixture(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', rel), 'utf8')); }
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = sortKeys(v[k]); }); return o; }
  return v;
}
function same(a, b) { return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b)); }
function rng(seed) {   // mulberry32 — 같은 시드면 같은 사례
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function shuffle(r, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

module.exports = { ROOT, core, fixture, sortKeys, same, rng, pick, shuffle };
