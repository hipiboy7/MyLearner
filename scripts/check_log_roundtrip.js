#!/usr/bin/env node
// 기록 왕복(S3) 명령 단위 증명(FR-228, NFR-203, 등급 C) — 실제 파일로 폰 ⇄ 집 PC 왕복과 폐쇄망 반입을 되풀이한다.
// 입력: --rounds N(기본 120일) --seed S(기본 20261015) --dir 폴더(기본 임시 폴더) / 출력: 표준 출력 요약, 유실·불일치가 있으면 종료 코드 1
//       --inject-loss: 만든 사건 한 줄을 일부러 파일에 쓰지 않는다(이 검사가 유실을 잡는지 보는 음성 시험용)
// 기기마다 자기 기록 파일 하나(<dir>/<기기>.log)를 갖고, 날마다 그 파일만 읽어 '오늘'을 짜고(plan) 복습·강의를 한 뒤 파일에 쓴다.
// 주고받기는 내보낸 파일을 상대가 들여와 합치는 것뿐이다(옛 백업을 다시 들여오기·같은 파일 두 번·순서 바꾸기 포함). 폐쇄망은 들여오기만 한다.
// 확인: ① 어느 때든 기기의 사건 수가 줄지 않는다 ② 만든 모든 사건이 있어야 할 곳에 다 있다 ③ 없던 사건이 생기지 않는다
//       ④ 마지막에 집·폰 파일이 같은 바이트 ⑤ 폐쇄망의 사건은 밖에 없다 ⑥ 사건 5만 줄 합치기+다시 계산 2초 이내(NFR-203)
// 트리거: scripts/verify.sh '기록 왕복(S3)' 단계(Docker Node 22). 문서: docs/P2_요구사항정의서_Core.md FR-228, docs/P2_설계서_Core.md 3.3절
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = (n) => require(path.join(__dirname, '..', 'web', 'core', n + '.js'));
const L = core('log'), R = core('replay'), P = core('plan'), D = core('dates');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
const ROUNDS = Number(arg('rounds', 120)), SEED = Number(arg('seed', 20261015));
const DIR = arg('dir', null) || fs.mkdtempSync(path.join(os.tmpdir(), 'mylearner-roundtrip-'));
const course = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'mwl', 'scheduler_course.json'), 'utf8'));

let a = SEED >>> 0 || 1;
function rnd() { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const GRADES = ['again', 'hard', 'good', 'good', 'good', 'easy'];

const devices = { h: { name: '집 PC', exportable: true }, p: { name: '폰', exportable: true }, x: { name: '폐쇄망 PC', exportable: false } };
const file = (d) => path.join(DIR, d + '.log');
const created = { h: new Set(), p: new Set(), x: new Set() };
const counts = { h: 0, p: 0, x: 0 };
const problems = [];
const seq = { h: 0, p: 0, x: 0 };
const backups = [];
for (const d of Object.keys(devices)) fs.writeFileSync(file(d), L.writeFile(L.merge([])));

function lines(d) { const r = L.readFile(fs.readFileSync(file(d), 'utf8')); if (!r.ok) throw new Error(d + ' 파일을 읽지 못했다'); return r.lines; }
function save(d, merged) {
  fs.writeFileSync(file(d), L.writeFile(merged));
  const n = merged.events.length;
  if (n < counts[d]) problems.push(devices[d].name + ' 사건이 줄었다 ' + counts[d] + ' -> ' + n);
  counts[d] = n;
}
let inject = process.argv.indexOf('--inject-loss') > 0;
function importInto(dst, text) {
  const r = L.readFile(text);
  if (!r.ok) { problems.push('들여오기 실패 ' + r.error); return; }
  save(dst, L.merge([lines(dst), r.lines]));
}
function exportOf(src) {
  if (!devices[src].exportable) throw new Error('폐쇄망은 내보내지 않는다');
  return fs.readFileSync(file(src), 'utf8');
}
function study(d, day) {
  const known = L.merge([lines(d)]);
  const st = R.run(known.events, { today: day });
  const plan = P.build([course], st, { main_course: 'mwl', new_cards_per_day: 4, max_reviews_per_day: 10, study_days: [1, 2, 3, 4, 5, 6, 7] }, day);
  const fresh = [];
  const hh = { h: 21, p: 8, x: 13 }[d];
  function add(fields) {
    seq[d] += 1;
    const e = L.make(Object.assign({ dev: d, seq: seq[d], t: day + 'T' + String(hh).padStart(2, '0') + ':' + String(seq[d] % 60).padStart(2, '0') + ':00.000Z', day: day }, fields));
    fresh.push(e.line); created[d].add(e.line);
  }
  if (plan.lesson && rnd() < 0.5) add({ type: 'lesson', course: 'mwl', lesson: plan.lesson.id, done: true });
  for (const c of plan.reviews.concat(plan.new_cards)) add({ type: 'review', course: 'mwl', card: c.id, grade: GRADES[Math.floor(rnd() * GRADES.length)] });
  if (rnd() < 0.3) add({ type: 'session', minutes: 5 + Math.floor(rnd() * 30), reviewed: plan.reviews.length });
  // 더 새 판의 앱이 쓴 줄·읽을 수 없는 줄·같은 (기기, 순번)의 다른 줄도 지우지 않고 따라가야 한다(독립 점검 — F1~F4 를 명령으로도)
  if (rnd() < 0.05) { const raw = '{"v":2,"dev":"' + d + '","seq":' + (seq[d] + 1000000) + ',"big":12345678901234567890,"day":"' + day + '"}'; fresh.push(raw); created[d].add(raw); }
  if (rnd() < 0.03) { const junk = 'constructor ' + d + ' ' + day; fresh.push(junk); created[d].add(junk); }
  if (rnd() < 0.03 && fresh.length) {
    const o = JSON.parse(fresh[0]);
    if (o.type === 'review') { o.grade = o.grade === 'easy' ? 'hard' : 'easy'; const twin = L.make(o).line; fresh.push(twin); created[d].add(twin); }
  }
  if (inject && d !== 'x' && fresh.length) { fresh.pop(); inject = false; }
  save(d, L.merge([known.events.map((e) => e.line).concat(known.raw), fresh]));
}

let day = '2026-10-01';
for (let r = 0; r < ROUNDS; r++) {
  for (const d of ['p', 'h', 'x']) if (rnd() < 0.7) study(d, day);
  if (rnd() < 0.35) { const ph = exportOf('p'), hp = exportOf('h'); importInto('h', ph); importInto('p', hp); }   // 폰 ⇄ 집 PC
  if (rnd() < 0.15) importInto('x', exportOf('h'));                                                              // 폐쇄망 반입(한 방향)
  if (rnd() < 0.1) importInto('h', exportOf('h'));                                                               // 자기 파일을 다시
  if (rnd() < 0.2) backups.push(exportOf(rnd() < 0.5 ? 'h' : 'p'));
  if (backups.length && rnd() < 0.1) importInto(rnd() < 0.5 ? 'h' : 'p', backups[Math.floor(rnd() * backups.length)]);   // 옛 백업
  day = D.addDays(day, 1);
}
// 마지막 주고받기
const ph = exportOf('p'), hp = exportOf('h');
importInto('h', ph); importInto('p', hp); importInto('h', exportOf('p'));
importInto('x', exportOf('h'));

const has = (d) => new Set(lines(d));
const H = has('h'), Pp = has('p'), X = has('x');
const outside = new Set([...created.h, ...created.p]);
for (const l of outside) { if (!H.has(l)) problems.push('집 PC 에 없다'); if (!Pp.has(l)) problems.push('폰에 없다'); if (!X.has(l)) problems.push('폐쇄망에 없다'); }
for (const l of created.x) if (!X.has(l)) problems.push('폐쇄망이 자기 사건을 잃었다');
for (const l of H) if (!outside.has(l)) problems.push('집 PC 에 없던 사건');
for (const l of X) if (!outside.has(l) && !created.x.has(l)) problems.push('폐쇄망에 없던 사건');
for (const l of created.x) if (H.has(l) || Pp.has(l)) problems.push('폐쇄망 사건이 밖에 있다');
if (fs.readFileSync(file('h'), 'utf8') !== fs.readFileSync(file('p'), 'utf8')) problems.push('집 PC·폰 파일이 다르다');

// 속도(NFR-203): 기기 3대 × 사건 5만 줄
const big = [[], [], []];
let n = 0, bday = '2025-01-01';
while (n < 50000) {
  for (let k = 0; k < 3 && n < 50000; k++) {
    n += 1;
    big[k].push(L.make({ dev: 'd' + k, seq: n, t: bday + 'T0' + k + ':00:00.000Z', day: bday, type: 'review', course: 'mwl',
      card: 'A1-1-c0' + (1 + (n % 9)), grade: GRADES[n % GRADES.length] }).line);
  }
  if (n % 300 === 0) bday = D.addDays(bday, 1);
}
const t0 = process.hrtime.bigint();
const mergedBig = L.merge(big);
const stBig = R.run(mergedBig.events, { today: bday });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
if (ms > 2000) problems.push('NFR-203 사건 5만 줄 합치기+다시 계산 ' + ms.toFixed(0) + 'ms > 2000ms');

const st = R.run(L.merge([lines('h')]).events, { today: day });
console.log('기록 왕복: ' + ROUNDS + '일, 시드 ' + SEED + ', 만든 사건 집 PC ' + created.h.size + ' · 폰 ' + created.p.size + ' · 폐쇄망 ' + created.x.size);
const final = L.merge([lines('x')]);
console.log('  폐쇄망 파일의 새 판 줄 ' + final.counts.newer + ' · 읽을 수 없는 줄 ' + final.counts.bad + ' · 같은 순번 다른 줄 ' + final.counts.conflicts);
console.log('  마지막 파일: 집 PC ' + H.size + ' · 폰 ' + Pp.size + ' · 폐쇄망 ' + X.size + '줄, 집 PC·폰 같은 바이트 ' +
  (fs.readFileSync(file('h'), 'utf8') === fs.readFileSync(file('p'), 'utf8') ? '예' : '아니오') + ', 이른 복습 ' + st.counts.early + ' · 계산된 복습 ' + st.counts.applied);
console.log('  속도: 사건 ' + mergedBig.events.length + '줄 합치기+다시 계산 ' + ms.toFixed(0) + 'ms (카드 ' + Object.keys(stBig.cards.mwl).length + '장)');
if (problems.length) { console.log('문제 ' + problems.length + '건: ' + Array.from(new Set(problems)).slice(0, 10).join(' / ')); process.exit(1); }
console.log('유실 0 · 없던 사건 0 · 폐쇄망 사건 반출 0');
if (!arg('dir', null)) fs.rmSync(DIR, { recursive: true, force: true });
