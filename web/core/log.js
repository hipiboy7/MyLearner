/* MyLearner web/core/log.js — 사건 봉투·정규형, 기록 파일 읽기·쓰기, 합치기(합집합)와 다시 계산 순서, 기기 ID.
 * 뼈대는 hub src/learnhub/engine/events.py(8dee3b8): 한 줄 JSON, (기기, 순번), 기기 안은 순번·기기 사이는 시각으로 엮기.
 * 다른 점: 같은 (기기, 순번)의 다른 줄을 둘 다 남긴다, 읽을 수 없는 줄·새 판도 남긴다(유실 0), 열쇠에 학습일·순위를 앞세운다.
 * 입력: 사건 필드·기록 파일 글 / 출력: MyLearner.log / 트리거: replay.js·mwl_import.js·(Phase 3) 저장 어댑터·합치기 화면
 * 문서: docs/P2_요구사항정의서_Core.md FR-220~227, docs/P2_설계서_Core.md 3.3절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.log = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants'), D = dep('dates');
  var S = C.SHARED;
  var DEVICE = new RegExp(C.DEVICE_RE), TYPE = new RegExp(C.TYPE_RE);
  var ENVELOPE = ['v', 'dev', 'seq', 't', 'day', 'type'];

  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  function envelopeOk(o) {
    return o.v === S.EVENT_VERSION && typeof o.dev === 'string' && DEVICE.test(o.dev) &&
      Number.isInteger(o.seq) && o.seq >= 1 && o.seq <= C.MAX_SEQ && D.isTime(o.t) && D.isDay(o.day) &&
      typeof o.type === 'string' && TYPE.test(o.type);
  }
  function toEvent(o, line) {
    return { line: line, v: o.v, dev: o.dev, seq: o.seq, t: o.t, day: o.day, type: o.type, data: o };
  }

  // 새 사건 — 봉투가 틀리면 던진다(앱의 버그를 일찍 잡는다)
  function make(fields) {
    var o = Object.assign({ v: S.EVENT_VERSION }, fields);
    if (!envelopeOk(o)) throw new Error('사건 봉투가 틀렸다: ' + ENVELOPE.filter(function (k) { return !(k in o); }).join(','));
    var obj = JSON.parse(canonical(o));
    return toEvent(obj, canonical(obj));
  }
  function stamp(date, dayStartHour) { return { t: date.toISOString(), day: D.learningDay(date, dayStartHour) }; }

  function parseLine(text) {
    var s = String(text).trim();
    var o;
    try { o = JSON.parse(s); } catch (e) { return { kind: 'raw', reason: 'bad', text: s }; }
    // JSON 인 줄은 해석하지 못해도 정규형으로 남긴다 — 키 순서만 다른 같은 줄이 둘로 늘지 않는다
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { kind: 'raw', reason: 'bad', text: canonical(o) };
    if (Number.isInteger(o.v) && o.v > S.EVENT_VERSION) return { kind: 'raw', reason: 'newer', text: canonical(o) };
    if (!envelopeOk(o)) return { kind: 'raw', reason: 'bad', text: canonical(o) };
    return { kind: 'event', event: toEvent(o, canonical(o)) };
  }

  // ---- 순서: 기기마다 (seq, 정규형), 기기 사이는 맨 앞 사건의 열쇠 (day, 순위, t, dev) 가 작은 것부터(힙)
  function rank(e) { return C.EVENT_RANK[e.type] || 0; }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function cmpKey(a, b) { return cmpStr(a.day, b.day) || (rank(a) - rank(b)) || cmpStr(a.t, b.t) || cmpStr(a.dev, b.dev); }
  function order(events) {
    var by = {};
    events.forEach(function (e) { (by[e.dev] = by[e.dev] || []).push(e); });
    var heap = [];
    function less(i, j) { return cmpKey(heap[i].list[heap[i].at], heap[j].list[heap[j].at]) < 0; }
    function swap(i, j) { var t = heap[i]; heap[i] = heap[j]; heap[j] = t; }
    function up(i) { while (i > 0) { var p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; } }
    function down(i) {
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === i) return;
        swap(i, m); i = m;
      }
    }
    Object.keys(by).forEach(function (dev) {
      by[dev].sort(function (a, b) { return (a.seq - b.seq) || cmpStr(a.line, b.line); });
      heap.push({ list: by[dev], at: 0 }); up(heap.length - 1);
    });
    var out = [];
    while (heap.length) {
      var top = heap[0];
      out.push(top.list[top.at]);
      top.at += 1;
      if (top.at >= top.list.length) { var last = heap.pop(); if (heap.length) { heap[0] = last; down(0); } }
      else down(0);
    }
    return out;
  }

  // 합치기 = 합집합. lineLists: 줄 배열들(파일마다 하나). 결과는 줄 모음만의 함수다
  function merge(lineLists) {
    var events = {}, raw = {}, bad = 0, newer = 0, nEvents = 0;
    var rawReason = {};
    (lineLists || []).forEach(function (lines) {
      lines.forEach(function (line) {
        if (!String(line).trim()) return;
        var p = parseLine(line);
        if (p.kind === 'event') { if (!events[p.event.line]) { events[p.event.line] = p.event; nEvents += 1; } }
        else if (!raw[p.text]) { raw[p.text] = true; rawReason[p.text] = p.reason; }
      });
    });
    var list = Object.keys(events).map(function (k) { return events[k]; });
    var perKey = {};
    list.forEach(function (e) { var k = e.dev + '\u0000' + e.seq; perKey[k] = (perKey[k] || 0) + 1; });
    var conflicts = Object.keys(perKey).reduce(function (a, k) { return a + perKey[k] - 1; }, 0);
    var rawList = Object.keys(raw).sort();
    rawList.forEach(function (t) { if (rawReason[t] === 'newer') newer += 1; else bad += 1; });
    return { events: order(list), raw: rawList, counts: { events: nEvents, conflicts: conflicts, bad: bad, newer: newer } };
  }

  var HEADER = canonical({ format: S.LOG_FORMAT, version: S.LOG_VERSION, min_reader: S.LOG_MIN_READER });
  function writeFile(merged) {
    var lines = [HEADER].concat(merged.events.map(function (e) { return e.line; }), merged.raw || []);
    return lines.join('\n') + '\n';
  }
  function readFile(text) {
    var lines = String(text).replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
    var i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    var head = null;
    try { head = i < lines.length ? JSON.parse(lines[i]) : null; } catch (e) { head = null; }
    if (!head || typeof head !== 'object' || head.format !== S.LOG_FORMAT || !Number.isInteger(head.version) || head.version < 1 ||
        !Number.isInteger(head.min_reader) || head.min_reader < 1) return { ok: false, error: 'E-LOG-FORMAT', header: null, lines: [] };
    if (head.min_reader > S.LOG_READER) return { ok: false, error: 'E-LOG-READER', header: head, lines: [] };
    return { ok: true, error: null, header: head, lines: lines.slice(i + 1).filter(function (l) { return l.trim(); }) };
  }

  function newDeviceId(randomBytes) {
    if (typeof randomBytes !== 'function') throw new Error('난수원이 필요하다(crypto.getRandomValues)');
    var b = randomBytes(8);
    if (!b || b.length !== 8) throw new Error('난수원이 8바이트를 주지 않았다');
    return Array.prototype.map.call(b, function (x) { return (x & 255).toString(16).padStart(2, '0'); }).join('');
  }
  function nextSeq(events, dev) {
    return events.reduce(function (m, e) { return e.dev === dev && e.seq > m ? e.seq : m; }, 0) + 1;
  }
  function splitByMonth(events) {
    var out = {};
    events.forEach(function (e) { var k = D.monthOf(e.day); (out[k] = out[k] || []).push(e); });
    return out;
  }

  return { canonical: canonical, make: make, stamp: stamp, parseLine: parseLine, merge: merge, order: order,
    writeFile: writeFile, readFile: readFile, HEADER: HEADER, newDeviceId: newDeviceId, nextSeq: nextSeq, splitByMonth: splitByMonth };
});
