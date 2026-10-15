// 렌더러 출력 허용 목록 검사(시험 지원) — 출력은 우리가 만든 꼴이라 엄격한 토큰 분해로 본다.
// 허용 태그·속성 밖이 있거나, 글에 날것의 < > 가 있거나, 속성값에 " 가 있거나, 주소가 http(s)·#·data:image 가 아니면 문제 목록을 돌려준다.
// 문서: docs/P2_설계서_Core.md 3.6절
'use strict';
const ALLOW = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], p: [], strong: [], em: [], code: ['class'], pre: [], blockquote: [], ul: [], ol: [], li: [],
  table: [], thead: [], tbody: [], tr: [], th: [], td: [], hr: [], a: ['href', 'class'], img: ['src', 'alt'], span: ['class'] };
const VOID = { hr: true, img: true };
const ENT = /&(?:amp|lt|gt|quot|#x27);/g;
function unescape(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&'); }
function check(html) {
  const problems = [];
  const tag = /<(\/?)([a-z0-9]+)((?:\s+[a-z]+="[^"<>]*")*)\s*>/g;
  let pos = 0, m;
  const stack = [];
  function text(t) {
    if (/[<>]/.test(t)) problems.push('날것의 < > : ' + t.slice(0, 40));
    if (/&/.test(t.replace(ENT, ''))) problems.push('모르는 &: ' + t.slice(0, 40));
  }
  while ((m = tag.exec(html))) {
    text(html.slice(pos, m.index));
    pos = tag.lastIndex;
    const close = m[1] === '/', name = m[2];
    if (!Object.prototype.hasOwnProperty.call(ALLOW, name)) { problems.push('태그 ' + name); continue; }
    if (close) { if (stack.pop() === undefined) problems.push('닫는 태그만 ' + name); continue; }
    const attrs = {};
    (m[3].match(/[a-z]+="[^"]*"/g) || []).forEach((a) => { const i = a.indexOf('='); attrs[a.slice(0, i)] = a.slice(i + 2, -1); });
    for (const [k, v] of Object.entries(attrs)) {
      if (ALLOW[name].indexOf(k) < 0) problems.push('속성 ' + name + '.' + k);
      if (/&/.test(v.replace(ENT, ''))) problems.push('속성의 모르는 & ' + k);
      const u = unescape(v);
      if (k === 'href' && !/^(https?:\/\/|#)/i.test(u)) problems.push('href ' + u.slice(0, 40));
      if (k === 'href' && /[\u0000-\u001f\u007f]/.test(u)) problems.push('href 제어 글자');
      if (k === 'src' && !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(u)) problems.push('src ' + u.slice(0, 40));
      if (k === 'class' && !/^(ref|img-missing|language-.+)$/.test(u)) problems.push('class ' + u.slice(0, 40));
    }
    if (!VOID[name]) stack.push(name);
  }
  text(html.slice(pos));
  return problems;
}
module.exports = { check };
