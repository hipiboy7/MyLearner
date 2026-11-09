/* MyLearner web/store/idb.js — IndexedDB 를 작은 KV(get·put·keys·del, 모두 약속)로 감싼다. 브라우저에서만 돈다(등급 C — scripts/app_smoke.py).
 * 데이터베이스 'mylearner' 판 1, 저장소: courses(사용자 과정)·backups(백업 머리)·backup_text(백업 글).
 * 입력: window.indexedDB / 출력: MyLearner.storeIdb.open() → Promise<kv|null>(쓸 수 없으면 null) / 트리거: app/state.js
 * 문서: docs/P3_요구사항정의서_PC.md FR-323, docs/P3_설계서_PC.md 3.2절 */
(function (root) {
  'use strict';
  var ns = root.MyLearner = root.MyLearner || {};
  var NAME = 'mylearner', VERSION = 1, STORES = ['courses', 'backups', 'backup_text'];

  function req(r) { return new Promise(function (ok, bad) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { bad(r.error); }; }); }

  function open() {
    return new Promise(function (resolve) {
      var idb;
      try { idb = root.indexedDB; } catch (e) { idb = null; }
      if (!idb) { resolve(null); return; }
      var r;
      try { r = idb.open(NAME, VERSION); } catch (e) { resolve(null); return; }
      r.onupgradeneeded = function () { STORES.forEach(function (s) { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); }); };
      r.onsuccess = function () { resolve(wrap(r.result)); };
      r.onerror = function () { resolve(null); };
      r.onblocked = function () { resolve(null); };
    });
  }
  function wrap(db) {
    function tx(store, mode) { return db.transaction(store, mode).objectStore(store); }
    return {
      get: function (s, k) { return req(tx(s, 'readonly').get(k)); },
      put: function (s, k, v) {
        return new Promise(function (ok, bad) {
          var t = db.transaction(s, 'readwrite');
          t.objectStore(s).put(v, k);
          t.oncomplete = function () { ok(); };
          t.onerror = function () { bad(t.error); };
          t.onabort = function () { bad(t.error || new Error('IndexedDB 쓰기 중단')); };
        });
      },
      keys: function (s) { return req(tx(s, 'readonly').getAllKeys()).then(function (ks) { return ks.map(String); }); },
      del: function (s, k) {
        return new Promise(function (ok, bad) {
          var t = db.transaction(s, 'readwrite');
          t.objectStore(s).delete(k);
          t.oncomplete = function () { ok(); };
          t.onerror = function () { bad(t.error); };
        });
      }
    };
  }

  ns.storeIdb = { open: open };
})(typeof self !== 'undefined' ? self : this);
