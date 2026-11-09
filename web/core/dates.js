/* MyLearner web/core/dates.js — 날짜 'YYYY-MM-DD' 계산(UTC 기준이라 시간대 영향 없음)·학습일·시각 꼴.
 * 입력: 없음(constants) / 출력: MyLearner.dates / 트리거: core 의 다른 파일
 * 문서: docs/P2_요구사항정의서_Core.md FR-213, docs/P2_설계서_Core.md 3.3·4절. 일부는 MWL web/engine.js(e55b9c0)에서 옮겼다. */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.dates = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants');
  var DAY = new RegExp(C.DAY_RE);
  var TIME = new RegExp(C.TIME_RE);
  var MS_DAY = 86400000;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function parseISO(s) { var p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function toISO(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function addDays(iso, n) { return toISO(parseISO(iso) + n * MS_DAY); }
  function diffDays(a, b) { return Math.round((parseISO(b) - parseISO(a)) / MS_DAY); }
  function isoWeekday(iso) { var d = new Date(parseISO(iso)).getUTCDay(); return d === 0 ? 7 : d; }
  function monthOf(iso) { return iso.slice(0, 7); }
  function isDay(s) { return typeof s === 'string' && DAY.test(s) && toISO(parseISO(s)) === s; }
  function isTime(s) {
    if (typeof s !== 'string' || !TIME.test(s) || !isDay(s.slice(0, 10))) return false;
    var h = Number(s.slice(11, 13)), m = Number(s.slice(14, 16)), sec = Number(s.slice(17, 19));
    return h < 24 && m < 60 && sec < 60;
  }
  // 그 기기의 학습일 — 현지 시각에서 경계 시각(기본 0시)을 뺀 날짜
  function learningDay(date, dayStartHour) {
    var h = dayStartHour === undefined ? C.PLAN_DEFAULTS.day_start_hour : dayStartHour;
    if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error('day_start_hour 는 0~23 의 정수');
    var d = new Date(date.getTime() - h * 3600000);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  return { parseISO: parseISO, toISO: toISO, addDays: addDays, diffDays: diffDays, isoWeekday: isoWeekday, monthOf: monthOf,
    isDay: isDay, isTime: isTime, learningDay: learningDay };
});
