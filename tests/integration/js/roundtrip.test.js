// 등급 B — 기록 왕복 명령(scripts/check_log_roundtrip.js)을 시드 셋으로 돌리고, 일부러 한 줄을 버리면 실패하는지 본다(FR-228). 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'check_log_roundtrip.js');
function run(args) { return spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' }); }

test('시드 셋 × 60일 — 유실 0', () => {
  for (const seed of ['1', '77', '4242']) {
    const r = run(['--rounds', '60', '--seed', seed]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /유실 0/);
  }
});

test('음성 — 들여오기에서 한 줄을 버리면 잡는다', () => {
  const r = run(['--rounds', '60', '--seed', '1', '--inject-loss']);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /문제/);
});
