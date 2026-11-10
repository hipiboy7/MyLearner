/* MyLearningPlatform 안드로이드 앱 — 화면(web/)에 끼워 넣는 셸 스크립트(등급 C).
 * scripts/build_android.sh(mobile/android/tools/pack.py stage)가 APK 에 넣는 index.html **사본**의 스타일시트 바로 뒤에 한 줄로 넣는다. 원본 web/index.html 은 그대로다.
 * 앱(MainActivity)이 심은 다리 window.MyLearnerAndroid 로 ① MyLearner.platform(교환 파일 저장·공유 — 화면의 ui.download·설정의 공유 단추가 부른다)
 * ② 바깥 링크를 막거나 폰 브라우저로 넘기기 ③ 화면 바탕색 → 상태 표시줄 색 ④ <html data-shell="android"> 표식. 계산·저장은 하지 않는다
 * (기록 저장은 web/store/android.js 가 다리의 파일 KV 로 — 날짜 넘김은 앱이 onResume 에서 MyLearner.app.checkDay 를 부른다).
 * MWL mobile/android/shell/android-shell.js(MiddlewareLearner@e55b9c0)를 옮겨 고쳤다 — 저장 거울·blob 가로채기 대신 플랫폼 훅.
 * 문서: docs/P4_요구사항정의서_Mobile.md FR-404·405·421·462, docs/P4_설계서_Mobile.md 3.2절 */
(function () {
  'use strict';
  var root = document.documentElement;
  root.setAttribute('data-shell', 'android');
  var A = window.MyLearnerAndroid;            // 앱 밖(브라우저·시험)에서는 없다 — 그때는 아무것도 바꾸지 않는다
  if (!A) return;
  var ns = window.MyLearner = window.MyLearner || {};

  // ① 교환 파일 저장·공유 — 바이트는 base64 로 넘긴다(다리는 글만 받는다). 끝나면 앱이 done(kind, ok, msg) 를 부른다
  function b64(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  var waiting = { save: null, share: null };
  function start(kind, name, bytes, mime) {
    return new Promise(function (ok, bad) {
      var err = kind === 'save' ? A.saveFile(String(name), b64(bytes), String(mime || '')) : A.shareFile(String(name), b64(bytes), String(mime || ''));
      if (err) { bad(new Error(err)); return; }
      if (waiting[kind]) waiting[kind].ok(false);   // 앞의 것은 끝난 것으로
      waiting[kind] = { ok: ok, bad: bad };
    });
  }
  ns.platform = {
    kind: 'android',
    save: function (name, bytes, mime) { return start('save', name, bytes, mime); },
    share: function (name, bytes, mime) { return start('share', name, bytes, mime); },
    openExternal: function (url) { A.openExternal(String(url)); },
    done: function (kind, ok, msg) {
      var w = waiting[kind];
      waiting[kind] = null;
      if (!w) return;
      if (ok || msg === '취소') w.ok(!!ok); else w.bad(new Error(msg || '실패'));
    },
    info: function () { try { return JSON.parse(A.info()); } catch (e) { return {}; } }
  };

  // ② 바깥 링크 — 앱 안에서 열지 않는다(주소창이 없어 돌아올 길이 없다). http·https 는 앱이 묻고 폰 브라우저로, 그 밖은 막는다
  // 돌려주는 값: null = 그대로 둔다(이 앱 주소·#…) · 'block' = 막는다 · 그 밖 = 브라우저로 넘길 주소
  function decide(href) {
    if (!href) return null;
    var h = String(href).trim();
    if (h.charAt(0) === '#') return null;
    var u;
    try { u = new URL(h, location.href); } catch (e) { return null; }
    if (u.origin === location.origin) return null;
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : 'block';
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target, a = t && t.closest ? t.closest('a[href]') : null;
    if (!a) return;
    var r = decide(a.getAttribute('href'));
    if (r === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (r !== 'block') A.openExternal(r);
  }, true);
  var open0 = window.open;
  window.open = function (u) {
    var r = decide(u);
    if (r !== null) { if (r !== 'block') A.openExternal(r); return null; }
    return open0 ? open0.apply(window, arguments) : null;
  };
  ns.shellDecide = decide;                    // 시험용(e2e)으로만 드러낸다

  // ③ 바탕색 → 상태 표시줄·내비게이션 막대. 설정 → 화면의 밝기가 휴대폰 설정과 달라도 막대가 화면과 같은 색이 된다
  var last = '';
  function bars() {
    if (!document.body) return;
    var c = getComputedStyle(document.body).backgroundColor;
    if (c && c !== last) { last = c; A.setBars(c); }
  }
  document.addEventListener('DOMContentLoaded', bars);
  new MutationObserver(bars).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', bars); else if (mq.addListener) mq.addListener(bars);
  }
})();
