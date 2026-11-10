/* MyLearner web/core/merge.js — 다른 기기 기록 합치기의 계산(등급 A): 미리보기(새 줄·기기·과정·새 충돌·모르는 종류·해석하지 못한 줄·미래·시계),
 * 들여온 뒤 N/N 확인, 백업 시점으로 되살리기 계획(백업 ∪ 이 기기 줄), 내보내기 알림 날 수. 저장은 하지 않는다 — 화면이 저장 어댑터로.
 * 입력: 줄 배열·오늘·이 기기 판정 / 출력: MyLearner.merge / 트리거: app/merge_view.js
 * 문서: docs/P4_요구사항정의서_Mobile.md FR-413·430~435·440~442, docs/P4_설계서_Mobile.md 3.5·3.6절, docs/P2_설계서_Core.md 3.3·3.4절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.merge = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var L = dep('log'), D = dep('dates'), C = dep('constants');
  var MS_DAY = 86400000;

  function table() { return Object.create(null); }
  // 저장소와 같은 '같은 줄' — 사건은 정규형, 해석하지 못한 줄은 앞뒤 빈칸만 뗀 글(log.parseLine)
  function keyOfParsed(p) { return p.kind === 'event' ? p.event.line : p.text; }
  function keyOf(line) { return keyOfParsed(L.parseLine(line)); }
  function keySet(lines) { var s = table(); lines.forEach(function (l) { if (String(l).trim()) s[keyOf(l)] = true; }); return s; }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // {have, file, today, isOwn(dev), known: [종류]} → 미리보기. 아무것도 쓰지 않는다
  function preview(o) {
    var have = keySet(o.have || []), seen = table(), limit = D.addDays(o.today, C.FUTURE_DAYS);
    var known = table();
    (o.known || []).forEach(function (k) { known[k] = true; });
    var total = 0, freshLines = [], devs = table(), courses = table();
    var out = { unknown: 0, bad: 0, newer: 0, future: 0 };
    (o.file || []).forEach(function (line) {
      if (!String(line).trim()) return;
      var p = L.parseLine(line), key = keyOfParsed(p);
      if (seen[key] === true) return;
      seen[key] = true;
      total += 1;
      var fresh = have[key] !== true;
      if (fresh) freshLines.push(key);
      if (p.kind !== 'event') { if (fresh) out[p.reason === 'newer' ? 'newer' : 'bad'] += 1; return; }
      var e = p.event, d = devs[e.dev] || (devs[e.dev] = { dev: e.dev, own: !!o.isOwn(e.dev), total: 0, fresh: 0, first_day: e.day, last_day: e.day, clock: 'ok' });
      d.total += 1;
      if (e.day < d.first_day) d.first_day = e.day;
      if (e.day > d.last_day) d.last_day = e.day;
      if (!fresh) return;
      d.fresh += 1;
      if (known[e.type] !== true) out.unknown += 1;
      if (e.day > limit) out.future += 1;
      var c = typeof e.data.course === 'string' ? e.data.course : '-';
      var row = courses[c] || (courses[c] = { course: c, reviews: 0, lessons: 0, other: 0 });
      if (e.type === 'review') row.reviews += 1; else if (e.type === 'lesson') row.lessons += 1; else row.other += 1;
    });
    // 시계: 합친 뒤(있던 줄 + 파일) 그 기기의 사건을 순번 순으로 — 학습일이 줄면 'back', 오늘 + 1 보다 뒤가 있으면 'ahead'(P2 설계서 3.4절 8·13)
    var merged = L.merge([o.have || [], freshLines]), byDev = table();
    merged.events.forEach(function (e) { if (devs[e.dev]) (byDev[e.dev] = byDev[e.dev] || []).push(e); });
    Object.keys(byDev).forEach(function (dev) {
      var list = byDev[dev].sort(function (a, b) { return a.seq - b.seq; }), max = '', back = false, ahead = false;
      list.forEach(function (e) { if (max && e.day < max) back = true; if (e.day > max) max = e.day; if (e.day > limit) ahead = true; });
      devs[dev].clock = ahead ? 'ahead' : back ? 'back' : 'ok';
    });
    var before = L.merge([o.have || []]).counts.conflicts;
    return { total: total, fresh: freshLines.length, freshLines: freshLines,
      devices: Object.keys(devs).map(function (k) { return devs[k]; }).sort(function (a, b) { return cmp(a.first_day, b.first_day) || cmp(a.dev, b.dev); }),
      courses: Object.keys(courses).sort().map(function (k) { return courses[k]; }),
      conflicts_new: merged.counts.conflicts - before,
      unknown: out.unknown, bad: out.bad, newer: out.newer, future: out.future };
  }

  // 들여온 뒤: 파일의 줄(키)마다 기록에 있는가 → {present, total}
  function present(haveAfter, file) {
    var have = keySet(haveAfter), want = keySet(file), n = 0, t = 0;
    Object.keys(want).forEach(function (k) { t += 1; if (have[k] === true) n += 1; });
    return { present: n, total: t };
  }

  // 되살리기: 지금 기록에만 있는 줄 가운데 이 기기 사건은 남기고, 다른 기기 사건·해석하지 못한 줄은 뺀다 → 결과 = 백업 ∪ 이 기기 줄
  function restorePlan(o) {
    var remove = [], keep = 0, by = table();
    (o.onlyCurrent || []).forEach(function (line) {
      var p = L.parseLine(line);
      if (p.kind === 'event' && o.isOwn(p.event.dev)) { keep += 1; return; }
      remove.push(line);
      var dev = p.kind === 'event' ? p.event.dev : '-';
      by[dev] = (by[dev] || 0) + 1;
    });
    return { remove: remove, keep_own: keep, add: o.onlyBackup || 0,
      by_dev: Object.keys(by).sort(function (a, b) { return (a === '-' ? -1 : b === '-' ? 1 : 0) || (by[b] - by[a]) || cmp(a, b); }).map(function (d) { return { dev: d, remove: by[d] }; }) };
  }

  // 마지막 내보내기(없으면 이 기기의 첫 기록)부터 days 일을 넘었으면 지난 날 수, 아니면 null. days 0 = 끔
  function reminderDays(o) {
    if (!o.days) return null;
    var t = Date.parse(o.exportedAt);
    if (!(t > 0)) t = Date.parse(o.firstOwnT);
    if (!(t > 0)) return null;
    var n = Math.floor((o.now.getTime() - t) / MS_DAY);
    return n > o.days ? n : null;
  }

  return { keyOf: keyOf, preview: preview, present: present, restorePlan: restorePlan, reminderDays: reminderDays };
});
