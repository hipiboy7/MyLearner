// 등급 A — web/core/log.js (FR-220~223·226·227). 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers');
const L = core('log');

const T = '2026-10-15T01:02:03.004Z';
function ev(dev, seq, day, extra) {
  return L.make(Object.assign({ dev: dev, seq: seq, t: day + 'T03:00:00.000Z', day: day, type: 'review', course: 'mwl', card: 'A1-1-c01', grade: 'good' }, extra || {}));
}

test('정규형 — 키 정렬·공백 없음·Python json.dumps(sort_keys, ensure_ascii=False) 와 같다', () => {
  const o = { z: 1, a: [3, { y: '한', b: null }], m: 'x\ny"\\', 'é': true, A: 2.5, u: '\u2028' };
  assert.equal(L.canonical(o), '{"A":2.5,"a":[3,{"b":null,"y":"한"}],"m":"x\\ny\\"\\\\","u":"\u2028","z":1,"é":true}');
  assert.equal(L.canonical({ b: 1, a: 2 }), L.canonical({ a: 2, b: 1 }));
});

test('make — 봉투를 검사하고 정규형 줄을 단다', () => {
  const e = L.make({ dev: 'a1', seq: 1, t: T, day: '2026-10-15', type: 'review', course: 'mwl', card: 'A1-1-c01', grade: 'good' });
  assert.equal(e.line, '{"card":"A1-1-c01","course":"mwl","day":"2026-10-15","dev":"a1","grade":"good","seq":1,"t":"' + T + '","type":"review","v":1}');
  assert.equal(e.dev, 'a1'); assert.equal(e.seq, 1); assert.equal(e.type, 'review'); assert.equal(e.data.grade, 'good');
  assert.ok(e.line.length <= 200, 'NFR-204 한 줄 200 B 이하');
  for (const bad of [{ dev: 'A1' }, { dev: '' }, { dev: 'x'.repeat(33) }, { seq: 0 }, { seq: 1.5 }, { seq: '1' }, { seq: 2 ** 53 },
    { t: '2026-10-15T01:02:03Z' }, { day: '2026-02-30' }, { type: 'Review' }, { type: '' }])
    assert.throws(() => L.make(Object.assign({ dev: 'a1', seq: 1, t: T, day: '2026-10-15', type: 'review' }, bad)), /사건/, JSON.stringify(bad));
});

test('stamp — 지금 시각에서 t·day', () => {
  const d = new Date(2026, 9, 16, 0, 30, 0);
  const s = L.stamp(d, 0);
  assert.equal(s.t, d.toISOString());
  assert.equal(s.day, '2026-10-16');
  assert.equal(L.stamp(d, 4).day, '2026-10-15');
});

test('parseLine — 사건·읽을 수 없는 줄·새 판', () => {
  const e = ev('a1', 1, '2026-10-15');
  const shuffled = JSON.stringify({ v: 1, type: 'review', t: e.t, seq: 1, grade: 'good', dev: 'a1', day: '2026-10-15', card: 'A1-1-c01', course: 'mwl' }, null, 1);
  const p = L.parseLine(shuffled.replace(/\n/g, ' '));
  assert.equal(p.kind, 'event'); assert.equal(p.event.line, e.line);
  assert.deepEqual(L.parseLine(' {"v":2, "seq":1, "dev":"a1"} '), { kind: 'raw', reason: 'newer', text: '{"dev":"a1","seq":1,"v":2}' });
  assert.deepEqual(L.parseLine('not json  '), { kind: 'raw', reason: 'bad', text: 'not json' });
  for (const bad of ['not json', '[1,2]', '"x"', 'null', '{"v":"1","dev":"a1","seq":1,"t":"' + T + '","day":"2026-10-15","type":"review"}',
    '{"v":1,"seq":1,"t":"' + T + '","day":"2026-10-15","type":"review"}', '{"v":1,"dev":"a1","seq":-3,"t":"' + T + '","day":"2026-10-15","type":"review"}',
    '{"v":1,"dev":"a1","seq":1,"t":"' + T + '","day":"2026-10-15"}'])
    assert.equal(L.parseLine(bad).reason, 'bad', bad);
  // 모르는 종류는 봉투가 맞으면 사건이다(남기고, 다시 계산이 센다)
  assert.equal(L.parseLine('{"v":1,"dev":"a1","seq":9,"t":"' + T + '","day":"2026-10-15","type":"future.kind","x":1}').kind, 'event');
});

test('readFile·writeFile — 머리, 같은 모음 = 같은 바이트, BOM·CRLF', () => {
  const m = L.merge([[ev('b2', 1, '2026-10-02').line, ev('a1', 1, '2026-10-01').line, 'garbage']]);
  const text = L.writeFile(m);
  const lines = text.split('\n');
  assert.equal(lines[0], '{"format":"mylearner-log","min_reader":1,"version":1}');
  assert.equal(lines[1], ev('a1', 1, '2026-10-01').line);
  assert.equal(lines[2], ev('b2', 1, '2026-10-02').line);
  assert.equal(lines[3], 'garbage');
  assert.equal(lines[4], '');
  const r = L.readFile('\uFEFF' + text.replace(/\n/g, '\r\n'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, ['{"card":"A1-1-c01","course":"mwl","day":"2026-10-01","dev":"a1","grade":"good","seq":1,"t":"2026-10-01T03:00:00.000Z","type":"review","v":1}',
    ev('b2', 1, '2026-10-02').line, 'garbage']);
  assert.equal(L.writeFile(L.merge([r.lines])), text);
  assert.equal(L.writeFile(L.merge([])), '{"format":"mylearner-log","min_reader":1,"version":1}\n');
});

test('readFile — 기록 파일이 아니거나 판이 높으면 읽지 않는다', () => {
  assert.equal(L.readFile('').error, 'E-LOG-FORMAT');
  assert.equal(L.readFile(ev('a1', 1, '2026-10-01').line + '\n').error, 'E-LOG-FORMAT');
  assert.equal(L.readFile('{"format":"mylearner-course","version":1,"min_reader":1}\n').error, 'E-LOG-FORMAT');
  assert.equal(L.readFile('{"format":"mylearner-log","version":3,"min_reader":2}\n').error, 'E-LOG-READER');
  assert.equal(L.readFile('{"format":"mylearner-log","version":"1","min_reader":1}\n').error, 'E-LOG-FORMAT');
  const ok = L.readFile('\n\n{"format":"mylearner-log","version":2,"min_reader":1,"extra":"x"}\n\n');
  assert.equal(ok.ok, true); assert.deepEqual(ok.lines, []); assert.equal(ok.header.version, 2);
});

test('merge — 같은 정규형은 하나, 같은 (기기, 순번)의 다른 줄은 둘 다 남기고 충돌로 센다', () => {
  const a = ev('a1', 1, '2026-10-01');
  const a2 = ev('a1', 1, '2026-10-01', { grade: 'hard' });
  const reordered = JSON.stringify(Object.assign({}, a.data));   // 키 순서가 다른 같은 사건
  const m = L.merge([[a.line, reordered], [a.line, a2.line, '  junk  ', 'junk', '']]);
  assert.equal(m.events.length, 2);
  assert.deepEqual(m.counts, { events: 2, conflicts: 1, bad: 1, newer: 0 });
  assert.deepEqual(m.raw, ['junk']);
  // 같은 (기기, 순번)은 정규형 글자 순
  assert.deepEqual(m.events.map((e) => e.data.grade), [a.line < a2.line ? 'good' : 'hard', a.line < a2.line ? 'hard' : 'good']);
});

test('순서 — 기기 안은 순번, 기기 사이는 (학습일, 순위, 시각, 기기). 가져온 상태는 그날 끝', () => {
  const x1 = ev('x', 1, '2026-10-20');
  const x2 = ev('x', 2, '2026-10-10');            // 시계가 뒤로 간 기기 — 순번 순서를 지킨다
  const y1 = ev('y', 1, '2026-10-15');
  const s = L.make({ dev: 'mwl-000000000000', seq: 1, t: '2026-10-15T00:00:00.000Z', day: '2026-10-15', type: 'card.state', course: 'mwl', card: 'A1-1-c01',
    state: { ef: 2.5, interval: 1, reps: 1, lapses: 0, due: '2026-10-16', last: '2026-10-15', grades: [2] }, src: 'mwl' });
  const y2 = ev('y', 2, '2026-10-15', { t: '2026-10-15T23:00:00.000Z' });
  const z1 = ev('z', 1, '2026-10-15', { t: '2026-10-15T03:00:00.000Z' });   // y1 과 같은 시각 → 기기 이름 순
  const m = L.merge([[x2.line, s.line, y2.line], [x1.line, z1.line, y1.line]]);
  assert.deepEqual(m.events.map((e) => e.dev + e.seq), ['y1', 'z1', 'y2', 'mwl-0000000000001', 'x1', 'x2']);
});

test('newDeviceId — 주입한 난수로 16자리 16진수', () => {
  assert.equal(L.newDeviceId((n) => Array.from({ length: n }, (_, i) => i * 17)), '00112233445566770'.slice(0, 16));
  const id = L.newDeviceId((n) => new Uint8Array(n).fill(255));
  assert.equal(id, 'ffffffffffffffff');
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.throws(() => L.newDeviceId(), /난수/);
  assert.throws(() => L.newDeviceId(() => [1, 2]), /난수/);
});

test('nextSeq·splitByMonth', () => {
  const m = L.merge([[ev('a1', 1, '2026-09-30').line, ev('a1', 7, '2026-10-01').line, ev('b2', 3, '2026-10-02').line]]);
  assert.equal(L.nextSeq(m.events, 'a1'), 8);
  assert.equal(L.nextSeq(m.events, 'zz'), 1);
  const by = L.splitByMonth(m.events);
  assert.deepEqual(Object.keys(by).sort(), ['2026-09', '2026-10']);
  assert.equal(by['2026-10'].length, 2);
});
