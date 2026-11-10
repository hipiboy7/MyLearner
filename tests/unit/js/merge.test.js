// 등급 A — web/core/merge.js (FR-413·430~435·440~442, docs/P4_설계서_Mobile.md 3.5·3.6절). 합치기 미리보기·N/N·되살리기 계획·내보내기 알림.
// 시험 먼저 2026-11-10 — 모듈이 없을 때 실패를 보고 구현했다(테스트결과서 7절).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers');
const M = core('merge'), L = core('log'), R = core('replay');

const ME = 'aaaa000000000001', PHONE = 'bbbb000000000002', PC = 'cccc000000000003';
function ev(dev, seq, day, extra) {
  return L.make(Object.assign({ dev: dev, seq: seq, t: day + 'T01:00:00.000Z', day: day, type: 'review', course: 'mwl', card: 'k' + seq, grade: 'good' }, extra || {})).line;
}
const isOwn = (d) => d === ME || d.indexOf(ME + '-') === 0;
const TODAY = '2026-11-10';

test('keyOf — 사건은 정규형, 해석하지 못한 줄은 앞뒤 빈칸만 뗀 글', () => {
  const line = ev(ME, 1, '2026-11-01');
  const messy = JSON.stringify(JSON.parse(line), null, 2).replace(/\n/g, ' ');
  assert.equal(M.keyOf('  ' + messy + '  '), line);
  assert.equal(M.keyOf('  not json  '), 'not json');
  assert.equal(L.parseLine(messy).event.line, line);
});

test('미리보기 — 새 줄·파일 안 중복·기기·과정 칸', () => {
  const have = [ev(ME, 1, '2026-11-01'), ev(PHONE, 1, '2026-11-02')];
  const file = [ev(PHONE, 1, '2026-11-02'), ev(PHONE, 2, '2026-11-05'), ev(PHONE, 2, '2026-11-05'), ev(PHONE, 3, '2026-11-06', { type: 'lesson', course: 'mwm-app', lesson: 'x', done: true, card: undefined, grade: undefined }),
    ev(PC, 1, '2026-11-03', { type: 'session', minutes: 5, reviewed: 0, course: undefined, card: undefined, grade: undefined })];
  const p = M.preview({ have: have, file: file, today: TODAY, isOwn: isOwn, known: R.KNOWN });
  assert.equal(p.total, 4);
  assert.equal(p.fresh, 3);
  assert.deepEqual(p.freshLines, [file[1], file[3], file[4]]);
  assert.deepEqual(p.devices, [
    { dev: PHONE, own: false, total: 3, fresh: 2, first_day: '2026-11-02', last_day: '2026-11-06', clock: 'ok' },
    { dev: PC, own: false, total: 1, fresh: 1, first_day: '2026-11-03', last_day: '2026-11-03', clock: 'ok' }]);
  assert.deepEqual(p.courses, [{ course: '-', reviews: 0, lessons: 0, other: 1 }, { course: 'mwl', reviews: 1, lessons: 0, other: 0 }, { course: 'mwm-app', reviews: 0, lessons: 1, other: 0 }]);
  assert.equal(p.conflicts_new, 0);
  assert.equal(p.unknown, 0);
  assert.equal(p.future, 0);
});

test('미리보기 — 같은 파일을 다시 고르면 새 줄 0(멱등)', () => {
  const file = [ev(PHONE, 1, '2026-11-02'), 'raw line'];
  const p = M.preview({ have: file.slice(), file: file, today: TODAY, isOwn: isOwn, known: R.KNOWN });
  assert.equal(p.fresh, 0);
  assert.deepEqual(p.freshLines, []);
  assert.equal(p.total, 2);
});

test('미리보기 — 새 충돌·모르는 종류·해석하지 못한 줄·새 판·미래 학습일', () => {
  const have = [ev(PHONE, 5, '2026-11-02')];
  const file = [ev(PHONE, 5, '2026-11-02', { grade: 'again' }),                                  // 같은 기기·순번에 다른 줄 → 새 충돌 1
    ev(PHONE, 6, '2026-11-03', { type: 'zzz.new', course: undefined, card: undefined, grade: undefined }),   // 모르는 종류
    'not json',
    '{"v":2,"dev":"x","seq":1,"t":"2026-11-01T00:00:00.000Z","day":"2026-11-01","type":"review"}',
    ev(PHONE, 7, '2026-11-12')];                                                                     // 오늘 + 2 → 미래
  const p = M.preview({ have: have, file: file, today: TODAY, isOwn: isOwn, known: R.KNOWN });
  assert.equal(p.conflicts_new, 1);
  assert.equal(p.unknown, 1);
  assert.equal(p.bad, 1);
  assert.equal(p.newer, 1);
  assert.equal(p.future, 1);
  assert.equal(p.devices[0].clock, 'ahead');
});

// 2026-11-10 사후 보강 — 변이 시험(테스트결과서 7.1절)에서 살아남은 결함(미래 판정 > 를 >= 로)을 잡는다
test('미리보기 — 미래 경계: 오늘 + FUTURE_DAYS 날은 미래가 아니고 그다음 날부터 미래', () => {
  const C = core('constants'), D = core('dates');
  const edge = D.addDays(TODAY, C.FUTURE_DAYS);
  const p0 = M.preview({ have: [], file: [ev(PHONE, 1, edge)], today: TODAY, isOwn: isOwn, known: R.KNOWN });
  assert.equal(p0.future, 0);
  assert.equal(p0.devices[0].clock, 'ok');
  const p1 = M.preview({ have: [], file: [ev(PHONE, 1, edge), ev(PHONE, 2, D.addDays(edge, 1))], today: TODAY, isOwn: isOwn, known: R.KNOWN });
  assert.equal(p1.future, 1);
  assert.equal(p1.devices[0].clock, 'ahead');
});

// 독립 점검 2026-11-10 F-1·F-2 — 시험 먼저(구현 전 실패 확인): 들이면 저장·기록이 막히는 줄을 센다. 화면(app/merge_view.js)이 파일째 거부한다
test('미리보기 — 순번이 끝(MAX_SEQ)에 가까운 줄을 센다: SEQ_LIMIT 까지는 괜찮고 넘으면 seq_end', () => {
  const C = core('constants');
  assert.equal(M.SEQ_LIMIT, C.MAX_SEQ - 4294967296);
  const p0 = M.preview({ have: [], file: [ev(PHONE, M.SEQ_LIMIT, '2026-11-02')], today: TODAY, isOwn: isOwn, known: R.KNOWN });
  assert.equal(p0.seq_end, 0);
  const p1 = M.preview({ have: [], file: [ev(ME, C.MAX_SEQ, '2026-11-02'), ev(PHONE, M.SEQ_LIMIT + 1, '2026-11-02')], today: TODAY, isOwn: isOwn, known: R.KNOWN });
  assert.equal(p1.seq_end, 2);
  const p2 = M.preview({ have: [ev(ME, C.MAX_SEQ, '2026-11-02')], file: [ev(ME, C.MAX_SEQ, '2026-11-02')], today: TODAY, isOwn: isOwn, known: R.KNOWN });
  assert.equal(p2.seq_end, 0, '이미 있는 줄은 세지 않는다(새 줄만)');
});

test('미리보기 — 정규형이 64 KiB 를 넘는 새 줄을 센다(1e9 → 1000000000 처럼 정규형이 길어진다)', () => {
  const X = core('exchange');
  const base = ev(PHONE, 9, '2026-11-02');
  const raw = base.slice(0, -1) + ',"zz":[' + new Array(12000).fill('1e9').join(',') + ']}';
  assert.ok(Buffer.byteLength(raw) <= X.LINE_MAX);
  const p = M.preview({ have: [], file: [raw, ev(PHONE, 10, '2026-11-02')], today: TODAY, isOwn: isOwn, known: R.KNOWN });
  assert.ok(Buffer.byteLength(p.freshLines[0]) > X.LINE_MAX);
  assert.equal(p.long, 1);
  assert.equal(M.preview({ have: [], file: [ev(PHONE, 10, '2026-11-02')], today: TODAY, isOwn: isOwn, known: R.KNOWN }).long, 0);
});

test('미리보기 — 순번을 따라 학습일이 뒤로 간 기기는 시계 확인, 이 기기 표시', () => {
  const file = [ev(PHONE, 1, '2026-11-05'), ev(PHONE, 2, '2026-11-03'), ev(ME + '-a1b2c3', 1, '2026-11-01')];
  const p = M.preview({ have: [], file: file, today: TODAY, isOwn: isOwn, known: R.KNOWN });
  const by = Object.fromEntries(p.devices.map((d) => [d.dev, d]));
  assert.equal(by[PHONE].clock, 'back');
  assert.equal(by[ME + '-a1b2c3'].own, true);
  assert.equal(by[ME + '-a1b2c3'].clock, 'ok');
});

test('미리보기 — 시계는 이미 있는 줄까지 합쳐 본다', () => {
  const have = [ev(PHONE, 1, '2026-11-08')];
  const p = M.preview({ have: have, file: [ev(PHONE, 2, '2026-11-04')], today: TODAY, isOwn: isOwn, known: R.KNOWN });
  assert.equal(p.devices[0].clock, 'back');
});

test('N/N — 파일의 줄(키)이 모두 기록에 있나', () => {
  const file = [ev(PHONE, 1, '2026-11-02'), ev(PHONE, 2, '2026-11-03'), ' raw ', ev(PHONE, 1, '2026-11-02')];
  assert.deepEqual(M.present([ev(PHONE, 1, '2026-11-02'), 'raw', ev(PHONE, 2, '2026-11-03')], file), { present: 3, total: 3 });
  assert.deepEqual(M.present([ev(PHONE, 1, '2026-11-02')], file), { present: 1, total: 3 });
});

test('되살리기 계획 — 백업에 없는 다른 기기 줄·해석 못 한 줄만 빼고 이 기기 줄은 남긴다', () => {
  const only = [ev(ME, 9, '2026-11-09'), ev(ME + '-a1b2c3', 3, '2026-11-09'), ev(PHONE, 4, '2026-11-08'), ev(PHONE, 5, '2026-11-08'), ev(PC, 1, '2026-11-07'), 'junk'];
  const r = M.restorePlan({ onlyCurrent: only, onlyBackup: 7, isOwn: isOwn });
  assert.deepEqual(r.remove, [only[2], only[3], only[4], 'junk']);
  assert.equal(r.keep_own, 2);
  assert.equal(r.add, 7);
  assert.deepEqual(r.by_dev, [{ dev: '-', remove: 1 }, { dev: PHONE, remove: 2 }, { dev: PC, remove: 1 }]);
});

test('내보내기 알림 — 날 수를 넘으면 지난 날 수, 아니면 null', () => {
  const now = new Date('2026-11-10T12:00:00.000Z');
  assert.equal(M.reminderDays({ exportedAt: '2026-11-02T11:00:00.000Z', firstOwnT: '2026-10-01T00:00:00.000Z', now: now, days: 7 }), 8);
  assert.equal(M.reminderDays({ exportedAt: '2026-11-03T13:00:00.000Z', firstOwnT: null, now: now, days: 7 }), null);   // 6.9일
  assert.equal(M.reminderDays({ exportedAt: null, firstOwnT: '2026-11-01T00:00:00.000Z', now: now, days: 7 }), 9);       // 한 번도 안 내보냄
  assert.equal(M.reminderDays({ exportedAt: null, firstOwnT: null, now: now, days: 7 }), null);                          // 기록 없음
  assert.equal(M.reminderDays({ exportedAt: null, firstOwnT: '2026-01-01T00:00:00.000Z', now: now, days: 0 }), null);    // 판 설정이 끔
  assert.equal(M.reminderDays({ exportedAt: 'garbage', firstOwnT: '2026-11-01T00:00:00.000Z', now: now, days: 7 }), 9);  // 깨진 값은 없는 것으로
});

test('replay.KNOWN — 다시 계산이 아는 종류 목록', () => {
  assert.deepEqual(R.KNOWN, ['card.hold', 'card.state', 'check', 'drill', 'journal', 'lab', 'lesson', 'quiz', 'review', 'session', 'setting']);
});
