// 등급 A — web/store/common.js (FR-322·324·325). 저장 어댑터의 순수 부분: 달 키, 줄 합집합, 쓰는 탭 임대, 백업 이름·남길 것.
// 시험 먼저 2026-11-09 — 모듈이 없을 때 실패를 보고 구현했다(테스트결과서 7절).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT, core } = require('./helpers');
const SC = require(path.join(ROOT, 'web', 'store', 'common.js'));
const L = core('log');

function ev(dev, seq, day, extra) {
  return L.make(Object.assign({ dev: dev, seq: seq, t: day + 'T01:00:00.000Z', day: day, type: 'session', minutes: 1, reviewed: 0 }, extra || {})).line;
}

test('달 키 — 사건 줄은 학습일의 달, 해석하지 못한 줄·새 판 줄은 raw 키', () => {
  assert.equal(SC.keyOf(ev('aa', 1, '2026-11-09')), 'mylearner.log.2026-11');
  assert.equal(SC.keyOf('{"v":2,"dev":"aa","seq":1,"t":"2026-11-09T00:00:00.000Z","day":"2026-11-09","type":"x"}'), 'mylearner.log.raw');
  assert.equal(SC.keyOf('not json'), 'mylearner.log.raw');
  assert.equal(SC.isLogKey('mylearner.log.2026-01'), true);
  assert.equal(SC.isLogKey('mylearner.log.raw'), true);
  assert.equal(SC.isLogKey('mylearner.logx'), false);
  assert.equal(SC.isLogKey('mwl.progress'), false);
});

test('글 ↔ 줄 — 빈 줄을 빼고 CR·LF 모두 나눈다', () => {
  assert.deepEqual(SC.splitText('a\n\nb\r\nc\r'), ['a', 'b', 'c']);
  assert.deepEqual(SC.splitText(''), []);
  assert.deepEqual(SC.splitText(null), []);
  assert.equal(SC.joinLines(['a', 'b']), 'a\nb');
});

test('합집합 — 있던 순서 그대로 + 없던 줄, 같은 글은 하나, 더한 수', () => {
  assert.deepEqual(SC.union(['a', 'b'], ['b', 'c', 'c', 'a', 'd']), { lines: ['a', 'b', 'c', 'd'], added: 2 });
  assert.deepEqual(SC.union([], []), { lines: [], added: 0 });
  assert.deepEqual(SC.union(['toString'], ['constructor', '__proto__']), { lines: ['toString', 'constructor', '__proto__'], added: 2 }, '상속 이름도 그냥 글');
});

test('줄을 키별로 묶기', () => {
  const a = ev('aa', 1, '2026-10-31'), b = ev('aa', 2, '2026-11-01'), c = 'junk';
  const g = SC.groupByKey([a, b, c, b]);
  assert.deepEqual(Object.keys(g).sort(), ['mylearner.log.2026-10', 'mylearner.log.2026-11', 'mylearner.log.raw']);
  assert.deepEqual(g['mylearner.log.2026-11'], [b, b]);
});

test('그 기기의 가장 큰 순번', () => {
  assert.equal(SC.maxSeq([ev('aa', 3, '2026-11-01'), ev('bb', 9, '2026-11-01'), ev('aa', 7, '2026-11-02'), 'junk'], 'aa'), 7);
  assert.equal(SC.maxSeq([], 'aa'), 0);
});

test('쓰는 탭 임대 — 없음·오래됨(6초 이상)·내 것이면 mine, 다른 탭이 6초 안이면 other', () => {
  assert.equal(SC.lease(null, 't1', 10000), 'mine');
  assert.equal(SC.lease({ id: 't2', at: 4000 }, 't1', 10000), 'mine');
  assert.equal(SC.lease({ id: 't2', at: 4001 }, 't1', 10000), 'other');
  assert.equal(SC.lease({ id: 't1', at: 9999 }, 't1', 10000), 'mine');
  assert.equal(SC.lease({ id: 't2', at: 20000 }, 't1', 10000), 'other', '시계가 앞선 다른 탭도 다른 탭');
  assert.equal(SC.lease({ at: 9000 }, 't1', 10000), 'mine', '꼴이 틀리면 없는 것');
  assert.equal(SC.parseLease('{"id":"t2","at":5}').id, 't2');
  assert.equal(SC.parseLease('{bad'), null);
  assert.equal(SC.parseLease(null), null);
});

test('백업 이름 — UTC 시각(밀리초)-까닭, 까닭 읽기', () => {
  const n = SC.backupName(new Date(Date.UTC(2026, 10, 9, 3, 4, 5, 6)), 'import-mwl');
  assert.equal(n, '20261109T030405006Z-import-mwl');
  assert.equal(SC.reasonOf(n), 'import-mwl');
  assert.equal(SC.reasonOf('20261109T030405006Z-daily'), 'daily');
  assert.equal(SC.reasonOf('bad'), null);
  assert.throws(() => SC.backupName(new Date(0), 'Bad Reason'), /까닭/);
});

test('남길 백업 — 들여오기 전 최근 20, 하루 최근 14, 지울 이름만 돌려준다', () => {
  const names = [];
  for (let i = 0; i < 25; i++) names.push('202611' + String(i).padStart(2, '0') + 'T000000000Z-import-mwl');
  for (let i = 0; i < 16; i++) names.push('202610' + String(i).padStart(2, '0') + 'T000000000Z-daily');
  names.push('junk-name');
  const del = SC.pruneBackups(names);
  assert.equal(del.length, 5 + 2);
  assert.ok(del.indexOf('20261100T000000000Z-import-mwl') >= 0, '가장 오래된 것부터');
  assert.ok(del.indexOf('20261105T000000000Z-import-mwl') < 0, '최근 20개는 남긴다');
  assert.ok(del.indexOf('20261001T000000000Z-daily') >= 0);
  assert.ok(del.indexOf('junk-name') < 0, '모르는 이름은 지우지 않는다');
  assert.deepEqual(SC.pruneBackups([]), []);
});
