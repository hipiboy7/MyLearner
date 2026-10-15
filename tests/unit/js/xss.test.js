// 등급 A — 렌더러 XSS 사례 모음(tests/fixtures/xss_cases.js)을 출력 허용 목록(html_allow.js)으로 본다(FR-252·253). 시험 먼저 2026-10-15.
// 같은 모음을 실제 Chromium 이 innerHTML 로 넣고 실행 여부를 본다(scripts/render_smoke.py).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { core, ROOT } = require('./helpers');
const Mk = core('markdown');
const allow = require('./html_allow');
const CASES = require(path.join(ROOT, 'tests', 'fixtures', 'xss_cases.js'));

const IMG = 'data:image/png;base64,iVBORw0KGgo=';
const OPTS = { badRef: { lessonRef: () => 'javascript:window.__xss=1' }, badImage: { image: () => 'javascript:window.__xss=1' },
  goodImage: { image: () => IMG } };

test('XSS 사례 ' + CASES.length + '가지 — 허용된 태그·속성·주소만 나온다', () => {
  assert.ok(CASES.length >= 40);
  for (const c of CASES) {
    const html = Mk.render(c.md, OPTS[c.opts] || { lessonRef: (id) => '#/learn/mwl/' + id });
    assert.deepEqual(allow.check(html), [], c.name + ': ' + html.slice(0, 200));
  }
});

test('허용 목록 검사기 스스로 — 나쁜 출력을 잡는다(음성 시험)', () => {
  for (const bad of ['<script>x</script>', '<img src="x" onerror="y">', '<a href="javascript:x">a</a>', '<p onclick="x">a</p>', '<p>a < b</p>',
    '<img src="data:image/svg+xml;base64,AA==" alt="">', '<a href="&#106;avascript:x">a</a>', '<span class="evil">x</span>', '<iframe>'])
    assert.notDeepEqual(allow.check(bad), [], bad);
  assert.deepEqual(allow.check('<p><a class="ref" href="#/learn/mwl/A1-1"><code>A1-1</code></a> &amp; &lt;</p><hr>'), []);
});
