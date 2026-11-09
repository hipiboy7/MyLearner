// MWL 실데이터 대조(FR-251·260, 등급 C) — 변환한 과정 파일을 과정 검사로 보고, 135과·91실습·24드릴의 글을 그려 MWL bundle.js 의 HTML 과 견준다.
// 입력: node tests/realdata/mwl_check.js <과정 파일> <MWL web/data/bundle.js>   출력: 표준 출력 요약, 다르면 종료 코드 1
// 실습 정규식 54개는 답 모음으로 V8 RegExp 와 채점 결과를 견준다(3.7절).
// 트리거: scripts/check_mwl_real.py(전체 검증 'MWL 실데이터 대조'). 문서: docs/P2_설계서_Core.md 3.6·3.7절
'use strict';
const fs = require('fs');
const path = require('path');
const core = (n) => require(path.join(__dirname, '..', '..', 'web', 'core', n + '.js'));
const K = core('course'), Mk = core('markdown');

const [coursePath, bundlePath] = process.argv.slice(2);
const course = JSON.parse(fs.readFileSync(coursePath, 'utf8'));
const btext = fs.readFileSync(bundlePath, 'utf8');
const bundle = JSON.parse(btext.slice(btext.indexOf('{'), btext.lastIndexOf('}') + 1));
let failed = 0;
function fail(msg) { failed += 1; console.log('다름: ' + msg); }

const v = K.validate(course);
console.log('과정 검사: 오류 ' + v.error_count + ' · 경고 ' + v.warning_count + ' · ' + JSON.stringify(v.counts));
v.errors.slice(0, 10).forEach((e) => console.log('  ' + e.code + ' ' + e.path + ' ' + e.msg));
if (!v.ok) failed += 1;
const want = { lessons: 135, cards: 1350, labs: 91, drills: 24, quizzes: 55, glossary: 350, diagnostic: 35 };
for (const [k, n] of Object.entries(want)) if (v.counts[k] !== n) fail('개수 ' + k + ' ' + v.counts[k] + ' != ' + n);

const toc = new Set(K.index(course).tocLessons);
const opts = { lessonRef: (id) => (toc.has(id) ? '#/learn/mwl/' + id : null) };
const mwlRef = (html) => html.replace(/href="#\/learn\//g, 'href="#/learn/mwl/');
function firstDiff(a, b) { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; }
function compare(kind, id, got, exp) {
  if (got === exp) return true;
  const i = firstDiff(got, exp);
  fail(kind + ' ' + id + ' @' + i + '\n  우리: ' + JSON.stringify(got.slice(Math.max(0, i - 40), i + 60)) + '\n  MWL : ' + JSON.stringify(exp.slice(Math.max(0, i - 40), i + 60)));
  return false;
}
const t0 = process.hrtime.bigint();
let lessonsOk = 0;
for (const id of Object.keys(bundle.lessons).sort()) if (compare('강의', id, Mk.render(course.lessons[id].body, opts), mwlRef(bundle.lessons[id].html))) lessonsOk += 1;
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
let labsOk = 0;
for (const id of Object.keys(bundle.labs).sort()) if (compare('실습', id, Mk.render(course.labs[id].body, opts), mwlRef(bundle.labs[id].html))) labsOk += 1;
let drillText = 0, drillOk = 0;
for (const id of Object.keys(bundle.drills).sort()) {
  const d = bundle.drills[id], c = course.drills[id];
  const pairs = [['situation', c.situation, d.situation_html], ['debrief', c.debrief, d.debrief_html]]
    .concat(Object.keys(d.steps).sort().map((s) => ['step ' + s, c.steps[s].prompt, d.steps[s].prompt_html]));
  for (const [what, md, html] of pairs) { drillText += 1; if (compare('드릴', id + ' ' + what, Mk.render(md), html)) drillOk += 1; }
}
const nLessons = Object.keys(bundle.lessons).length, nLabs = Object.keys(bundle.labs).length;
console.log('렌더 일치: 강의 ' + lessonsOk + '/' + nLessons + ' · 실습 ' + labsOk + '/' + nLabs + ' · 드릴 글 ' + drillOk + '/' + drillText +
  ' (강의 ' + nLessons + '과 그리기 ' + ms.toFixed(0) + 'ms)');
if (ms > 2000) fail('NFR-203 강의 그리기 2초 넘음');

// 실습 정규식(독립 점검 ② — 선형 엔진 regex.js): MWL 실제 패턴마다 답 모음을 V8 RegExp(처음 checkLab 이 쓰던 것)와 같게 채점하는가
const G = core('grade');
const POOL = ['STANDBY', 'WARNING', 'warning', 'WebtoB 5.0 SP 4 Fix #2', 'WebtoB 5 SP 4 Fix #2', 'attach-stacktrace-on-error false', 'false attach-stacktrace-on-error',
  'system-info -patch ms1', 'system-info  -patch <MS>', 'trust-store-file-path', 'stmt-query-timeout', '45', 'https://jakarta.ee/xml/ns/jakartaee', 'SERVER-0300',
  '[SERVER-0300]', 'thread-info -server <MS> -os -repeat 3 -interval 5', 'ci', 'ci, si', 'ci·si', 'application-info -sps', 'appinfo x -sps', 'start-server ms1 -f',
  'start-server ms1 --force', 'SERVER-0401', 'System.gc()', 'modify-logger x jeus.jdbc.sql FINE', '/ibank/transfer/confirm.do', 'MinProc = 2', 'MinProc 2', 'MinProc=2',
  '2', 'set -v ibank_jsv mq 300', 'ms1', 'HTH-00074', 'INFO', 'ssl_b', '/api/v1/balance', 'HthQTimeout', 'SYN_SENT', 'SYN SENT', 'SYNSENT', 'inst_id', 'ESTAB',
  'ESTABLISHED', '/ib/login/otpVerify.do', '1.5', '12', 'Wait', 'wait', 'cpinfo -server ms1 -id ds_core -t -jdbc', '끊김', 'no data', 'nodata', 'ENPHAROS JAVA 미도입',
  'JAVA', 'mw-web01', '네트워크', 'enpharos trace', 'ENPHAROS  TP', '마스킹', '원본은 복사하지 않는다', '숫자', '인사', 'SELECT', 'select', '조회', 'is null', 'IS   NULL',
  "acct_no = '110123456789'", "acct_no='110123456789'", 'SQLNET.EXPIRE_TIME = 10', 'SQLNET.EXPIRE_TIME=60', 'SQLNET.EXPIRE_TIME 5', 'PRIOR branch_cd = parent_branch_cd',
  'labs/env/scripts/lab-status.sh', 'Full GC', '풀gc', 'Too Many Open Files', 'inode', '아이노드', '', 'x', 'STANDBY ', 'standby'];
let nPat = 0, nCmp = 0, nSame = 0, nHit = 0;
for (const id of Object.keys(course.labs).sort()) {
  for (const k of course.labs[id].checks || []) {
    if (k.type !== 'regex') continue;
    nPat += 1;
    const src = k.answer.indexOf('(?i)') === 0 ? k.answer.slice(4) : k.answer, re = new RegExp('^(?:' + src + ')$', src === k.answer ? '' : 'i');
    let hit = false;
    for (const ans of POOL) {
      const want = re.test(ans.trim()), got = G.checkLab(k, ans);
      nCmp += 1; if (want === got) nSame += 1; else fail('실습 정규식 ' + id + ' ' + JSON.stringify(k.answer) + ' 답 ' + JSON.stringify(ans) + ' V8 ' + want);
      hit = hit || want;
    }
    if (hit) nHit += 1;
  }
}
console.log('실습 정규식: 패턴 ' + nPat + ' × 답 ' + POOL.length + ' = ' + nCmp + '가지, V8 과 같음 ' + nSame + '/' + nCmp + ' (맞는 답이 모음에 있는 패턴 ' + nHit + '/' + nPat + ')');
if (nPat !== 54) fail('실습 정규식 패턴 수 ' + nPat + '(기대 54)');
process.exit(failed ? 1 : 0);
