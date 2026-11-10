/* MyLearner web/store/android.js — 안드로이드 저장 어댑터(등급 B): 앱(MainActivity)이 심은 다리 window.MyLearnerAndroid 의 파일 KV
 * (kvGet·kvPut·kvDel·kvList — 자바 Kv.java, 쓰기는 임시 파일 → fsync → 이름 바꾸기)를 localStorage 꼴(ls)과 KV 꼴(kv)로 감싸
 * 브라우저 어댑터(store/browser.js)를 그대로 쓴다 — 기록은 같은 달별 키, 백업·사용자 과정도 같은 규칙. 다리 호출이 돌아오면 이미 디스크에 있다
 * (WebView localStorage 는 몇 초 모아 적어 강제 종료 때 마지막 기록이 사라졌다 — MWL 6.6).
 * 입력: {bridge, now() → Date, random(n) → 바이트} / 출력: MyLearner.storeAndroid.create(…) / 트리거: app/state.js(다리가 있으면 먼저)
 * 문서: docs/P4_요구사항정의서_Mobile.md FR-410~412, docs/P4_설계서_Mobile.md 3.3절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name, file) { var m = node ? require(file) : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.storeAndroid = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var SB = dep('storeBrowser', './browser.js');

  function lsName(key) { return 'ls.' + key; }
  function kvName(store, key) { return 'kv.' + store + '.' + key; }

  function create(env) {
    var br = env && env.bridge;
    if (!br || typeof br.kvGet !== 'function' || typeof br.kvPut !== 'function') throw new Error('안드로이드 다리(MyLearnerAndroid)가 없습니다');
    function put(name, value) {
      var r = br.kvPut(name, value);
      if (r) { var e = new Error('앱 저장소에 쓰지 못했습니다: ' + r); e.name = 'AndroidStoreError'; throw e; }
    }
    function names(prefix) {
      var a;
      try { a = JSON.parse(br.kvList(prefix) || '[]'); } catch (e) { a = []; }
      return Array.isArray(a) ? a.filter(function (n) { return typeof n === 'string' && n.indexOf(prefix) === 0; }) : [];
    }
    // ls 이름 목록은 한 번 읽고 이 감싼 꼴이 쓰고 지울 때 고친다 — 앱 안 WebView 는 하나라 이 파일들을 쓰는 곳은 여기뿐이다
    var keys = names('ls.').map(function (n) { return n.slice(3); }).sort();
    function remember(k) { if (keys.indexOf(k) < 0) { keys.push(k); keys.sort(); } }
    function forget(k) { var i = keys.indexOf(k); if (i >= 0) keys.splice(i, 1); }
    var ls = {
      get length() { return keys.length; },
      key: function (i) { return i >= 0 && i < keys.length ? keys[i] : null; },
      getItem: function (k) { var v = br.kvGet(lsName(k)); return typeof v === 'string' ? v : null; },
      setItem: function (k, v) { put(lsName(k), String(v)); remember(String(k)); },
      removeItem: function (k) { br.kvDel(lsName(k)); forget(String(k)); }
    };
    var kv = {
      get: function (store, key) {
        return Promise.resolve().then(function () { var v = br.kvGet(kvName(store, key)); return typeof v === 'string' ? JSON.parse(v) : undefined; });
      },
      put: function (store, key, value) { return Promise.resolve().then(function () { put(kvName(store, key), JSON.stringify(value)); }); },
      keys: function (store) {
        return Promise.resolve().then(function () { var p = 'kv.' + store + '.'; return names(p).map(function (n) { return n.slice(p.length); }); });
      },
      del: function (store, key) { return Promise.resolve().then(function () { br.kvDel(kvName(store, key)); }); }
    };
    var st = SB.create({ ls: ls, kv: kv, now: env.now, random: env.random });
    var init0 = st.init;
    st.kind = 'android';
    // 앱 안 WebView 는 하나뿐이라 쓰는 곳이 하나다 — 화면은 탭 임대를 보지 않는다. 강제 종료 뒤엔 pagehide 가 없어 임대가 남고,
    // 다시 켠 앱이 몇 초 동안 읽기 전용이 됐다(2026-11-10 에뮬레이터 캡처 — 트러블슈팅 T-014)
    st.singleWriter = true;
    st.init = function () {
      return init0().then(function (info) { return { dev: info.dev, where: '이 폰의 앱 저장소(앱을 지우면 함께 지워집니다)' }; });
    };
    return st;
  }

  return { create: create, lsName: lsName, kvName: kvName };
});
