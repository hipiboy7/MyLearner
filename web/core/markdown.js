/* MyLearner web/core/markdown.js — 마크다운 부분집합 → 안전한 HTML. MWL mwl/content/markdown.py(MiddlewareLearner@e55b9c0)를 JS 로 옮겼다.
 * 문법·출력은 MWL 과 같다(135과 대조 — scripts/check_mwl_real.py). 다른 점은 XSS 대책뿐이다(BRIEF 5.3-4):
 *   속성값을 모두 이스케이프, 링크는 http(s)·# 만, 그림은 호출자가 준 data:image 만, 그림·링크 태그는 자리표로 감싸
 *   굵게·기울임 정규식이 속성을 건드리지 못하게, 인용·목록 깊이 상한, 펜스 언어는 첫 낱말만(class 하나).
 * 시간: 입력 길이에 선형이다. MWL 정규식 가운데 되짚기가 겹치는 것(strip 의 \s+$, 제목, 표 구분 줄, 그림·링크)은
 *   같은 결과를 내는 손 코드·겹치지 않는 정규식으로 바꿨다(독립 점검 ② — 남이 만든 과정 파일 하나로 화면이 멈추지 않게).
 * Python 과 같게: 줄 나눔(str.splitlines), 공백(str.isspace), \d = \p{Nd}, \w = [\p{L}\p{N}_].
 * 입력: 마크다운 글, {lessonRef(id) → 주소|null, image(src) → data URL|null, allowLink(주소) → bool(판 설정 — 막기만)} / 출력: MyLearner.markdown.render
 * 트리거: 강의·실습·드릴 화면(web/app/views.js)
 * 문서: docs/P2_요구사항정의서_Core.md FR-250~253, docs/P2_설계서_Core.md 3.6절, docs/P3_설계서_PC.md 2절(allowLink) */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.markdown = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants');
  var ITEM = new RegExp(C.SHARED.ITEM_ID_RE);
  var PYWS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
  var WS = '[' + PYWS + ']';
  var WS_TABLE = (function () {   // 글자 코드 → 공백인가(WS 와 같은 집합 — 가장 큰 공백이 U+3000)
    var re = new RegExp('^' + WS + '$', 'u'), t = new Uint8Array(0x3001);
    for (var c = 0; c < t.length; c++) t[c] = re.test(String.fromCharCode(c)) ? 1 : 0;
    return t;
  })();
  var LINE_BREAK = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/;
  var UL = new RegExp('^(' + WS + '*)[-*]' + WS + '+(.*)$', 'u');
  var OL = new RegExp('^(' + WS + '*)\\p{Nd}+\\.' + WS + '+(.*)$', 'u');
  var HR = new RegExp('^-{3,}' + WS + '*$', 'u');
  // MWL ^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$ 와 같은 언어 — 끝의 \s*\|?\s* 가 \s*\s* 로 겹쳐 2제곱이던 것을 (\|\s*)? 로
  var TABLE_SEP = new RegExp('^\\|?' + WS + '*:?-{3,}:?(?:' + WS + '*\\|' + WS + '*:?-{3,}:?)*' + WS + '*(?:\\|' + WS + '*)?$', 'u');
  var CODE_SPAN = /`([^`]+)`/gu;
  var BOLD = /\*\*(.+?)\*\*/gu;
  var ITALIC = /(?<![*\p{L}\p{N}_])\*(?!\*)([^*\n]+?)\*(?!\*)/gu;
  var PLACE = /\uE000(\d+)\uE001/g;
  var DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

  function isWS(c) { return c < 0x3001 && WS_TABLE[c] === 1; }   // c = 글자 코드(넘으면 NaN → 아니다)
  function strip(s) {   // Python str.strip()
    var a = 0, b = s.length;
    while (a < b && isWS(s.charCodeAt(a))) a++;
    while (b > a && isWS(s.charCodeAt(b - 1))) b--;
    return s.slice(a, b);
  }
  function lstrip(s) { var a = 0; while (a < s.length && isWS(s.charCodeAt(a))) a++; return s.slice(a); }
  // MWL ^(#{1,6})\s+(.*?)\s*#*\s*$ 와 같은 결과 → [수준, 글] 또는 null. # 다음이 공백이어야 하고(7개 이상이면 아니다),
  // 글은 # 뒤 공백을 모두 뗀 나머지에서 끝의 (공백·#·공백)을 뗀 것이다 — 게으른 (.*?) 가 가장 짧게 끝나는 곳
  function heading(line) {
    var k = 0;
    while (k < line.length && line.charCodeAt(k) === 35) k++;
    if (k < 1 || k > 6 || !isWS(line.charCodeAt(k))) return null;
    var rest = lstrip(line.slice(k)), e = rest.length;
    while (e > 0 && isWS(rest.charCodeAt(e - 1))) e--;
    while (e > 0 && rest.charCodeAt(e - 1) === 35) e--;
    while (e > 0 && isWS(rest.charCodeAt(e - 1))) e--;
    return [k, rest.slice(0, e)];
  }
  function splitLines(text) {   // Python str.splitlines()
    if (text === '') return [];
    var parts = text.split(LINE_BREAK);
    if (parts[parts.length - 1] === '') parts.pop();
    return parts;
  }
  function escText(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function quotes(s) { return s.replace(/"/g, '&quot;').replace(/'/g, '&#x27;'); }   // escText 를 지난 글 → 속성값
  function escAttr(s) { return quotes(escText(s)); }
  function unescText(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
  function safeHref(u) { return typeof u === 'string' && /^(https?:\/\/|#)/i.test(u) && !/[\u0000-\u001f\u007f]/.test(u); }
  // 판 설정의 링크 행선지(P3 FR-312) — 안전 검사를 통과한 주소만 allowLink 에 묻는다. allowLink 는 막기만 할 수 있다
  function allowed(u, opts) { return safeHref(u) && (!opts.allowLink || opts.allowLink(u) === true); }

  function codeSpan(c, opts) {
    var code = '<code>' + escText(c) + '</code>';
    if (opts.lessonRef && ITEM.test(c)) {
      var href = opts.lessonRef(c);
      if (allowed(href, opts)) return '<a class="ref" href="' + escAttr(href) + '">' + code + '</a>';
    }
    return code;
  }
  // 그림·링크 — MWL 정규식 !\[([^\]]*)\]\(([^)\s]+)\) · \[([^\]]+)\]\(([^)\s]+)\) 의 전역 바꾸기와 같은 결과.
  // 정규식은 여는 괄호마다 닫는 글자까지 다시 훑어 여는 괄호가 많으면 2제곱이다 → 다음 ']' 와 다음 ')'·공백 위치를 기억해 한 번만 훑는다.
  // 각 반복 뒤의 글자는 그 반복이 받지 않는 글자라 짝이 하나로 정해진다. 바꾼 뒤에는 그 끝 다음부터 찾는다(정규식 g 와 같다)
  function replaceLinks(s, isImg, fn) {
    var n = s.length, out = [], last = 0, q = -1, r = -1;
    for (var p = 0; p < n; p++) {
      if (isImg ? s.charCodeAt(p) !== 33 || s.charCodeAt(p + 1) !== 91 : s.charCodeAt(p) !== 91) continue;
      var a = p + (isImg ? 2 : 1);                                   // 대체 글·링크 글이 시작하는 곳
      if (q < a) { q = s.indexOf(']', a); if (q < 0) break; }       // 뒤에 ']' 가 없으면 짝도 없다
      if ((!isImg && q === a) || s.charCodeAt(q + 1) !== 40) continue;
      if (r < q + 2) { r = q + 2; while (r < n && s.charCodeAt(r) !== 41 && !isWS(s.charCodeAt(r))) r++; }
      if (r === q + 2 || r >= n || s.charCodeAt(r) !== 41) continue;
      out.push(s.slice(last, p), fn(s.slice(a, q), s.slice(q + 2, r)));
      last = r + 1; p = r;
    }
    out.push(s.slice(last));
    return out.join('');
  }
  function inlineText(raw, opts) {
    var tokens = [];
    function ph(html) { tokens.push(html); return '\uE000' + (tokens.length - 1) + '\uE001'; }
    var s = escText(raw);
    s = replaceLinks(s, true, function (alt, src) {
      var data = opts.image ? opts.image(unescText(src)) : null;
      if (typeof data === 'string' && DATA_IMAGE.test(data)) return ph('<img src="' + escAttr(data) + '" alt="' + quotes(alt) + '">');
      return ph('<span class="img-missing">[그림: ' + alt + ']</span>');
    });
    s = replaceLinks(s, false, function (label, href) {
      if (!allowed(unescText(href), opts)) return label;
      return ph('<a href="' + quotes(href) + '">') + label + ph('</a>');
    });
    s = s.replace(BOLD, '<strong>$1</strong>').replace(ITALIC, '<em>$1</em>');
    return s.replace(PLACE, function (m, i) { return tokens[Number(i)]; });
  }
  function inline(text, opts) {
    var parts = [], pos = 0, m, re = new RegExp(CODE_SPAN.source, 'gu');   // 호출자 함수가 render 를 다시 불러도 엉키지 않게 따로 둔다
    while ((m = re.exec(text))) {
      parts.push(inlineText(text.slice(pos, m.index), opts), codeSpan(m[1], opts));
      pos = m.index + m[0].length;
    }
    parts.push(inlineText(text.slice(pos), opts));
    return parts.join('');
  }

  function isTableStart(lines, i) { return i + 1 < lines.length && lstrip(lines[i]).indexOf('|') === 0 && TABLE_SEP.test(strip(lines[i + 1])); }
  function splitRow(line) {
    var s = strip(line);
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    return s.split('|').map(strip);
  }
  function renderList(items, opts, depth) {
    if (!items.length) return '';
    var base = items[0][0], tag = items[0][1] ? 'ol' : 'ul', out = ['<' + tag + '>'], i = 0;
    while (i < items.length) {
      var children = [], j = i + 1;
      while (depth < C.RENDER_MAX_DEPTH && j < items.length && items[j][0] > base) { children.push(items[j]); j++; }
      if (children.length) out.push('<li>' + inline(items[i][2], opts) + '\n' + renderList(children, opts, depth + 1) + '\n</li>');
      else out.push('<li>' + inline(items[i][2], opts) + '</li>');
      i = j;
    }
    out.push('</' + tag + '>');
    return out.join('\n');
  }

  function blocks(text, opts, depth) {
    var lines = splitLines(text), out = [], i = 0, n = lines.length, buf, m;
    while (i < n) {
      var line = lines[i];
      if (!strip(line)) { i++; continue; }
      if (lstrip(line).indexOf('```') === 0) {   // 펜스 코드
        var lang = strip(strip(line).slice(3)), sp = 0;
        while (sp < lang.length && !isWS(lang.charCodeAt(sp))) sp++;
        lang = lang.slice(0, sp);   // 첫 낱말만(CommonMark 처럼) — MWL 은 줄 전체라 'a ref hidden' 이 class 여럿이 됐다(독립 점검 ② F4)
        i++; buf = [];
        while (i < n && strip(lines[i]).indexOf('```') !== 0) { buf.push(lines[i]); i++; }
        i++;
        out.push('<pre><code' + (lang ? ' class="language-' + escAttr(lang) + '"' : '') + '>' + escText(buf.join('\n')) + '\n</code></pre>');
        continue;
      }
      if (isTableStart(lines, i)) {   // 표
        var header = splitRow(lines[i]), rows = [];
        i += 2;
        while (i < n && lstrip(lines[i]).indexOf('|') === 0) { rows.push(splitRow(lines[i])); i++; }
        var thead = '<thead><tr>' + header.map(function (c) { return '<th>' + inline(c, opts) + '</th>'; }).join('') + '</tr></thead>';
        var body = rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c, opts) + '</td>'; }).join('') + '</tr>'; }).join('\n');
        out.push('<table>\n' + thead + '\n<tbody>\n' + body + '\n</tbody>\n</table>');
        continue;
      }
      if ((m = heading(line))) { out.push('<h' + m[0] + '>' + inline(m[1], opts) + '</h' + m[0] + '>'); i++; continue; }
      if (HR.test(line)) { out.push('<hr>'); i++; continue; }
      if (lstrip(line).indexOf('>') === 0) {   // 인용
        buf = [];
        var rawQuote = [];
        while (i < n && lstrip(lines[i]).indexOf('>') === 0) {
          var s = lstrip(lines[i]).slice(1);
          buf.push(s.charAt(0) === ' ' ? s.slice(1) : s); rawQuote.push(strip(lines[i])); i++;
        }
        if (depth >= C.RENDER_MAX_DEPTH) out.push('<p>' + inline(rawQuote.join('\n'), opts) + '</p>');   // 더 파고들지 않고 글로
        else out.push('<blockquote>' + blocks(buf.join('\n'), opts, depth + 1) + '</blockquote>');
        continue;
      }
      if (UL.test(line) || OL.test(line)) {   // 목록
        var items = [];
        while (i < n && strip(lines[i])) {
          var mu = UL.exec(lines[i]), mo = OL.exec(lines[i]), mm = mu || mo;
          if (mm) items.push([mm[1].length, !!mo && !mu, strip(mm[2])]);
          else if (items.length && lines[i].indexOf('  ') === 0) items[items.length - 1][2] += ' ' + strip(lines[i]);
          else break;
          i++;
        }
        out.push(renderList(items, opts, 0));
        continue;
      }
      buf = [];   // 문단
      while (i < n && strip(lines[i]) && lstrip(lines[i]).indexOf('```') !== 0 && !heading(lines[i]) && !HR.test(lines[i]) &&
             lstrip(lines[i]).indexOf('>') !== 0 && !UL.test(lines[i]) && !OL.test(lines[i]) && !isTableStart(lines, i)) {
        buf.push(strip(lines[i])); i++;
      }
      if (!buf.length) { buf.push(strip(lines[i])); i++; }   // 방어(MWL 에서는 닿지 않는 길) — 줄을 버리지 않는다
      out.push('<p>' + inline(buf.join('\n'), opts) + '</p>');
    }
    return out.join('\n');
  }

  function render(text, opts) {
    return blocks(String(text === undefined || text === null ? '' : text).replace(/[\uE000\uE001]/g, '\uFFFD'), opts || {}, 0);
  }

  // internals 는 시험이 MWL 정규식(옛 꼴)과 같은 결과인지 대조하는 데만 쓴다(tests/unit/js/markdown.test.js '선형 시간')
  return { render: render, splitLines: splitLines, strip: strip,
    internals: { lstrip: lstrip, heading: heading, isTableSep: function (s) { return TABLE_SEP.test(s); }, replaceLinks: replaceLinks } };
});
