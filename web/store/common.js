/* MyLearner web/store/common.js — 저장 어댑터의 순수 부분(등급 A): 달 키, 글 ↔ 줄, 줄 합집합, 쓰는 탭 임대, 백업 이름·남길 것.
 * 브라우저 어댑터(browser.js)와 화면(app/state.js)이 같이 쓴다. 서버 쪽 같은 규칙은 mylearner/storage.py(백업 남기기 20·14).
 * 입력: 기록 줄·임대 기록·시각 / 출력: MyLearner.storeCommon / 트리거: store/browser.js·app/state.js
 * 문서: docs/P3_요구사항정의서_PC.md FR-322·324·325, docs/P3_설계서_PC.md 3.2절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('../core/' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.storeCommon = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var L = dep('log'), D = dep('dates');
  var PREFIX = 'mylearner.', LOG_PREFIX = 'mylearner.log.', RAW_KEY = 'mylearner.log.raw';
  var KEYS = { device: 'mylearner.device', seq: 'mylearner.seq', daily: 'mylearner.daily', writer: 'mylearner.writer', ui: 'mylearner.ui' };
  var LEASE_TTL = 6000, LEASE_BEAT = 2000;
  var KEEP = { 'import-mwl': 20, daily: 14 };
  var REASON = /^[a-z][a-z0-9-]{0,31}$/, NAME = /^(\d{8}T\d{9}Z)-([a-z][a-z0-9-]{0,31})$/;

  function keyOf(line) {
    var p = L.parseLine(line);
    return p.kind === 'event' ? LOG_PREFIX + D.monthOf(p.event.day) : RAW_KEY;
  }
  function isLogKey(k) { return typeof k === 'string' && k.indexOf(LOG_PREFIX) === 0 && (k === RAW_KEY || /^mylearner\.log\.\d{4}-\d{2}$/.test(k)); }
  function splitText(text) { return text ? String(text).split(/\r\n|\n|\r/).filter(function (l) { return l.trim(); }) : []; }
  function joinLines(lines) { return lines.join('\n'); }

  function union(have, add) {
    var seen = Object.create(null), out = [], added = 0;
    have.forEach(function (l) { if (seen[l] !== true) { seen[l] = true; out.push(l); } });
    add.forEach(function (l) { if (seen[l] !== true) { seen[l] = true; out.push(l); added += 1; } });
    return { lines: out, added: added };
  }
  function groupByKey(lines) {
    var g = Object.create(null);
    lines.forEach(function (l) { var k = keyOf(l); (g[k] = g[k] || []).push(l); });
    return g;
  }
  function maxSeq(lines, dev) {
    return lines.reduce(function (m, l) { var p = L.parseLine(l); return p.kind === 'event' && p.event.dev === dev && p.event.seq > m ? p.event.seq : m; }, 0);
  }

  function parseLease(text) {
    if (!text) return null;
    try { var o = JSON.parse(text); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
  }
  function lease(rec, me, now) {
    if (!rec || typeof rec.id !== 'string' || typeof rec.at !== 'number') return 'mine';
    if (rec.id === me) return 'mine';
    return now - rec.at >= LEASE_TTL ? 'mine' : 'other';
  }

  function pad(n, w) { return String(n).padStart(w, '0'); }
  function backupName(date, reason) {
    if (!REASON.test(reason)) throw new Error('백업 까닭이 틀렸다: ' + reason);
    return date.getUTCFullYear() + pad(date.getUTCMonth() + 1, 2) + pad(date.getUTCDate(), 2) + 'T' + pad(date.getUTCHours(), 2) +
      pad(date.getUTCMinutes(), 2) + pad(date.getUTCSeconds(), 2) + pad(date.getUTCMilliseconds(), 3) + 'Z-' + reason;
  }
  function reasonOf(name) { var m = NAME.exec(name); return m ? m[2] : null; }
  function pruneBackups(names) {
    var by = Object.create(null), del = [];
    names.forEach(function (n) { var r = reasonOf(n); if (r && Object.prototype.hasOwnProperty.call(KEEP, r)) (by[r] = by[r] || []).push(n); });
    Object.keys(by).forEach(function (r) {
      var list = by[r].slice().sort().reverse();
      Array.prototype.push.apply(del, list.slice(KEEP[r]));
    });
    return del.sort();
  }

  return { PREFIX: PREFIX, LOG_PREFIX: LOG_PREFIX, RAW_KEY: RAW_KEY, KEYS: KEYS, LEASE_TTL: LEASE_TTL, LEASE_BEAT: LEASE_BEAT, KEEP: KEEP,
    keyOf: keyOf, isLogKey: isLogKey, splitText: splitText, joinLines: joinLines, union: union, groupByKey: groupByKey, maxSeq: maxSeq,
    parseLease: parseLease, lease: lease, backupName: backupName, reasonOf: reasonOf, pruneBackups: pruneBackups };
});
