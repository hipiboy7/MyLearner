/* MyLearner web/core/zip.js — 교환 파일용 작은 zip: CRC-32, 쓰기(저장 방식·시각 고정 — 같은 입력이면 같은 바이트), 읽기(중앙 디렉터리 → 항목,
 * 저장·deflate — deflate 풀기는 주입받는다), 위험한 이름·암호·zip64·한도 거부. 외부 라이브러리 0(NFR-408).
 * 입력: 바이트(Uint8Array) / 출력: MyLearner.zip / 트리거: core/exchange.js(교환 파일 만들기·열기)
 * 문서: docs/P4_요구사항정의서_Mobile.md FR-420·423, docs/P4_설계서_Mobile.md 3.4절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var mod = factory();
  if (node) module.exports = mod; else (root.MyLearner = root.MyLearner || {}).zip = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MiB = 1024 * 1024;
  var LIMITS = { file: 256 * MiB, entries: 1000, entry: 256 * MiB, total: 512 * MiB };
  var SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_END = 0x06054b50;
  var DOS_DATE = 0x21;   // 1980-01-01 — 시각을 고정해 같은 입력이면 같은 바이트(교환 파일 머리에 실제 시각을 둔다)
  var FLAG_UTF8 = 0x0800;

  var TABLE = (function () {
    var t = new Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function fail(code, msg) { var e = new Error(code + ' ' + msg); e.code = code; return e; }
  function utf8(s) { return new TextEncoder().encode(String(s)); }
  function text(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { throw fail('E-UTF8', 'UTF-8 이 아닌 글'); }
  }
  // 위험한 이름: 비었거나 / 로 시작, 역슬래시·NUL, .. 마디
  function badName(name) {
    if (!name || name.charAt(0) === '/' || name.indexOf('\\') >= 0 || name.indexOf('\u0000') >= 0) return true;
    return name.split('/').some(function (p) { return p === '..'; });
  }

  function w16(a, n) { a.push(n & 255, (n >>> 8) & 255); }
  function w32(a, n) { a.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255); }
  function r16(b, p) { return b[p] | (b[p + 1] << 8); }
  function concat(parts) {
    var out = new Uint8Array(parts.reduce(function (a, b) { return a + b.length; }, 0)), p = 0;
    parts.forEach(function (a) { out.set(a, p); p += a.length; });
    return out;
  }
  // 지역 머리와 중앙 디렉터리 항목이 같이 쓰는 칸: 플래그 · 방식(저장) · 시각 · 날짜 · CRC · 압축 크기 · 크기 · 이름 길이 · 덧붙임 길이
  function sharedFields(a, crc, size, nameLen) {
    w16(a, FLAG_UTF8); w16(a, 0); w16(a, 0); w16(a, DOS_DATE); w32(a, crc); w32(a, size); w32(a, size); w16(a, nameLen); w16(a, 0);
  }
  function r32(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }

  // items: [{name, bytes}] → Uint8Array. 저장 방식(무압축)·플래그 UTF-8·시각 고정
  function write(items) {
    var seen = Object.create(null), chunks = [], central = [], off = 0;
    items.forEach(function (it) {
      if (typeof it.name !== 'string' || badName(it.name)) throw new Error('zip 항목 이름이 틀렸다: ' + it.name);
      if (seen[it.name] === true) throw new Error('zip 에 같은 이름이 두 번: ' + it.name);
      seen[it.name] = true;
      var name = utf8(it.name), data = it.bytes, crc = crc32(data);
      var h = [];
      w32(h, SIG_LOCAL); w16(h, 20); sharedFields(h, crc, data.length, name.length);
      var c = [];
      w32(c, SIG_CENTRAL); w16(c, 20); w16(c, 20); sharedFields(c, crc, data.length, name.length);
      w16(c, 0); w16(c, 0); w16(c, 0); w32(c, 0); w32(c, off);   // 주석 길이 · 디스크 · 내부 속성 · 외부 속성 · 지역 머리 위치
      chunks.push(Uint8Array.from(h), name, data);
      central.push(Uint8Array.from(c), name);
      off += h.length + name.length + data.length;
    });
    var cdLen = central.reduce(function (a, b) { return a + b.length; }, 0), e = [];
    w32(e, SIG_END); w16(e, 0); w16(e, 0); w16(e, items.length); w16(e, items.length); w32(e, cdLen); w32(e, off); w16(e, 0);
    return concat(chunks.concat(central, [Uint8Array.from(e)]));
  }

  function nameOf(bytes, flag) {
    if (flag & FLAG_UTF8) { try { return text(bytes); } catch (e) { return null; } }
    return new TextDecoder('utf-8').decode(bytes);   // 표시가 없는 이름(옛 도구) — 교환 파일 항목은 영문이라 그대로 맞는다
  }

  // 중앙 디렉터리를 읽는다. 오류는 {ok: false, error: 코드, msg}
  function list(bytes, limits) {
    var L = limits || LIMITS;
    function no(code, msg) { return { ok: false, error: code, msg: msg, entries: [] }; }
    var n = bytes.length;
    if (n > L.file) return no('E-ZIP-LIMIT', '파일이 ' + Math.round(L.file / MiB) + ' MiB 보다 크다');
    var end = -1;
    for (var p = n - 22; p >= 0 && p >= n - 22 - 65535; p--) {
      if (r32(bytes, p) === SIG_END && p + 22 + r16(bytes, p + 20) === n) { end = p; break; }
    }
    if (end < 0) return no('E-ZIP', 'zip 끝 레코드가 없다(zip 이 아니거나 잘린 파일)');
    var disk = r16(bytes, end + 4), cdDisk = r16(bytes, end + 6), here = r16(bytes, end + 8), count = r16(bytes, end + 10);
    var cdSize = r32(bytes, end + 12), cdOff = r32(bytes, end + 16);
    if (count === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) return no('E-ZIP-METHOD', 'zip64 는 읽지 않는다');
    if (disk !== 0 || cdDisk !== 0 || here !== count) return no('E-ZIP', '여러 조각으로 나뉜 zip 은 읽지 않는다');
    if (cdOff + cdSize > end) return no('E-ZIP', '중앙 디렉터리가 파일 밖을 가리킨다');
    if (count > L.entries) return no('E-ZIP-LIMIT', '항목이 ' + L.entries + '개보다 많다');
    var entries = [], seen = Object.create(null), total = 0, q = cdOff;
    for (var i = 0; i < count; i++) {
      if (q + 46 > cdOff + cdSize || r32(bytes, q) !== SIG_CENTRAL) return no('E-ZIP', '중앙 디렉터리 ' + (i + 1) + '번째 항목이 깨졌다');
      var flag = r16(bytes, q + 8), method = r16(bytes, q + 10), crc = r32(bytes, q + 16);
      var csize = r32(bytes, q + 20), size = r32(bytes, q + 24), nl = r16(bytes, q + 28), xl = r16(bytes, q + 30), kl = r16(bytes, q + 32);
      var off = r32(bytes, q + 42);
      if (q + 46 + nl > cdOff + cdSize) return no('E-ZIP', '중앙 디렉터리 이름이 잘렸다');
      var name = nameOf(bytes.subarray(q + 46, q + 46 + nl), flag);
      if (flag & 0x41) return no('E-ZIP-METHOD', '암호가 걸린 항목: ' + name);
      if (method !== 0 && method !== 8) return no('E-ZIP-METHOD', '모르는 압축 방식 ' + method + ': ' + name);
      if (size === 0xFFFFFFFF || csize === 0xFFFFFFFF || off === 0xFFFFFFFF) return no('E-ZIP-METHOD', 'zip64 항목: ' + name);
      if (name === null || badName(name)) return no('E-ZIP', '위험한 항목 이름');
      if (seen[name] === true) return no('E-ZIP', '같은 이름이 두 번: ' + name);
      seen[name] = true;
      if (size > L.entry) return no('E-ZIP-LIMIT', '항목이 너무 크다: ' + name);
      total += size;
      if (total > L.total) return no('E-ZIP-LIMIT', '풀린 크기가 ' + Math.round(L.total / MiB) + ' MiB 보다 크다');
      if (off + 30 > cdOff) return no('E-ZIP', '항목 위치가 틀렸다: ' + name);
      entries.push({ name: name, method: method, size: size, csize: csize, crc: crc, offset: off, flag: flag, dir: name.charAt(name.length - 1) === '/' });
      q += 46 + nl + xl + kl;
    }
    return { ok: true, error: null, msg: '', entries: entries };
  }

  // 한 항목을 푼다 — Promise<Uint8Array>. inflateRaw(압축 바이트, 상한) → Promise<Uint8Array> 는 deflate 항목에만 쓴다
  function extract(bytes, e, inflateRaw) {
    return Promise.resolve().then(function () {
      var p = e.offset;
      if (p + 30 > bytes.length || r32(bytes, p) !== SIG_LOCAL) throw fail('E-ZIP', '지역 머리가 없다: ' + e.name);
      var nl = r16(bytes, p + 26), xl = r16(bytes, p + 28);
      if (nameOf(bytes.subarray(p + 30, p + 30 + nl), r16(bytes, p + 6)) !== e.name) throw fail('E-ZIP', '지역 머리 이름이 다르다: ' + e.name);
      var start = p + 30 + nl + xl;
      if (start + e.csize > bytes.length) throw fail('E-ZIP', '자료가 잘렸다: ' + e.name);
      var data = bytes.subarray(start, start + e.csize);
      if (e.method === 0) {
        if (e.csize !== e.size) throw fail('E-ZIP', '저장 항목의 크기가 다르다: ' + e.name);
        return data;
      }
      if (typeof inflateRaw !== 'function') throw fail('E-ZIP-METHOD', '이 브라우저는 압축된 zip 을 풀 수 없다: ' + e.name);
      return Promise.resolve().then(function () { return inflateRaw(data, e.size); })
        .catch(function (err) { throw fail('E-ZIP', '압축을 풀지 못했다(' + ((err && err.message) || err) + '): ' + e.name); });
    }).then(function (out) {
      if (out.length !== e.size) throw fail('E-ZIP', '풀린 크기가 적힌 것과 다르다: ' + e.name);
      if (crc32(out) !== e.crc) throw fail('E-ZIP', 'CRC 가 다르다(깨진 파일): ' + e.name);
      return out;
    });
  }

  return { LIMITS: LIMITS, crc32: crc32, write: write, list: list, extract: extract, utf8: utf8, text: text };
});
