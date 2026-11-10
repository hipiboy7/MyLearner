// 등급 B — web/store/android.js (FR-410~412, docs/P4_설계서_Mobile.md 3.3절). 가짜 다리(메모리 파일 KV)로 같은 약속을 본다.
// 실제 안드로이드는 mobile/android/e2e/emulator_test.py(강제 종료 뒤 남음), 자바 쪽 원자적 쓰기는 mobile/android/test/…/KvTest.java.
// 시험 먼저 2026-11-10 — 모듈이 없을 때 실패를 보고 구현했다(테스트결과서 7절).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT, core } = require('./helpers');
const SA = require(path.join(ROOT, 'web', 'store', 'android.js'));
const SC = require(path.join(ROOT, 'web', 'store', 'common.js'));
const L = core('log');

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;   // Kv.nameOk 와 같은 규칙
function fakeBridge() {
  const files = new Map();
  const b = {
    fail: null,
    kvGet(n) { if (!NAME.test(n)) throw new Error('이름'); return files.has(n) ? files.get(n) : null; },
    kvPut(n, v) { if (!NAME.test(n)) return '이름이 틀렸다'; if (b.fail) return b.fail; files.set(n, String(v)); return ''; },
    kvDel(n) { files.delete(n); return ''; },
    kvList(p) { return JSON.stringify(Array.from(files.keys()).filter((k) => k.indexOf(p) === 0).sort()); },
    _files: files
  };
  return b;
}
let clock = Date.UTC(2026, 10, 10, 1, 0, 0, 0);
const now = () => new Date(clock);
const rand = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 53 + 7) & 255; return b; };
function ev(dev, seq, day) { return L.make({ dev: dev, seq: seq, t: day + 'T01:00:00.000Z', day: day, type: 'session', minutes: 1, reviewed: 0 }).line; }

test('안드로이드 — 종류·저장 위치, 기기 ID 는 파일에 한 번', async () => {
  const br = fakeBridge(), st = SA.create({ bridge: br, now, random: rand });
  assert.equal(st.kind, 'android');
  const info = await st.init();
  assert.match(info.dev, /^[0-9a-f]{16}$/);
  assert.match(info.where, /앱 저장소/);
  assert.equal(br._files.get('ls.mylearner.device'), info.dev);
  assert.equal((await SA.create({ bridge: br, now, random: rand }).init()).dev, info.dev, '다시 켜도 같은 기기');
});

test('안드로이드 — 기록은 달별 파일에 합집합, 다시 읽기, 순번 하한, 하루 백업', async () => {
  const br = fakeBridge(), st = SA.create({ bridge: br, now, random: rand });
  const { dev } = await st.init();
  const a = ev(dev, 1, '2026-10-31'), b = ev(dev, 2, '2026-11-10');
  assert.deepEqual(await st.append([a], '2026-10-31'), { added: 1, warn: null });
  clock += 1000;
  assert.deepEqual(await st.append([b, a, 'junk'], '2026-11-10'), { added: 2, warn: null });
  assert.equal(br._files.get('ls.mylearner.log.2026-10'), a);
  assert.equal(br._files.get('ls.mylearner.log.2026-11'), b);
  assert.equal(br._files.get('ls.mylearner.log.raw'), 'junk');
  assert.deepEqual((await SA.create({ bridge: br, now, random: rand }).loadLog()).sort(), [a, b, 'junk'].sort());
  assert.equal(st.seqFloor(), 2);
  const backups = await st.listBackups();
  assert.deepEqual(backups.map((x) => x.reason), ['daily']);
  assert.ok(br._files.has('kv.backup_text.' + backups[0].name));
  assert.deepEqual(L.readFile(await st.backupText(backups[0].name)).lines, [a]);
});

test('안드로이드 — 사용자 과정·되살리기도 같은 약속', async () => {
  const br = fakeBridge(), st = SA.create({ bridge: br, now, random: rand });
  const { dev } = await st.init();
  await st.saveCourse({ id: 'mwl-notes', title: '메모' });
  assert.deepEqual(await st.loadCourses(), [{ id: 'mwl-notes', title: '메모' }]);
  const a = ev(dev, 1, '2026-11-01'), other = ev('eeee000000000005', 1, '2026-11-02');
  await st.append([a], null);
  clock += 1000;
  const { name } = await st.backup('import-merge');
  await st.append([other], null);
  assert.deepEqual(await st.backupDiff(name), { onlyCurrent: [other], onlyBackup: 0 });
  clock += 1000;
  const r = await st.restore(name, [other]);
  assert.equal(r.removed, 1);
  assert.deepEqual(await st.loadLog(), [a]);
  const u = await st.usage();
  assert.ok(u.keys >= 3 && u.chars > 0);
});

test('안드로이드 — 파일 쓰기가 실패하면 덧붙이기가 던진다(화면이 저장 실패 띠·다시 보내기)', async () => {
  const br = fakeBridge(), st = SA.create({ bridge: br, now, random: rand });
  const { dev } = await st.init();
  br.fail = '저장 공간이 없습니다';
  await assert.rejects(st.append([ev(dev, 1, '2026-11-10')], null), /저장 공간이 없습니다/);
  br.fail = null;
  assert.equal((await st.append([ev(dev, 1, '2026-11-10')], null)).added, 1);
});

test('안드로이드 — 다리가 없으면 만들 수 없다, 다리 이름 규칙(ls.·kv.) 밖은 읽지 않는다', async () => {
  assert.throws(() => SA.create({ bridge: null, now, random: rand }), /다리/);
  const br = fakeBridge();
  br._files.set('other.file', 'x');
  const st = SA.create({ bridge: br, now, random: rand });
  await st.init();
  assert.deepEqual(await st.loadLog(), []);
  assert.equal(SA.lsName('mylearner.log.2026-11'), 'ls.mylearner.log.2026-11');
  assert.equal(SA.kvName('backups', '20261110T010000000Z-daily'), 'kv.backups.20261110T010000000Z-daily');
  assert.ok(Object.keys(SC.KEYS).every((k) => NAME.test(SA.lsName(SC.KEYS[k] + 'x'))));
});
