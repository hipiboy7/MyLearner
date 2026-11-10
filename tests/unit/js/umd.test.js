// 등급 A — web/core/*.js 가 classic script 로 실린다(FR-201): module 이 없는 곳에서 전역 MyLearner 한 이름 아래 붙고, 순서가 틀리면 알려 준다.
// Node 의 vm 으로 브라우저처럼(self·module 없음) 싣는다. 실제 Chromium 은 scripts/render_smoke.py. 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./helpers');

const ORDER = ['constants', 'dates', 'hash', 'srs', 'regex', 'grade', 'course', 'log', 'replay', 'plan', 'mastery', 'stats', 'markdown', 'mwl_import', 'checkup'];
function load(names) {
  const ctx = { console: console };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const n of names) vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', 'core', n + '.js'), 'utf8'), ctx, { filename: n + '.js' });
  return ctx;
}

test('정한 순서로 실으면 MyLearner 아래 모두 붙고, 전역 이름은 MyLearner 하나다', () => {
  const ctx = load(ORDER);
  assert.deepEqual(Object.keys(ctx.MyLearner).sort(), ORDER.slice().sort());
  assert.deepEqual(Object.keys(ctx).filter((k) => k !== 'console' && k !== 'self').sort(), ['MyLearner']);
  assert.equal(ctx.MyLearner.markdown.render('**a**'), '<p><strong>a</strong></p>');
  assert.equal(ctx.MyLearner.hash.sha256Hex('abc').slice(0, 8), 'ba7816bf');
});

test('core 파일이 하나도 빠지지 않고 순서 목록에 있다', () => {
  const files = fs.readdirSync(path.join(ROOT, 'web', 'core')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
  assert.deepEqual(files, ORDER.slice().sort());
});

test('앞 파일을 빠뜨리면 무엇을 먼저 실어야 하는지 알린다', () => {
  assert.throws(() => load(['dates']), /MyLearner\.constants 을 먼저 싣는다/);
  assert.throws(() => load(['constants', 'dates', 'srs', 'course']), /MyLearner\.grade 을 먼저 싣는다/);
});
