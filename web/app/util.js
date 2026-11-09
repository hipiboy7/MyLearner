/* MyLearner web/app/util.js — 화면 도우미: 이스케이프·띠·타일·차트(인라인 SVG)·화면 설정. MWL web/app.js(MiddlewareLearner@e55b9c0)의
 * esc·banner·statTile·barPath·barChart·UI_OPTS 를 옮겼다. 차트는 외부 라이브러리 0, 색만으로 말하지 않는다(값·이름 글을 함께, BRIEF 5.4).
 * 인라인 style 속성을 쓰지 않는다(CSP) — 폭은 data-pct 로 두고 그린 뒤 applyPct 가 CSSOM 으로 넣는다(docs/P3_설계서_PC.md 4절).
 * 입력: 글·수 / 출력: MyLearner.ui / 트리거: app/*.js
 * 문서: docs/P3_요구사항정의서_PC.md FR-305·307·347, docs/P3_설계서_PC.md 5절 */
(function (root) {
  'use strict';
  var ns = root.MyLearner = root.MyLearner || {};
  var doc = root.document;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel) { return doc.querySelector(sel); }
  function banner(msg, kind) {
    var b = $('#banner');
    if (!b) return;
    if (!msg) { b.hidden = true; b.textContent = ''; return; }
    b.hidden = false; b.textContent = msg; b.className = 'banner ' + (kind || '');
  }
  function pct(n) { return Math.max(0, Math.min(100, Math.round(n))); }
  function bar(label, value, max) {
    var p = max ? pct(100 * value / max) : 0;
    return '<div class="progressbar" role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="' + esc(max) +
      '" aria-valuenow="' + esc(Math.min(value, max)) + '"><span data-pct="' + p + '"></span></div>';
  }
  function applyPct(rootEl) {
    var els = rootEl.querySelectorAll('[data-pct]');
    for (var i = 0; i < els.length; i++) els[i].style.width = pct(Number(els[i].getAttribute('data-pct'))) + '%';
  }
  function statTile(v, l, d) { return '<div class="card stat"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div>' + (d ? '<div class="d">' + esc(d) + '</div>' : '') + '</div>'; }
  function textHtml(s) { return esc(s).replace(/\n/g, '<br>'); }
  function fmtAns(v) { return Array.isArray(v) ? v.join('; ') : (v === '' || v == null ? '(비움)' : String(v)); }
  function pctText(x) { return x === null || x === undefined ? '—' : Math.round(100 * x) + '%'; }

  // 막대 한 개 — 바닥은 각지고 끝만 4px 둥글다. 값이 0 이면 그리지 않는다(MWL barPath)
  function barPath(x, y, w, h, horizontal) {
    if (w <= 0 || h <= 0) return '';
    var r = Math.min(4, horizontal ? Math.min(w, h / 2) : Math.min(h, w / 2)), f = function (n) { return Math.round(n * 10) / 10; };
    if (horizontal) return 'M' + f(x) + ' ' + f(y) + 'H' + f(x + w - r) + 'Q' + f(x + w) + ' ' + f(y) + ' ' + f(x + w) + ' ' + f(y + r) + 'V' + f(y + h - r) + 'Q' + f(x + w) + ' ' + f(y + h) + ' ' + f(x + w - r) + ' ' + f(y + h) + 'H' + f(x) + 'Z';
    return 'M' + f(x) + ' ' + f(y + h) + 'V' + f(y + r) + 'Q' + f(x) + ' ' + f(y) + ' ' + f(x + r) + ' ' + f(y) + 'H' + f(x + w - r) + 'Q' + f(x + w) + ' ' + f(y) + ' ' + f(x + w) + ' ' + f(y + r) + 'V' + f(y + h) + 'Z';
  }
  // 단일 계열 막대 — 단색·직접 레이블·1px 그리드(MWL barChart). rows: [{label, value, note?, text?(값 글을 바꿀 때 — 값이 없음 등)}]. title: 화면 읽기 프로그램용 이름
  function barChart(rows, unit, max, horizontal, title) {
    // 좁은 화면(휴대폰)은 그리는 폭을 줄여 글자가 작아지지 않게 한다 — viewBox 960 을 390px 에 넣으면 글자가 5px 이 된다(FR-347, 스크린샷에서 봄)
    var narrow = (root.innerWidth || 1280) < 600;
    var W = narrow ? 420 : 960, padR = narrow ? 70 : 110, svg, d;
    function cut(t) { t = String(t); return narrow && t.length > 12 ? t.slice(0, 11) + '…' : t; }
    var mx = max || Math.max(2, Math.ceil(Math.max.apply(null, [1].concat(rows.map(function (r) { return r.value; }))) / 2) * 2);
    var label = esc(title || (horizontal ? '가로 막대 차트' : '세로 막대 차트'));
    if (horizontal) {
      var padL = narrow ? 120 : 220, rowH = 28, barH = 18, H = rows.length * rowH + 14;
      svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + label + '">';
      [0, 0.5, 1].forEach(function (t) {
        var x = padL + (W - padL - padR) * t;
        svg += '<line class="' + (t ? 'grid' : 'base') + '" x1="' + x + '" y1="0" x2="' + x + '" y2="' + (H - 14) + '"/><text x="' + x + '" y="' + (H - 2) + '" text-anchor="middle">' + (Math.round(mx * t * 10) / 10) + '</text>';
      });
      rows.forEach(function (r, idx) {
        var y = idx * rowH + 4, w = (W - padL - padR) * (r.value / mx);
        svg += '<text x="' + (padL - 8) + '" y="' + (y + 14) + '" text-anchor="end">' + esc(cut(r.label)) + '</text>';
        d = barPath(padL, y, w, barH, true);
        if (d) svg += '<path class="bar" d="' + d + '"><title>' + esc(r.label) + ': ' + esc(r.value) + unit + '</title></path>';
        svg += '<text class="val" x="' + (padL + Math.max(0, w) + 6) + '" y="' + (y + 14) + '">' + (r.text !== undefined ? esc(r.text) : esc(r.value) + unit) + (r.note ? ' (' + esc(r.note) + ')' : '') + '</text>';
      });
      return svg + '</svg>';
    }
    var H2 = 220, top = 24, bottom = 28, padL2 = 48;
    var avail = H2 - top - bottom, slot = (W - padL2 - 12) / Math.max(1, rows.length), bw = Math.min(24, slot * 0.6);
    svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H2 + '" role="img" aria-label="' + label + '">';
    [0, 0.5, 1].forEach(function (t) {
      var y = top + avail * (1 - t);
      svg += '<line class="' + (t ? 'grid' : 'base') + '" x1="' + padL2 + '" y1="' + y + '" x2="' + (W - 12) + '" y2="' + y + '"/><text x="' + (padL2 - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(mx * t) + '</text>';
    });
    var every = Math.max(1, Math.ceil(rows.length / (narrow ? 6 : 14)));   // 28일처럼 막대가 많으면 아래 글은 몇 칸마다
    rows.forEach(function (r, idx) {
      var h = avail * (r.value / mx), x = padL2 + slot * idx + (slot - bw) / 2, y = top + avail - h;
      d = barPath(x, y, bw, h, false);
      if (d) svg += '<path class="bar" d="' + d + '"><title>' + esc(r.label) + ': ' + esc(r.value) + unit + '</title></path>';
      if ((rows.length - 1 - idx) % every === 0) svg += '<text x="' + (x + bw / 2) + '" y="' + (H2 - 8) + '" text-anchor="middle">' + esc(r.label) + '</text>';   // 끝(오늘 쪽)에서부터 같은 간격 — 겹치지 않게
      if (r.value && rows.length <= (narrow ? 7 : 14)) svg += '<text class="val" x="' + (x + bw / 2) + '" y="' + (y - 4) + '" text-anchor="middle">' + esc(r.value) + '</text>';
    });
    return svg + '</svg>';
  }
  function chartCard(svg) { return '<div class="card chart-card">' + svg + '</div>'; }

  // 화면 설정 — 이 브라우저에만(boot.js 가 그리기 전에 적용)
  var UI_KEY = 'mylearner.ui', UI_KEYS = ['theme', 'size', 'lh', 'width'];
  var UI_OPTS = {
    theme: [['', '자동(시스템 설정)'], ['light', '밝게'], ['dark', '어둡게']],
    size: [['s', '작게'], ['', '보통'], ['l', '크게'], ['xl', '아주 크게']],
    lh: [['tight', '좁게'], ['', '보통'], ['loose', '넓게']],
    width: [['', '화면에 맞춤'], ['wide', '넓게']]
  };
  var THEME_NEXT = { '': 'light', light: 'dark', dark: '' }, THEME_LABEL = { '': '◐ 자동', light: '☀ 밝게', dark: '☾ 어둡게' };
  function uiPrefs() { try { return JSON.parse(root.localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function applyUi(u) {
    var d = doc.documentElement;
    UI_KEYS.forEach(function (k) { if (u[k]) d.setAttribute('data-' + k, u[k]); else d.removeAttribute('data-' + k); });
    var b = $('#theme-btn');
    if (b) b.textContent = THEME_LABEL[u.theme || ''] || THEME_LABEL[''];
  }
  function saveUi(u) {
    var keep = {};
    UI_KEYS.forEach(function (k) { if (u[k]) keep[k] = u[k]; });
    try { root.localStorage.setItem(UI_KEY, JSON.stringify(keep)); } catch (e) { /* 저장 못 해도 이번 화면에는 적용된다 */ }
    applyUi(keep);
  }
  function download(name, text, type) {
    var blob = new root.Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = doc.createElement('a');
    a.href = root.URL.createObjectURL(blob);
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    root.setTimeout(function () { root.URL.revokeObjectURL(a.href); }, 1000);
  }

  ns.ui = { esc: esc, $: $, banner: banner, pct: pct, bar: bar, applyPct: applyPct, statTile: statTile, textHtml: textHtml, fmtAns: fmtAns, pctText: pctText,
    barChart: barChart, chartCard: chartCard, UI_KEYS: UI_KEYS, UI_OPTS: UI_OPTS, THEME_NEXT: THEME_NEXT, uiPrefs: uiPrefs, applyUi: applyUi, saveUi: saveUi,
    download: download };
})(typeof self !== 'undefined' ? self : this);
