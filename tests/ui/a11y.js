// 접근성 자동 검사(NFR-303, 등급 C) — 화면 스모크가 DevTools 평가로 넣는다. npm(axe-core)을 받지 않고 규칙 몇 가지를 직접 본다:
// html lang, 이름 없는 단추·링크·입력·진행 막대·그림, 제목(#app 안 h1 하나·단계 건너뛰기 없음), 양수 tabindex, 중복 id, 본문 글자 대비(WCAG AA 4.5:1, 큰 글 3:1).
// 입력: 지금 화면 / 출력: window.__a11y() → 위반 글 목록 / 트리거: tests/ui/app_check.js / 문서: docs/P3_설계서_PC.md 6절(NFR-303)
(function () {
  'use strict';
  function visible(el) {
    if (el.closest('[hidden]')) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && (el.getClientRects().length > 0);
  }
  function text(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function labelOf(el) {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((id) => text(document.getElementById(id) || document.createElement('i'))).join(' ').trim();
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && text(l)) return text(l); }
    const wrap = el.closest('label');
    if (wrap && text(wrap)) return text(wrap);
    if (el.tagName === 'IMG') return el.getAttribute('alt');
    if (/^(BUTTON|A|SUMMARY)$/.test(el.tagName)) return text(el) || el.getAttribute('title') || '';
    return el.getAttribute('title') || '';
  }
  function rgba(s) {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function blend(top, bottom) { const a = top.a; return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 }; }
  function bgOf(el) {
    const stack = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c && c.a > 0) stack.push(c); if (c && c.a >= 1) break; }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) out = blend(stack[i], out);
    return out;
  }
  function lum(c) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  window.__a11y = function () {
    const v = [];
    if (!document.documentElement.getAttribute('lang')) v.push('html lang 없음');
    const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=progressbar], svg[role=img], img';
    document.querySelectorAll(sel).forEach((el) => {
      if (el.type === 'file') { if (!labelOf(el)) v.push('이름 없는 파일 고르기'); return; }
      if (!visible(el)) return;
      if (!labelOf(el)) v.push('이름 없는 ' + el.tagName.toLowerCase() + (el.getAttribute('name') ? '[name=' + el.getAttribute('name') + ']' : '') + ' — ' + el.outerHTML.slice(0, 80));
    });
    const app = document.getElementById('app');
    const h1 = app.querySelectorAll('h1').length;
    if (h1 !== 1) v.push('#app 안 h1 이 ' + h1 + '개');
    let last = 1;
    app.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      if (!visible(h)) return;
      const n = Number(h.tagName[1]);
      if (n > last + 1) v.push('제목 단계 건너뜀: h' + last + ' → h' + n + ' "' + text(h).slice(0, 30) + '"');
      last = n;
    });
    document.querySelectorAll('[tabindex]').forEach((el) => { if (Number(el.getAttribute('tabindex')) > 0) v.push('양수 tabindex'); });
    const ids = {};
    document.querySelectorAll('[id]').forEach((el) => { ids[el.id] = (ids[el.id] || 0) + 1; });
    Object.keys(ids).forEach((k) => { if (ids[k] > 1) v.push('중복 id ' + k); });
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || seen.has(el) || el.closest('svg, script, style, [aria-hidden="true"]') || !visible(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (el.closest('button:disabled')) continue;
      const fg = rgba(cs.color); if (!fg) continue;
      const bg = bgOf(el), r = ratio(fg.a < 1 ? blend(fg, bg) : fg, bg);
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (r < need) v.push('글자 대비 ' + r.toFixed(2) + ' < ' + need + ' "' + text(el).slice(0, 30) + '" (' + cs.color + ' / ' + el.tagName.toLowerCase() + '.' + el.className + ')');
    }
    return Array.from(new Set(v)).slice(0, 40);
  };
})();
