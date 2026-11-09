// 등급 A — web/core/markdown.js (FR-250·251). MWL mwl/content/markdown.py(e55b9c0)가 그린 결과(tests/fixtures/mwl/markdown_parity.json, 39가지)와 같아야 한다.
// MWL tests/unit/test_markdown.py 의 사례도 옮겼다. 시험 먼저 2026-10-15.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { core, fixture, rng, pick } = require('./helpers');
const Mk = core('markdown');
const md = (t, o) => Mk.render(t, o);

test('MWL 렌더러와 같다 — 39가지(Python 줄 나눔·공백·\\d·\\w 차이까지)', () => {
  const cases = fixture('mwl/markdown_parity.json');
  assert.ok(cases.length >= 39);
  for (const c of cases) assert.equal(md(c.md), c.html, c.name);
});

test('MWL test_markdown.py 사례', () => {
  assert.equal(md('# 제목'), '<h1>제목</h1>');
  assert.equal(md('문장 하나\n둘째 줄'), '<p>문장 하나\n둘째 줄</p>');
  assert.equal(md('**굵게** *기울임* `코드`'), '<p><strong>굵게</strong> <em>기울임</em> <code>코드</code></p>');
  assert.equal(md('[링크](https://x.y/z)'), '<p><a href="https://x.y/z">링크</a></p>');
  assert.equal(md('<script>x</script>'), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
  assert.equal(md('```bash\necho <hi>\n```'), '<pre><code class="language-bash">echo &lt;hi&gt;\n</code></pre>');
  assert.equal(md('- a\n  - a1\n  - a2\n- b'), '<ul>\n<li>a\n<ul>\n<li>a1</li>\n<li>a2</li>\n</ul>\n</li>\n<li>b</li>\n</ul>');
  assert.equal(md('> 답: 정답'), '<blockquote><p>답: 정답</p></blockquote>');
  assert.equal(md('---'), '<hr>');
});

test('강의 참조 — 호출자가 주는 주소로(MWL linkify_lesson_refs 와 같은 결과)', () => {
  const ref = (id) => (/^[A-G]\d{1,2}-\d{1,2}$/.test(id) ? '#/learn/mwl/' + id : null);
  assert.equal(md('`A1-1` 과 `X` 와 `B2-10`', { lessonRef: ref }),
    '<p><a class="ref" href="#/learn/mwl/A1-1"><code>A1-1</code></a> 과 <code>X</code> 와 <a class="ref" href="#/learn/mwl/B2-10"><code>B2-10</code></a></p>');
  assert.equal(md('```\nA1-1\n```', { lessonRef: ref }), '<pre><code>A1-1\n</code></pre>', '펜스 코드는 참조가 아니다');
  assert.equal(md('`A1-1`', { lessonRef: () => 'javascript:alert(1)' }), '<p><code>A1-1</code></p>', '위험한 주소는 버린다');
  assert.equal(md('`a b`', { lessonRef: () => '#/x' }), '<p><code>a b</code></p>', 'ID 꼴이 아니면 묻지 않는다');
});

test('그림 — 과정 안의 그림(data:image)만, 없으면 대체 글', () => {
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(md('![그림](fig.png)', { image: (s) => (s === 'fig.png' ? img : null) }), '<p><img src="' + img + '" alt="그림"></p>');
  assert.equal(md('![그림](fig.png)'), '<p><span class="img-missing">[그림: 그림]</span></p>');
  assert.equal(md('![a"b](fig.png)', { image: () => img }), '<p><img src="' + img + '" alt="a&quot;b"></p>');
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://x.example/a.png', 'data:image/png;base64,"onerror="x'])
    assert.equal(md('![g](f.png)', { image: () => bad }), '<p><span class="img-missing">[그림: g]</span></p>', bad);
});

test('링크 — http(s)·# 만, 속성값 이스케이프, 나머지는 글만', () => {
  assert.equal(md('[a](javascript:alert(1))'), '<p>a)</p>', '주소는 첫 ) 에서 끝난다(MWL 과 같다)');
  assert.equal(md('[a](HTTPS://X.example)'), '<p><a href="HTTPS://X.example">a</a></p>');
  assert.equal(md('[a](https://x.example"onmouseover="y)'), '<p><a href="https://x.example&quot;onmouseover=&quot;y">a</a></p>');
  assert.equal(md("[a](#x'y)"), '<p><a href="#x&#x27;y">a</a></p>');
  assert.equal(md('[t](https://x.example/*a*b*) and *c*'), '<p><a href="https://x.example/*a*b*">t</a> and <em>c</em></p>');
  assert.equal(md('[a](https://x.example/?a=1&b=2)'), '<p><a href="https://x.example/?a=1&amp;b=2">a</a></p>');
  assert.equal(md('**[x](javascript:y)**'), '<p><strong>x</strong></p>');
});

test('펜스 언어는 MWL 처럼 class 에 넣되 따옴표까지 이스케이프한다', () => {
  assert.equal(md('```c++\nx\n```'), '<pre><code class="language-c++">x\n</code></pre>');
  assert.equal(md('```" onmouseover="x\ncode\n```'), '<pre><code class="language-&quot; onmouseover=&quot;x">code\n</code></pre>');
});

test('깊이 — 깊은 인용·목록은 16단까지만 파고든다', () => {
  const deep = md(new Array(3000).join('>') + ' x');
  assert.ok(deep.includes('x'));
  assert.ok((deep.match(/<blockquote>/g) || []).length <= 17);
  const list = md(Array.from({ length: 600 }, (_, i) => ' '.repeat(i) + '- n' + i).join('\n'));
  assert.ok(list.includes('n599'));
});

// 선형 시간(독립 점검 ②) — MWL 정규식(옛 꼴)을 대조 기준으로 두고, 바꾼 손 코드·정규식이 짧은 무작위 글에서 같은 결과인지 본다.
// 옛 꼴은 짧은 글에서는 빠르다. 긴 글에서 멈추던 꼴은 아래 '선형 시간 — 긴 글' 이 따로 잰다.
const PYWS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000', WS = '[' + PYWS + ']';
const OLD = {
  strip: new RegExp('^' + WS + '+|' + WS + '+$', 'gu'),
  lstrip: new RegExp('^' + WS + '+', 'u'),
  heading: new RegExp('^(#{1,6})' + WS + '+(.*?)' + WS + '*#*' + WS + '*$', 'u'),
  tableSep: new RegExp('^\\|?' + WS + '*:?-{3,}:?' + WS + '*(\\|' + WS + '*:?-{3,}:?' + WS + '*)*\\|?' + WS + '*$', 'u'),
  img: new RegExp('!\\[([^\\]]*)\\]\\(([^)' + PYWS + ']+)\\)', 'gu'),
  link: new RegExp('\\[([^\\]]+)\\]\\(([^)' + PYWS + ']+)\\)', 'gu'),
};
function randText(r, alphabet, max) { let t = ''; const n = Math.floor(r() * (max + 1)); for (let i = 0; i < n; i++) t += pick(r, alphabet); return t; }
const SPACES = [' ', '\t', '\u3000', '\xa0', '\x1c', '\u2009', '\uFEFF'];   // 마지막은 Python 에서 공백이 아니다

test('선형 시간 — 바꾼 strip·제목·표 구분 줄·그림·링크가 MWL 정규식과 같은 결과(무작위 2만 가지씩)', () => {
  const I = Mk.internals, r = rng(20261109);
  for (let k = 0; k < 20000; k++) {
    const t = randText(r, SPACES.concat(['a', '#', '\uD83D\uDE00']), 10);
    assert.equal(Mk.strip(t), t.replace(OLD.strip, ''), JSON.stringify(t));
    assert.equal(I.lstrip(t), t.replace(OLD.lstrip, ''), JSON.stringify(t));
    const h = randText(r, SPACES.concat(['#', '#', '#', 'a', 'b', '\uD83D\uDE00']), 14), m = OLD.heading.exec(h), got = I.heading(h);
    assert.deepEqual(got, m ? [m[1].length, m[2]] : null, JSON.stringify(h));
    const sep = randText(r, ['|', '-', '-', '-', ':', ' ', '\t', 'x'], 16);
    assert.equal(I.isTableSep(sep), OLD.tableSep.test(sep), JSON.stringify(sep));
    const l = randText(r, ['[', ']', '(', ')', '!', 'a', ' ', '\n', '\uE000'], 16), f = (x, y) => '<' + x + '|' + y + '>';
    assert.equal(I.replaceLinks(l, true, f), l.replace(OLD.img, (_, x, y) => f(x, y)), 'img ' + JSON.stringify(l));
    assert.equal(I.replaceLinks(l, false, f), l.replace(OLD.link, (_, x, y) => f(x, y)), 'link ' + JSON.stringify(l));
  }
});

test('선형 시간 — 긴 글(20만 자)도 꼴마다 1초 안에 끝난다(자식 프로세스, 멈추면 30초에 끊는다)', () => {
  // 옛 정규식에서: 제목 꼴은 3제곱(2만 자에서 10분 넘게), 나머지는 2제곱(2만 자에서 약 1초 → 20만 자에서 100초)
  const N = 200000;
  const cases = {
    '제목 뒤 공백': '# a' + ' '.repeat(N) + 'x',
    '글 사이 공백(strip)': 'a' + ' '.repeat(N) + 'b',
    '표 구분 줄 공백': '|a|\n|---' + ' '.repeat(N) + 'x',
    '여는 [': '['.repeat(N),
    '여는 ![': '!['.repeat(N / 2),
    '[a]( 반복': '[a]('.repeat(N / 4),
    '![a]( 반복': '![a]('.repeat(N / 5),
    '[a](x 반복': '[a](x'.repeat(N / 5),
    '별': '*'.repeat(N), '**a 반복': '**a '.repeat(N / 4), '` 반복': '`a'.repeat(N / 2),
    '목록 공백': '- ' + ' '.repeat(N) + 'x', '번호 숫자': '1'.repeat(N) + 'x', '가로줄 대시': '-'.repeat(N) + ' x',
  };
  const code = 'const Mk = require(' + JSON.stringify(require.resolve('../../../web/core/markdown.js')) + ');' +
    'const cases = JSON.parse(require("fs").readFileSync(0, "utf8")); const out = {};' +
    'for (const k of Object.keys(cases)) { process.stderr.write(k + "\\n"); const t = Date.now(); Mk.render(cases[k], {}); out[k] = Date.now() - t; }' +
    'process.stdout.write(JSON.stringify(out));';
  const res = spawnSync(process.execPath, ['-e', code], { input: JSON.stringify(cases), timeout: 30000, encoding: 'utf8', maxBuffer: 1 << 20 });
  const started = (res.stderr || '').trim().split('\n');
  assert.equal(res.status, 0, '끝나지 않음 — 마지막으로 시작한 꼴: ' + started[started.length - 1]);
  const ms = JSON.parse(res.stdout);
  for (const k of Object.keys(cases)) assert.ok(ms[k] < 1000, k + ' ' + ms[k] + 'ms');
});

test('자리표 글자를 원문에 넣어도 태그가 생기지 않는다', () => {
  assert.equal(md('a\uE0000\uE001b'), '<p>a\uFFFD0\uFFFDb</p>');
  assert.equal(md('[x](https://x.example) \uE0000\uE001'), '<p><a href="https://x.example">x</a> \uFFFD0\uFFFD</p>');
});
