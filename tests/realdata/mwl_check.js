// MWL 실데이터 대조(FR-251·260, 등급 C) — 변환한 과정 파일을 과정 검사로 보고, 135과·91실습·24드릴의 글을 그려 MWL bundle.js 의 HTML 과 견준다.
// 입력: node tests/realdata/mwl_check.js <과정 파일> <MWL web/data/bundle.js>   출력: 표준 출력 요약, 다르면 종료 코드 1
// 트리거: scripts/check_mwl_real.py(전체 검증 'MWL 실데이터 대조'). 문서: docs/P2_설계서_Core.md 3.6절
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
process.exit(failed ? 1 : 0);
