// 등급 A — MWL 골든 벡터 scheduler_cases.json(MiddlewareLearner@e55b9c0)의 계획 19·숙련도 2·통계 2가지(FR-242, S5).
// 길: MWL content → (Python) to_course → tests/fixtures/mwl/scheduler_course.json, MWL progress → mwl_import → 사건 → replay → plan·mastery·stats.
// 결과를 MWL 꼴로 되돌려(어댑터) 그대로 견준다. 문서: docs/P2_설계서_Core.md 3.5절. 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { core, fixture, sortKeys } = require('./helpers');
const I = core('mwl_import'), L = core('log'), R = core('replay'), P = core('plan'), M = core('mastery'), T = core('stats');

const cases = fixture('mwl/scheduler_cases.json');
const course = fixture('mwl/scheduler_course.json');
function setup(progress, today) {
  const conv = I.convert(progress);
  return { st: R.run(L.merge([conv.lines]).events, { today: today }), courses: [course].concat(conv.notes ? [conv.notes] : []) };
}
function ids(list) { return list.map((x) => x.id); }
function one(x) { return x ? x.id : null; }
function asMwlPlan(p) {
  return { date: p.date, is_study_day: p.is_study_day, reviews: ids(p.reviews), new_cards: ids(p.new_cards), lesson: one(p.lesson), lab: one(p.lab),
    drill: one(p.drill), quiz: one(p.quiz), journal: p.journal, minutes_estimate: p.minutes_estimate, week: p.week, theme: p.theme, total_minutes: p.total_minutes };
}
function asMwlParts(parts) {
  const out = {};
  for (const [pid, p] of Object.entries(parts)) out[pid] = { title: p.title, code: p.code, modules: p.units, lessons_done: p.lessons_done, lessons_total: p.lessons_total, avg_level: p.avg_level };
  return out;
}

test('계획 19가지 — MWL buildDailyPlan 과 같다', () => {
  assert.equal(cases.scheduler_cases.length, 19);
  for (const c of cases.scheduler_cases) {
    const { st, courses } = setup(c.progress, c.today);
    const settings = Object.assign({}, c.settings, { main_course: 'mwl', plan_variants: { mwl: c.settings.plan_variant } });
    const got = asMwlPlan(P.build(courses, st, settings, c.today, { docker: c.docker_available }));
    assert.deepEqual(sortKeys(got), sortKeys(c.expected), c.name);
  }
});

test('숙련도 2가지 — MWL domainSummary 와 같다', () => {
  for (const c of cases.mastery_cases) {
    const { st } = setup(c.progress, '2026-09-15');
    assert.deepEqual(sortKeys(asMwlParts(M.summary(course, st))), sortKeys(c.expected), c.name);
  }
});

test('통계 2가지 — MWL summary 와 같다', () => {
  for (const c of cases.stats_cases) {
    const { st, courses } = setup(c.progress, c.today);
    const got = T.summary(courses, st, c.today, c.study_days);
    got.domains = asMwlParts(got.courses.mwl);
    delete got.courses;
    assert.deepEqual(sortKeys(got), sortKeys(c.expected), c.name);
  }
});
