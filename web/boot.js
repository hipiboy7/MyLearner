/* MyLearner web/boot.js — 화면 설정(밝기·글자 크기·줄 간격·본문 폭)을 그리기 전에 적용한다(FR-307). 값은 이 브라우저에만(app/util.js UI_KEYS).
 * MWL index.html 머리의 인라인 스크립트를 파일로 옮겼다 — CSP 'self' 는 인라인 스크립트를 막는다(docs/P3_설계서_PC.md 4절). */
(function (d) {
  'use strict';
  try {
    var u = JSON.parse(localStorage.getItem('mylearner.ui') || '{}') || {};
    ['theme', 'size', 'lh', 'width'].forEach(function (k) { if (typeof u[k] === 'string' && /^[a-z]{1,8}$/.test(u[k])) d.setAttribute('data-' + k, u[k]); });
  } catch (e) { /* 저장소를 못 읽어도 기본 화면으로 그린다 */ }
})(document.documentElement);
