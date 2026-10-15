/* MyLearner web/core/markdown.js — 마크다운 부분집합 → 안전한 HTML. MWL mwl/content/markdown.py(MiddlewareLearner@e55b9c0)를 JS 로 옮겼다.
 * 문법·출력은 MWL 과 같다(135과 대조 — scripts/check_mwl_real.py). 다른 점은 XSS 대책뿐이다(BRIEF 5.3-4):
 *   속성값을 모두 이스케이프, 링크는 http(s)·# 만, 그림은 호출자가 준 data:image 만, 그림·링크 태그는 자리표로 감싸
 *   굵게·기울임 정규식이 속성을 건드리지 못하게, 인용·목록 깊이 상한.
 * Python 과 같게: 줄 나눔(str.splitlines), 공백(str.isspace), \d = \p{Nd}, \w = [\p{L}\p{N}_].
 * 입력: 마크다운 글, {lessonRef(id) → 주소|null, image(src) → data URL|null} / 출력: MyLearner.markdown.render / 트리거: (Phase 3) 강의·실습·드릴 화면
 * 문서: docs/P2_요구사항정의서_Core.md FR-250~253, docs/P2_설계서_Core.md 3.6절 */
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
  var STRIP = new RegExp('^' + WS + '+|' + WS + '+$', 'gu'), LSTRIP = new RegExp('^' + WS + '+', 'u');
  var LINE_BREAK = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/;
  var HEADING = new RegExp('^(#{1,6})' + WS + '+(.*?)' + WS + '*#*' + WS + '*$', 'u');
  var UL = new RegExp('^(' + WS + '*)[-*]' + WS + '+(.*)$', 'u');
  var OL = new RegExp('^(' + WS + '*)\\p{Nd}+\\.' + WS + '+(.*)$', 'u');
  var HR = new RegExp('^-{3,}' + WS + '*$', 'u');
  var TABLE_SEP = new RegExp('^\\|?' + WS + '*:?-{3,}:?' + WS + '*(\\|' + WS + '*:?-{3,}:?' + WS + '*)*\\|?' + WS + '*$', 'u');
  var CODE_SPAN = /`([^`]+)`/gu;
  var BOLD = /\*\*(.+?)\*\*/gu;
  var ITALIC = /(?<![*\p{L}\p{N}_])\*(?!\*)([^*\n]+?)\*(?!\*)/gu;
  var IMG = new RegExp('!\\[([^\\]]*)\\]\\(([^)' + PYWS + ']+)\\)', 'gu');
  var LINK = new RegExp('\\[([^\\]]+)\\]\\(([^)' + PYWS + ']+)\\)', 'gu');
  var PLACE = /\uE000(\d+)\uE001/g;
  var DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

  function strip(s) { return s.replace(STRIP, ''); }
  function lstrip(s) { return s.replace(LSTRIP, ''); }
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

  function codeSpan(c, opts) {
    var code = '<code>' + escText(c) + '</code>';
    if (opts.lessonRef && ITEM.test(c)) {
      var href = opts.lessonRef(c);
      if (safeHref(href)) return '<a class="ref" href="' + escAttr(href) + '">' + code + '</a>';
    }
    return code;
  }
  function inlineText(raw, opts) {
    var tokens = [];
    function ph(html) { tokens.push(html); return '\uE000' + (tokens.length - 1) + '\uE001'; }
    var s = escText(raw);
    s = s.replace(IMG, function (m, alt, src) {
      var data = opts.image ? opts.image(unescText(src)) : null;
      if (typeof data === 'string' && DATA_IMAGE.test(data)) return ph('<img src="' + escAttr(data) + '" alt="' + quotes(alt) + '">');
      return ph('<span class="img-missing">[그림: ' + alt + ']</span>');
    });
    s = s.replace(LINK, function (m, label, href) {
      if (!safeHref(unescText(href))) return label;
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
        var lang = strip(strip(line).slice(3));
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
      if ((m = HEADING.exec(line))) { out.push('<h' + m[1].length + '>' + inline(m[2], opts) + '</h' + m[1].length + '>'); i++; continue; }
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
      while (i < n && strip(lines[i]) && lstrip(lines[i]).indexOf('```') !== 0 && !HEADING.test(lines[i]) && !HR.test(lines[i]) &&
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

  return { render: render, splitLines: splitLines, strip: strip };
});
