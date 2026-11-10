/* MyLearner web/core/exchange.js — 교환 파일(zip 하나 = 머리 manifest.json + 기록 log.jsonl + 사용자 과정 courses/<id>.json) 만들기·열기,
 * 파일 종류 알아보기(교환 zip · 기록 파일 · MWL 진도 · 그 밖), 머리가 적은 크기·SHA-256 대조, 줄 길이 한도. 계산은 하지 않는다.
 * 입력: 줄·과정·앱 정보(만들기) / 파일 바이트(열기) / 출력: MyLearner.exchange / 트리거: app/merge_view.js(내보내기·합치기)
 * 문서: docs/P4_요구사항정의서_Mobile.md FR-420~424, docs/P4_설계서_Mobile.md 3.4절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.exchange = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var L = dep('log'), Z = dep('zip'), H = dep('hash'), D = dep('dates');
  var FORMAT = 'mylearner-exchange', VERSION = 1, MIN_READER = 1, READER = 1;
  var LINE_MAX = 65536;   // 저장소(store/common.js MAX_LINE_BYTES · storage.py)가 받는 한 줄의 바이트 — 넘는 줄은 들여와도 저장되지 않는다
  var COURSE_PATH = /^courses\/[a-z0-9][a-z0-9-]{0,39}\.json$/;

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function bad(code, msg) { return { ok: false, error: code, msg: msg || '', kind: null, manifest: null, lines: [], courses: [] }; }

  // ---------------------------------------------------------------- 만들기
  // {lines, raw, courses, app: {version, edition, label}, dev, now: Date, dayStartHour} → {name, bytes, manifest}. now 를 주입받는다(같은 입력 = 같은 바이트)
  function build(o) {
    var merged = L.merge([o.lines || [], o.raw || []]);
    var logText = L.writeFile(merged);
    var courses = (o.courses || []).slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    var files = [{ path: 'log.jsonl', text: logText, lines: merged.events.length + merged.raw.length }];
    courses.forEach(function (c) { files.push({ path: 'courses/' + c.id + '.json', text: L.canonical(c) + '\n', id: c.id }); });
    var day = D.learningDay(o.now, o.dayStartHour || 0);
    var manifest = { format: FORMAT, version: VERSION, min_reader: MIN_READER,
      app: { name: 'mylearner', version: String((o.app && o.app.version) || ''), edition: String((o.app && o.app.edition) || ''), label: String((o.app && o.app.label) || '') },
      dev: o.dev, made_at: o.now.toISOString(), day: day,
      files: files.map(function (f) {
        var m = { path: f.path };
        if (f.id) m.id = f.id;
        m.bytes = Z.utf8(f.text).length; m.sha256 = H.sha256Hex(f.text);
        if (f.lines !== undefined) m.lines = f.lines;
        return m;
      }) };
    var items = [{ name: 'manifest.json', bytes: Z.utf8(JSON.stringify(manifest, null, 1) + '\n') }]
      .concat(files.map(function (f) { return { name: f.path, bytes: Z.utf8(f.text) }; }));
    return { name: 'mylearner-exchange-' + day + '-' + String(o.dev).slice(0, 6) + '.zip', bytes: Z.write(items), manifest: manifest };
  }

  // ---------------------------------------------------------------- 알아보기
  function firstText(bytes, n) {
    return new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(bytes.length, n))).replace(/^\uFEFF/, '');
  }
  function sniff(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6)) return 'zip';
    var head = firstText(bytes, 4096).replace(/^\s+/, '');
    if (!head) return 'unknown';
    var line = head.split(/\r\n|\n|\r/)[0];
    try { var h = JSON.parse(line); if (h && h.format === 'mylearner-log') return 'log'; } catch (e) { /* 아래로 */ }
    if (head.charAt(0) === '{') {
      try {
        var o = JSON.parse(new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, ''));
        if (o && typeof o === 'object' && !Array.isArray(o) && !own(o, 'format') && (o.schema === 1 || o.schema === 2)) return 'mwl';
      } catch (e) { /* 모르는 파일 */ }
    }
    return 'unknown';
  }

  function utf8Len(s) { return Z.utf8(s).length; }
  function longLines(lines) { return lines.filter(function (l) { return l.length * 3 > LINE_MAX && utf8Len(l) > LINE_MAX; }).length; }
  function fromLog(text, kind) {
    var f = L.readFile(text);
    if (!f.ok) return bad(f.error, f.error === 'E-LOG-READER' ? '이 앱보다 새 판이 만든 기록 파일' : '기록 파일 머리가 아니다');
    var n = longLines(f.lines);
    if (n) return bad('E-LINE-LONG', '64 KiB 넘는 줄 ' + n + '개');
    return { ok: true, error: null, msg: '', kind: kind, manifest: null, lines: f.lines, courses: [] };
  }

  // ---------------------------------------------------------------- 열기
  // bytes → Promise<{ok, error, msg, kind: 'exchange'|'log', manifest, lines, courses: [{id, obj, error}]}>. inflateRaw 는 deflate 항목에만
  function open(bytes, opt) {
    opt = opt || {};
    var kind = sniff(bytes);
    if (kind === 'mwl') return Promise.resolve(bad('E-FILE-MWL', 'MWL 진도 파일 — 설정 → MWL 진도 들여오기에서 엽니다'));
    if (kind === 'unknown') return Promise.resolve(bad('E-FILE-KIND', '교환 파일(.zip)이나 기록 파일(.jsonl)이 아니다'));
    if (kind === 'log') {
      return Promise.resolve().then(function () { return fromLog(Z.text(bytes), 'log'); })
        .catch(function (e) { return bad(e.code || 'E-UTF8', e.message); });
    }
    var l = Z.list(bytes, opt.limits);
    if (!l.ok) return Promise.resolve(bad(l.error, l.msg));
    var byName = Object.create(null);
    l.entries.forEach(function (e) { if (!e.dir) byName[e.name] = e; });
    // 풀었다 한 폴더째 다시 묶은 zip — 모든 항목이 같은 맨 위 폴더 아래면 그 폴더를 뗀다
    var base = '';
    if (!byName['manifest.json']) {
      var tops = Object.create(null), n = 0;
      l.entries.forEach(function (e) { var i = e.name.indexOf('/'); var t = i > 0 ? e.name.slice(0, i + 1) : ''; if (!tops[t]) { tops[t] = true; n += 1; } });
      var only = Object.keys(tops);
      if (n === 1 && only[0] && byName[only[0] + 'manifest.json']) base = only[0];
    }
    function entry(p) { return byName[base + p] || null; }
    function read(p) { return Z.extract(bytes, entry(p), opt.inflateRaw).then(Z.text); }
    if (!entry('manifest.json')) return Promise.resolve(bad('E-EX-MISSING', 'manifest.json 이 없다 — MyLearner 교환 파일이 아니다'));
    var manifest;
    return read('manifest.json').then(function (t) {
      try { manifest = JSON.parse(t); } catch (e) { throw Object.assign(new Error('manifest.json 이 JSON 이 아니다'), { code: 'E-EX-FORMAT' }); }
      if (!manifest || manifest.format !== FORMAT || !Number.isInteger(manifest.version) || !Number.isInteger(manifest.min_reader) || !Array.isArray(manifest.files)) {
        throw Object.assign(new Error('교환 파일 머리가 아니다'), { code: 'E-EX-FORMAT' });
      }
      if (manifest.min_reader > READER) throw Object.assign(new Error('이 앱보다 새 판이 만든 교환 파일 — 앱을 올린다'), { code: 'E-EX-READER' });
      var paths = Object.create(null);
      manifest.files.forEach(function (f) {
        if (!f || typeof f.path !== 'string' || (f.path !== 'log.jsonl' && !COURSE_PATH.test(f.path)) || paths[f.path] === true ||
            !Number.isInteger(f.bytes) || typeof f.sha256 !== 'string') throw Object.assign(new Error('머리의 파일 목록이 틀렸다'), { code: 'E-EX-FORMAT' });
        paths[f.path] = true;
      });
      if (paths['log.jsonl'] !== true) throw Object.assign(new Error('log.jsonl'), { code: 'E-EX-MISSING' });
      // 적힌 파일마다: 있나 → 크기·SHA-256
      return manifest.files.reduce(function (p, f) {
        return p.then(function (acc) {
          if (!entry(f.path)) throw Object.assign(new Error(f.path), { code: 'E-EX-MISSING' });
          return Z.extract(bytes, entry(f.path), opt.inflateRaw).then(function (b) {
            var text = Z.text(b);
            if (b.length !== f.bytes || H.sha256Hex(text) !== f.sha256) throw Object.assign(new Error(f.path + ' 의 내용이 머리와 다르다(옮기다 깨졌다)'), { code: 'E-EX-HASH' });
            acc[f.path] = text;
            return acc;
          });
        });
      }, Promise.resolve(Object.create(null)));
    }).then(function (texts) {
      var r = fromLog(texts['log.jsonl'], 'exchange');
      if (!r.ok) return r;
      r.manifest = manifest;
      manifest.files.forEach(function (f) {
        if (f.path === 'log.jsonl') return;
        var obj = null, err = null;
        try { obj = JSON.parse(texts[f.path]); } catch (e) { err = 'JSON 이 아니다'; }
        var id = f.path.slice(8, -5);
        r.courses.push({ id: id, obj: obj, error: err });
      });
      return r;
    }).catch(function (e) { return bad(e.code || 'E-ZIP', e.code ? String(e.message).replace(/^E-[A-Z0-9-]+ /, '') : e.message); });
  }

  return { FORMAT: FORMAT, VERSION: VERSION, READER: READER, LINE_MAX: LINE_MAX, build: build, sniff: sniff, open: open };
});
