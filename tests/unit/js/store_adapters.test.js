// 등급 B — web/store/browser.js·server.js (FR-320~327). 가짜 localStorage·KV·fetch 로 흐름을 본다. 실제 브라우저는 scripts/app_smoke.py.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT, core } = require('./helpers');
const SB = require(path.join(ROOT, 'web', 'store', 'browser.js'));
const SS = require(path.join(ROOT, 'web', 'store', 'server.js'));
const SC = require(path.join(ROOT, 'web', 'store', 'common.js'));
const L = core('log');

function fakeLs(quota) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] === undefined ? null : Array.from(m.keys())[i]; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      const size = Array.from(m.entries()).reduce((a, [kk, vv]) => a + (kk === k ? 0 : kk.length + vv.length), 0) + k.length + String(v).length;
      if (quota && size > quota) { const e = new Error('가득 참'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem(k) { m.delete(k); },
    _m: m
  };
}
function fakeKv() {
  const stores = {};
  const s = (n) => (stores[n] = stores[n] || new Map());
  return {
    get: (n, k) => Promise.resolve(s(n).has(k) ? s(n).get(k) : undefined),
    put: (n, k, v) => Promise.resolve(void s(n).set(k, v)),
    keys: (n) => Promise.resolve(Array.from(s(n).keys())),
    del: (n, k) => Promise.resolve(void s(n).delete(k)),
    _s: stores
  };
}
let clock = Date.UTC(2026, 10, 9, 1, 0, 0, 0);
const now = () => new Date(clock);
const rand = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) & 255; return b; };
function ev(dev, seq, day) { return L.make({ dev: dev, seq: seq, t: day + 'T01:00:00.000Z', day: day, type: 'session', minutes: 1, reviewed: 0 }).line; }

test('브라우저 — 기기 ID 를 한 번 만들고, 달 키에 합집합으로 쓰고, 다시 읽는다', async () => {
  const ls = fakeLs(), kv = fakeKv(), st = SB.create({ ls, kv, now, random: rand });
  const info = await st.init();
  assert.match(info.dev, /^[0-9a-f]{16}$/);
  assert.equal((await SB.create({ ls, kv, now, random: rand }).init()).dev, info.dev, '같은 브라우저는 같은 기기');
  const a = ev(info.dev, 1, '2026-10-31'), b = ev(info.dev, 2, '2026-11-09');
  assert.deepEqual(await st.append([a, b, 'junk'], '2026-11-09'), { added: 3, warn: null });
  assert.deepEqual(await st.append([b, a], '2026-11-09'), { added: 0, warn: null }, '같은 줄은 다시 쓰지 않는다');
  assert.deepEqual((await st.loadLog()).sort(), [a, b, 'junk'].sort());
  assert.equal(ls.getItem('mylearner.log.2026-10'), a);
  assert.equal(ls.getItem('mylearner.log.raw'), 'junk');
  assert.equal(st.seqFloor(), 2);
  ls.setItem('mwl.progress', '{}');
  assert.equal((await st.loadLog()).length, 3, 'MWL 키는 읽지 않는다');
  const u = await st.usage();
  assert.equal(u.keys, 6, 'device·daily·seq·로그 셋');
});

test('브라우저 — 하루 첫 덧붙이기 전에 하루 백업(빈 기록은 빼고), 같은 날은 한 번, 백업 글은 정해진 순서', async () => {
  const ls = fakeLs(), kv = fakeKv(), st = SB.create({ ls, kv, now, random: rand });
  const { dev } = await st.init();
  await st.append([ev(dev, 1, '2026-11-08')], '2026-11-08');
  clock += 1000;
  await st.append([ev(dev, 2, '2026-11-09')], '2026-11-09');
  clock += 1000;
  await st.append([ev(dev, 3, '2026-11-09')], '2026-11-09');
  const list = await st.listBackups();
  assert.deepEqual(list.map((b) => b.reason), ['daily'], '8일은 기록이 비어 백업하지 않고, 9일 하나');
  const text = await st.backupText(list[0].name);
  assert.deepEqual(L.readFile(text).lines, [ev(dev, 1, '2026-11-08')], '9일 백업은 9일에 쓰기 전 모습');
  assert.equal(text, L.writeFile(L.merge([[ev(dev, 1, '2026-11-08')]])));
});

test('브라우저 — 들여오기 백업은 20개만 남긴다, KV 가 없으면 백업·과정 저장은 실패하고 기록은 쓴다', async () => {
  const ls = fakeLs(), kv = fakeKv(), st = SB.create({ ls, kv, now, random: rand });
  await st.init();
  for (let i = 0; i < 22; i++) { clock += 1; await st.backup('import-mwl'); }
  assert.equal((await kv.keys('backups')).length, 20);
  assert.equal((await kv.keys('backup_text')).length, 20);
  const bare = SB.create({ ls: fakeLs(), kv: null, now, random: rand });
  const { dev } = await bare.init();
  await assert.rejects(bare.backup('import-mwl'), /IndexedDB/);
  await assert.rejects(bare.saveCourse({ id: 'x' }), /IndexedDB/);
  assert.deepEqual(await bare.loadCourses(), []);
  assert.deepEqual(await bare.listBackups(), []);
  assert.equal((await bare.append([ev(dev, 1, '2026-11-09')], '2026-11-09')).added, 1);
});

test('브라우저 — 하루 백업이 실패해도 기록은 쓰고 경고, 가득 차면 던진다(호출부가 다시 보낸다)', async () => {
  const kv = fakeKv();
  kv.put = () => Promise.reject(new Error('막힘'));
  const st = SB.create({ ls: fakeLs(), kv, now, random: rand });
  const { dev } = await st.init();
  assert.equal((await st.append([ev(dev, 1, '2026-11-08')], '2026-11-08')).warn, null, '빈 기록은 백업하지 않는다');
  const r = await st.append([ev(dev, 2, '2026-11-09')], '2026-11-09');
  assert.equal(r.added, 1);
  assert.match(r.warn, /하루 백업 실패/);
  const full = SB.create({ ls: fakeLs(200), kv: fakeKv(), now, random: rand });
  const d2 = (await full.init()).dev;
  await assert.rejects(full.append([ev(d2, 1, '2026-11-09'), ev(d2, 2, '2026-11-09')], null), (e) => e.name === 'QuotaExceededError');
});

test('브라우저 — 사용자 과정 쓰고 읽기(ID 순)', async () => {
  const st = SB.create({ ls: fakeLs(), kv: fakeKv(), now, random: rand });
  await st.saveCourse({ id: 'z', title: 'Z' });
  await st.saveCourse({ id: 'a', title: 'A' });
  await st.saveCourse({ id: 'a', title: 'A2' });
  assert.deepEqual((await st.loadCourses()).map((c) => c.title), ['A2', 'Z']);
});

function fakeFetch(routes) {
  const calls = [];
  const f = (url, opt) => {
    calls.push([url, opt]);
    const h = routes[(opt.method || 'GET') + ' ' + url];
    if (!h) return Promise.resolve(resp(404, '{"error":"없음"}'));
    return Promise.resolve(h(opt));
  };
  f.calls = calls;
  return f;
}
function resp(status, body) { return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body), json: () => Promise.resolve(JSON.parse(body)) }; }

test('서버 — 상태 확인(MyLearner 서버만), 기록 읽기·덧붙이기, 과정·백업, 쿠키를 싣고 캐시하지 않는다', async () => {
  const line = ev('abcd', 1, '2026-11-09');
  const f = fakeFetch({
    'GET /api/health': () => resp(200, '{"ok":true,"app":"mylearner","version":"0.3.0"}'),
    'GET /api/device': () => resp(200, '{"dev":"abcd","where":"데이터 폴더"}'),
    'GET /api/log': () => resp(200, L.writeFile(L.merge([[line]]))),
    'POST /api/log': (o) => resp(200, JSON.stringify({ ok: true, added: JSON.parse(o.body).lines.length, total: 1 })),
    'GET /api/courses': () => resp(200, '{"courses":[{"id":"mwl-notes"}]}'),
    'PUT /api/courses/mwl-notes': () => resp(200, '{"ok":true}'),
    'POST /api/backups': () => resp(200, '{"ok":true,"name":"20261109T000000000Z-import-mwl"}'),
    'GET /api/backups': () => resp(200, '{"backups":[{"name":"n"}]}'),
    'GET /api/backups/a%20b': () => resp(200, 'TEXT')
  });
  const env = { fetch: f };
  assert.equal((await SS.probe(env)).version, '0.3.0');
  const st = SS.create(env);
  assert.equal((await st.init()).dev, 'abcd');
  assert.deepEqual(await st.loadLog(), [line]);
  assert.deepEqual(await st.append([line, line]), { added: 2, warn: null });
  assert.deepEqual(await st.loadCourses(), [{ id: 'mwl-notes' }]);
  await st.saveCourse({ id: 'mwl-notes' });
  assert.equal((await st.backup('import-mwl')).name, '20261109T000000000Z-import-mwl');
  assert.deepEqual(await st.listBackups(), [{ name: 'n' }]);
  assert.equal(await st.backupText('a b'), 'TEXT');
  assert.equal(await st.usage(), null);
  assert.equal(st.seqFloor(), 0);
  assert.ok(f.calls.every(([, o]) => o.credentials === 'same-origin' && o.cache === 'no-store'));
  const post = f.calls.find(([u, o]) => u === '/api/log' && o.method === 'POST');
  assert.equal(post[1].headers['Content-Type'], 'application/json');
});

test('서버 — 다른 서버·꺼진 서버면 probe 는 null, 오류는 상태 코드와 이유를 담아 던진다, 기록 파일 머리가 틀리면 던진다', async () => {
  assert.equal(await SS.probe({ fetch: fakeFetch({ 'GET /api/health': () => resp(200, '{"ok":true,"app":"mwl"}') }) }), null);
  assert.equal(await SS.probe({ fetch: () => Promise.reject(new Error('꺼짐')) }), null);
  assert.equal(await SS.probe({ fetch: fakeFetch({}) }), null);
  const st = SS.create({ fetch: fakeFetch({ 'POST /api/log': () => resp(413, '{"error":"너무 큼"}'), 'GET /api/log': () => resp(200, 'not a log'),
    'GET /api/courses': () => resp(500, 'plain text') }) });
  await assert.rejects(st.append(['x']), (e) => e.status === 413 && /너무 큼/.test(e.message));
  await assert.rejects(st.loadLog(), /E-LOG-FORMAT/);
  await assert.rejects(st.loadCourses(), /서버 500: plain text/);
});

test('공통 상수 — 브라우저 키 접두사는 mylearner. (MWL 의 mwl. 과 겹치지 않는다)', () => {
  Object.keys(SC.KEYS).forEach((k) => assert.ok(SC.KEYS[k].indexOf('mylearner.') === 0));
});

test('브라우저 — 달 키 쓰기는 주입한 lock 안에서(S11)', async () => {
  const calls = [];
  const lock = (fn) => { calls.push('in'); return Promise.resolve().then(fn).then((r) => { calls.push('out'); return r; }); };
  const st = SB.create({ ls: fakeLs(), kv: fakeKv(), now, random: rand, lock });
  const { dev } = await st.init();
  assert.equal((await st.append([ev(dev, 1, '2026-11-09')], null)).added, 1);
  assert.deepEqual(calls, ['in', 'out']);
});

test('브라우저 — 백업 차이와 되살리기(P4): 지금 기록을 restore 백업한 뒤 (지금 − 뺄 줄) ∪ 백업, 그 백업을 되살리면 돌아온다', async () => {
  const ls = fakeLs(), kv = fakeKv(), st = SB.create({ ls, kv, now, random: rand });
  const { dev } = await st.init();
  const a = ev(dev, 1, '2026-10-01'), b = ev('ffff000000000009', 1, '2026-11-02'), c = ev(dev, 2, '2026-11-03');
  await st.append([a], null);
  clock += 1000;
  const { name } = await st.backup('import-merge');
  await st.append([b, c, 'junk'], null);
  const d = await st.backupDiff(name);
  assert.deepEqual(d.onlyCurrent.sort(), [b, c, 'junk'].sort());
  assert.equal(d.onlyBackup, 0);
  clock += 1000;
  const r = await st.restore(name, [b, 'junk']);
  assert.equal(r.removed, 2);
  assert.equal(r.added, 0);
  assert.equal(SC.reasonOf(r.backup), 'restore');
  assert.deepEqual((await st.loadLog()).sort(), [a, c].sort());
  assert.equal(ls.getItem('mylearner.log.raw'), null, '빈 달 키는 지운다');
  clock += 1000;
  const back = await st.restore(r.backup, []);
  assert.equal(back.added, 2);
  assert.deepEqual((await st.loadLog()).sort(), [a, b, c, 'junk'].sort());
  await assert.rejects(st.backupDiff('20200101T000000000Z-daily'), /백업이 없습니다/);
  await assert.rejects(st.restore('20200101T000000000Z-daily', []), /백업이 없습니다/);
});

test('서버 — 백업 차이·되살리기(P4) API 를 부른다', async () => {
  const f = fakeFetch({
    'GET /api/backups/n1/diff': () => resp(200, '{"only_current":["x","y"],"only_backup":3}'),
    'POST /api/backups/n1/restore': (o) => resp(200, JSON.stringify({ ok: true, removed: JSON.parse(o.body).remove.length, added: 3, backup: 'n2', total: 9 }))
  });
  const st = SS.create({ fetch: f });
  assert.deepEqual(await st.backupDiff('n1'), { onlyCurrent: ['x', 'y'], onlyBackup: 3 });
  assert.deepEqual(await st.restore('n1', ['x']), { removed: 1, added: 3, backup: 'n2' });
  const post = f.calls.find(([u]) => u === '/api/backups/n1/restore');
  assert.equal(post[1].headers['Content-Type'], 'application/json');
});
