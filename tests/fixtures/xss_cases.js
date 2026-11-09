// 렌더러 XSS 사례 모음(FR-252·253). Node 시험(tests/unit/js/xss.test.js)과 실제 Chromium(tests/ui/render_check.html)이 함께 읽는다.
// 실행되면 window.__xss 가 1 이 되는 꼴로 쓴다. opts: 'badRef'(강의 참조 함수가 위험한 주소를 준다)·'badImage'·'goodImage'.
// 문서: docs/P2_설계서_Core.md 3.6절
// fuzz(seed, n): 같은 시드면 같은 무작위 글 n 가지 {name, md, opts} — 마크다운 기호·XSS 조각·자리표·공백·줄 나눔 섞기(독립 점검 ② '시험 빈틈')
(function (root, factory) {
  var cases = factory();
  cases.fuzz = fuzz;
  if (typeof module === 'object' && module.exports) module.exports = cases; else root.XSS_CASES = cases;
  function fuzz(seed, n) {
    'use strict';
    var a = (seed >>> 0) || 1;
    function r() {   // mulberry32(tests/unit/js/helpers.js 와 같다)
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    function pick(arr) { return arr[Math.floor(r() * arr.length)]; }
    var T = ['[', ']', '(', ')', '![', '](', '*', '**', '`', '```', '#', '# ', '> ', '- ', '1. ', '|', '|---|', '---', ' ', '  ', '\t', '\n', '\n\n',
      '\u3000', '\u00a0', '\u2028', '\u0085', '\uE000', '\uE001', '0', '&', '&amp;', '&lt;', '&#x6A;', '"', "'", '<', '>', '=', '/', ':', '\\',
      'a', 'x', 'A1-1', 'http://x.example/', 'https://y.example/?q="a"', '#frag', 'javascript:window.__xss=1', 'data:text/html,<script>window.__xss=1</script>',
      '<script>window.__xss=1</script>', '<img src=x onerror=window.__xss=1>', '" onmouseover="window.__xss=1', "' onfocus='window.__xss=1",
      '<svg onload=window.__xss=1>', 'fig.png', 'ref', 'img-missing', 'language-', ' hidden', '\ud83d\ude00', '\ud800'];
    var OPTS = ['', '', 'badRef', 'badImage', 'goodImage'], out = [];
    for (var k = 0; k < n; k++) {
      var md = '', len = 1 + Math.floor(r() * 24);
      for (var j = 0; j < len; j++) md += pick(T);
      out.push({ name: 'fuzz-' + seed + '-' + k, md: md, opts: pick(OPTS) || undefined });
    }
    return out;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var J = 'javascript:window.__xss=1';
  return [
    { name: 'img-onerror-in-alt', md: '![x" onerror="window.__xss=1](y.png)' },
    { name: 'img-onerror-in-alt-single', md: "![x' onerror='window.__xss=1](y.png)" },
    { name: 'img-src-quote', md: '![x](y.png"onerror="window.__xss=1)' },
    { name: 'img-good-with-quote-alt', md: '![a"b](fig.png)', opts: 'goodImage' },
    { name: 'img-resolver-js', md: '![a](fig.png)', opts: 'badImage' },
    { name: 'link-js', md: '[a](' + J + ')' },
    { name: 'link-js-case', md: '[a](JaVaScRiPt:window.__xss=1)' },
    { name: 'link-js-entity', md: '[a](&#x6A;avascript:window.__xss=1)' },
    { name: 'link-js-entity-dec', md: '[a](&#106;avascript:window.__xss=1)' },
    { name: 'link-js-ctrl', md: '[a](java\u0001script:window.__xss=1)' },
    { name: 'link-js-tab-like', md: '[a](java&Tab;script:window.__xss=1)' },
    { name: 'link-vbscript', md: '[a](vbscript:msgbox(1))' },
    { name: 'link-data', md: '[a](data:text/html;base64,PHNjcmlwdD53aW5kb3cuX194c3M9MTwvc2NyaXB0Pg==)' },
    { name: 'link-protocol-relative', md: '[a](//evil.example/x)' },
    { name: 'link-https-quote', md: '[a](https://x.example"onmouseover="window.__xss=1)' },
    { name: 'link-https-apos', md: "[a](https://x.example'onmouseover='window.__xss=1)" },
    { name: 'link-hash-quote', md: '[a](#"onclick="window.__xss=1)' },
    { name: 'link-https-lt', md: '[a](https://x.example/?q=<script>window.__xss=1</script>)' },
    { name: 'link-italic-in-href', md: '[t](https://x.example/*a*b*) and *c*' },
    { name: 'link-bold-in-href', md: '[t](https://x.example/**a**)' },
    { name: 'link-nested-img-js', md: '[![x](y.png)](' + J + ')' },
    { name: 'link-text-script', md: '[<script>window.__xss=1</script>](https://x.example)' },
    { name: 'bold-around-js-link', md: '**[x](' + J + ')**' },
    { name: 'raw-script', md: '<script>window.__xss=1</script>' },
    { name: 'raw-img', md: '<img src=x onerror=window.__xss=1>' },
    { name: 'raw-svg', md: '<svg onload=window.__xss=1>' },
    { name: 'raw-iframe', md: '<iframe src="' + J + '"></iframe>' },
    { name: 'heading-img', md: '# <img src=x onerror=window.__xss=1>' },
    { name: 'table-cell-html', md: '| a |\n|---|\n| <b onmouseover=window.__xss=1>x</b> |' },
    { name: 'quote-html', md: '> <script>window.__xss=1</script>' },
    { name: 'list-html', md: '- <a href="' + J + '">x</a>' },
    { name: 'fence-lang-quote', md: '```" onmouseover="window.__xss=1\ncode\n```' },
    { name: 'fence-lang-lt', md: '```<script>window.__xss=1</script>\ncode\n```' },
    { name: 'code-span-html', md: '`<img src=x onerror=window.__xss=1>`' },
    { name: 'placeholder-inject', md: 'a\uE0000\uE001b [x](https://x.example) \uE000' },
    { name: 'ref-bad', md: '`A1-1` 참고', opts: 'badRef' },
    { name: 'ref-good', md: '`A1-1` 참고 `NOT A REF`' },
    { name: 'null-char', md: 'a\u0000b <\u0000script>' },
    { name: 'deep-quote', md: new Array(3000).join('>') + ' x' },
    { name: 'deep-list', md: Array.from({ length: 600 }, function (_, i) { return new Array(i + 1).join(' ') + '- n' + i; }).join('\n') },
    { name: 'many-stars', md: new Array(20000).join('*') },
    { name: 'many-brackets', md: new Array(5000).join('[a](') }
  ];
});
