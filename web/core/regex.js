/* MyLearner web/core/regex.js — 실습 정규식 답을 선형 시간에 맞춰 본다(톰프슨 NFA를 Pike VM 으로 돌린다 — 되짚기 없음).
 * 왜: 실습 정규식은 과정 파일(남이 만든 것일 수 있다)에서 온다. V8 RegExp 는 되짚기 엔진이라 `.*.*.*.*b`·`(a+){20}b`·`(a|a)(a|a)…` 같은
 *   패턴이 답 몇백 자에서 화면을 멈춘다(독립 점검 ② F1·F2). 여기서는 일치 여부만 필요하므로 NFA 로 O(패턴 × 답) 에 끝낸다.
 * 문법·뜻은 V8 RegExp 의 유니코드 아닌 모드(Annex B 포함 — 지금까지 checkLab 이 쓰던 것)와 같다. 시험이 V8 과 무작위로 대조한다.
 *   받지 않는 것: 뒤돌아보기·앞보기((?= (?! (?<= (?<!), 역참조(\1~\9, \k<이름>), 옛 8진수(\01, 글자 묶음 안의 \1), 그 밖의 (?…) — 이유를 돌려준다.
 *   대소문자 무시는 패턴 전체에만(grade.js 가 앞의 (?i) 를 떼어 준다). 글자 단위는 UTF-16 코드 단위다(유니코드 아닌 모드와 같다).
 * 입력: 패턴 글·대소문자 무시 여부, 답 글 / 출력: MyLearner.regex.compile → {prog} 또는 {why}, fullMatch(prog, 글) → bool
 * 트리거: grade.js 의 checkLab·labPattern(과정 검사 E-REGEX 도 이것으로)
 * 문서: docs/P2_요구사항정의서_Core.md FR-244, docs/P2_설계서_Core.md 3.7절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.regex = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants');
  var CHAR = 0, SPLIT = 1, JMP = 2, ASSERT = 3, MATCH = 4;

  function Reject(why) { this.why = why; }
  function isDigit(c) { return c >= 48 && c <= 57; }
  function isWord(c) { return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95; }
  function isSpace(c) {   // JS \s = WhiteSpace + LineTerminator
    return (c >= 9 && c <= 13) || c === 32 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
      c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
  }
  function isLineTerm(c) { return c === 10 || c === 13 || c === 0x2028 || c === 0x2029; }
  var ESCAPES = { d: isDigit, w: isWord, s: isSpace,
    D: function (c) { return !isDigit(c); }, W: function (c) { return !isWord(c); }, S: function (c) { return !isSpace(c); } };

  // 대소문자 무시(유니코드 아닌 모드의 Canonicalize): 대문자가 한 글자이고, 128 이상이 128 미만으로 가지 않을 때만 바꾼다
  function canon(c) {
    var u = String.fromCharCode(c).toUpperCase();
    if (u.length !== 1) return c;
    var cu = u.charCodeAt(0);
    return c >= 128 && cu < 128 ? c : cu;
  }
  var EQUIV = null;   // 대표 글자 → 같은 대표를 갖는 글자들(자기 자신만인 것은 두지 않는다). 처음 쓸 때 한 번 만든다
  function equiv(c) {
    if (!EQUIV) {
      EQUIV = new Map();
      for (var x = 0; x <= 0xffff; x++) { var k = canon(x); if (k !== x) { if (!EQUIV.has(k)) EQUIV.set(k, []); EQUIV.get(k).push(x); } }
      EQUIV.forEach(function (list, k) { if (canon(k) === k) list.push(k); });
    }
    return EQUIV.get(canon(c)) || [c];
  }
  // 글자 하나를 받는 시험 함수. member 는 묶음의 글자인가, invert 는 [^…]
  function charTest(member, invert, ic) {
    if (!ic) return invert ? function (c) { return !member(c); } : member;
    return function (c) {
      var list = equiv(c), found = false;
      for (var i = 0; i < list.length && !found; i++) found = member(list[i]);
      return invert ? !found : found;
    };
  }

  // ---- 읽기: 패턴 → 나무 {t: 'char'|'seq'|'alt'|'rep'|'assert', …}
  function parse(src, ic) {
    var i = 0, n = src.length;
    function at(k) { return src.charCodeAt(i + (k || 0)); }
    function ch(k) { return src.charAt(i + (k || 0)); }
    function hexAt(pos, len) { var h = src.substr(pos, len); return h.length === len && /^[0-9A-Fa-f]+$/.test(h) ? parseInt(h, 16) : -1; }
    function isLetter(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
    function quantAt(pos) {   // {min, max, len} 또는 null. Annex B — 수량자 꼴이 아닌 '{' 는 글자다
      var c = src.charAt(pos), m;
      if (c === '*') return { min: 0, max: Infinity, len: 1 };
      if (c === '+') return { min: 1, max: Infinity, len: 1 };
      if (c === '?') return { min: 0, max: 1, len: 1 };
      if (c === '{' && (m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(pos)))) {
        var min = Number(m[1]), max = m[2] === undefined ? min : (m[3] === '' ? Infinity : Number(m[3]));
        return { min: min, max: max, len: m[0].length };
      }
      return null;
    }
    function lit(c) { return { t: 'char', test: charTest(function (x) { return x === c; }, false, ic) }; }
    function disjunction() {
      var alts = [alternative()];
      while (ch() === '|') { i++; alts.push(alternative()); }
      return alts.length === 1 ? alts[0] : { t: 'alt', alts: alts };
    }
    function alternative() {
      var items = [];
      while (i < n && ch() !== '|' && ch() !== ')') items.push(term());
      return { t: 'seq', items: items };
    }
    function term() {
      var c = ch(), a = null;
      if (c === '^' || c === '$') { i++; a = { t: 'assert', k: c }; }
      else if (c === '\\' && (ch(1) === 'b' || ch(1) === 'B')) { a = { t: 'assert', k: ch(1) }; i += 2; }
      if (a) { if (quantAt(i)) throw new Reject('문법'); return a; }
      var atom = parseAtom(), q = quantAt(i);
      if (!q) return atom;
      i += q.len;
      if (ch() === '?') i++;   // 게으른 수량자 — 일치 여부에는 같다
      if (q.min > q.max) throw new Reject('문법');
      if (q.min > C.REGEX_MAX_PROGRAM || (q.max !== Infinity && q.max > C.REGEX_MAX_PROGRAM)) throw new Reject('너무 큼');
      return { t: 'rep', node: atom, min: q.min, max: q.max };
    }
    function parseAtom() {
      var c = ch();
      if (c === '(') {
        i++;
        if (ch() === '?') {
          if (ch(1) === ':') i += 2;
          else if (ch(1) === '<' && ch(2) !== '=' && ch(2) !== '!') {   // 이름 붙은 묶음 — 이름은 V8 이 먼저 검사했다
            var close = src.indexOf('>', i);
            if (close < 0) throw new Reject('문법');
            i = close + 1;
          } else throw new Reject('지원하지 않는 문법');
        }
        var inner = disjunction();
        if (ch() !== ')') throw new Reject('문법');
        i++;
        return inner;
      }
      if (c === '[') return charClass();
      if (c === '.') { i++; return { t: 'char', test: charTest(function (x) { return !isLineTerm(x); }, false, ic) }; }
      if (c === '\\') return atomEscape();
      if (c === ')' || c === '') throw new Reject('문법');
      if (quantAt(i)) throw new Reject('문법');   // 반복할 것이 없다
      i++;
      return lit(c.charCodeAt(0));
    }
    function atomEscape() {   // i 는 '\' 에
      var e = ch(1), code = at(1);
      if (e === '') throw new Reject('문법');
      if (ESCAPES[e]) { i += 2; return { t: 'char', test: charTest(ESCAPES[e], false, ic) }; }
      if (code >= 49 && code <= 57) throw new Reject('역참조');
      if (e === 'k' && ch(2) === '<') throw new Reject('역참조');
      if (e === '0') { if (isDigit(at(2))) throw new Reject('지원하지 않는 문법'); i += 2; return lit(0); }
      if (e === 'c') {
        if (isLetter(at(2))) { var cc = at(2) % 32; i += 3; return lit(cc); }
        i += 1; return lit(92);   // Annex B — '\' 그대로, 'c' 는 다음 글자로
      }
      var v = simpleEscape(e);
      if (v >= 0) { i += 2; return lit(v); }
      if (e === 'x' && (v = hexAt(i + 2, 2)) >= 0) { i += 4; return lit(v); }
      if (e === 'u' && (v = hexAt(i + 2, 4)) >= 0) { i += 6; return lit(v); }
      i += 2; return lit(code);   // 그 밖은 그 글자(Annex B)
    }
    function simpleEscape(e) { var k = 'tnvfr'.indexOf(e); return e && k >= 0 ? 9 + k : -1; }   // \t \n \v \f \r = 9~13
    function classAtom() {   // {c: 글자} 또는 {f: 시험 함수}. i 를 옮긴다
      if (ch() !== '\\') { var c0 = at(); i++; return { c: c0 }; }
      var e = ch(1), code = at(1);
      if (e === '') throw new Reject('문법');
      if (ESCAPES[e]) { i += 2; return { f: ESCAPES[e] }; }
      if (e === 'b') { i += 2; return { c: 8 }; }
      if (e === '0' && !isDigit(at(2))) { i += 2; return { c: 0 }; }
      if (isDigit(code)) throw new Reject('지원하지 않는 문법');
      if (e === 'c') {
        var x = at(2);
        if (isLetter(x) || isDigit(x) || x === 95) { i += 3; return { c: x % 32 }; }
        i += 1; return { c: 92 };
      }
      var v = simpleEscape(e);
      if (v >= 0) { i += 2; return { c: v }; }
      if (e === 'x' && (v = hexAt(i + 2, 2)) >= 0) { i += 4; return { c: v }; }
      if (e === 'u' && (v = hexAt(i + 2, 4)) >= 0) { i += 6; return { c: v }; }
      i += 2; return { c: code };
    }
    function charClass() {
      i++;
      var invert = false, ranges = [], fns = [];
      if (ch() === '^') { invert = true; i++; }
      while (ch() !== ']') {
        if (i >= n) throw new Reject('문법');
        var a = classAtom();
        if (ch() === '-' && i + 1 < n && ch(1) !== ']') {
          i++;
          var b = classAtom();
          if (a.f || b.f) {   // Annex B — \d-z 처럼 한쪽이 묶음이면 '-' 는 글자
            [a, { c: 45 }, b].forEach(function (x) { if (x.f) fns.push(x.f); else ranges.push([x.c, x.c]); });
            continue;
          }
          if (a.c > b.c) throw new Reject('문법');
          ranges.push([a.c, b.c]);
        } else if (a.f) fns.push(a.f);
        else ranges.push([a.c, a.c]);
      }
      i++;
      function member(x) {
        for (var k = 0; k < ranges.length; k++) if (x >= ranges[k][0] && x <= ranges[k][1]) return true;
        for (k = 0; k < fns.length; k++) if (fns[k](x)) return true;
        return false;
      }
      return { t: 'char', test: charTest(member, invert, ic) };
    }
    var tree = disjunction();
    if (i < n) throw new Reject('문법');   // 짝 없는 ')'
    return tree;
  }

  // ---- 엮기: 나무 → 명령 목록 {op, test | x, y | k}
  function emit(tree) {
    var prog = [];
    function push(ins) { prog.push(ins); if (prog.length > C.REGEX_MAX_PROGRAM) throw new Reject('너무 큼'); return prog.length - 1; }
    function gen(nd) {
      var k, j, ends;
      if (nd.t === 'char') push({ op: CHAR, test: nd.test });
      else if (nd.t === 'assert') push({ op: ASSERT, k: nd.k });
      else if (nd.t === 'seq') nd.items.forEach(gen);
      else if (nd.t === 'alt') {
        ends = [];
        for (k = 0; k < nd.alts.length; k++) {
          var last = k === nd.alts.length - 1, split = last ? -1 : push({ op: SPLIT, x: 0, y: 0 });
          if (!last) prog[split].x = prog.length;
          gen(nd.alts[k]);
          if (!last) { ends.push(push({ op: JMP, x: 0 })); prog[split].y = prog.length; }
        }
        ends.forEach(function (e) { prog[e].x = prog.length; });
      } else {   // rep
        for (k = 0; k < nd.min; k++) gen(nd.node);
        if (nd.max === Infinity) {
          var loop = push({ op: SPLIT, x: 0, y: 0 });
          prog[loop].x = prog.length; gen(nd.node); push({ op: JMP, x: loop });
          prog[loop].y = prog.length;
        } else {
          ends = [];
          for (j = nd.min; j < nd.max; j++) { var s = push({ op: SPLIT, x: 0, y: 0 }); prog[s].x = prog.length; ends.push(s); gen(nd.node); }
          ends.forEach(function (e) { prog[e].y = prog.length; });
        }
      }
    }
    gen(tree);
    push({ op: MATCH });
    return prog;
  }

  function compile(src, ignoreCase) {
    try { return { prog: emit(parse(String(src), !!ignoreCase)) }; } catch (e) { if (e instanceof Reject) return { why: e.why }; throw e; }
  }

  // 전체 일치인가. 글 위치마다 살아 있는 명령 목록을 한 번씩만 넣는다(mark) → O(명령 수 × (글 길이 + 1))
  function fullMatch(prog, s) {
    var m = prog.length, n = s.length, mark = new Int32Array(m), stack = [], matched = false;
    var clist = new Int32Array(m), nlist = new Int32Array(m), cn, nn, tmp;
    function holds(k, pos) {
      if (k === '^') return pos === 0;
      if (k === '$') return pos === n;
      var b = (pos > 0 && isWord(s.charCodeAt(pos - 1))) !== (pos < n && isWord(s.charCodeAt(pos)));
      return k === 'b' ? b : !b;
    }
    function add(list, len, pc0, pos) {
      var token = pos + 1;
      stack.push(pc0);
      while (stack.length) {
        var pc = stack.pop();
        if (mark[pc] === token) continue;
        mark[pc] = token;
        var ins = prog[pc];
        if (ins.op === CHAR) list[len++] = pc;
        else if (ins.op === JMP) stack.push(ins.x);
        else if (ins.op === SPLIT) stack.push(ins.y, ins.x);
        else if (ins.op === ASSERT) { if (holds(ins.k, pos)) stack.push(pc + 1); }
        else if (pos === n) matched = true;   // MATCH
      }
      return len;
    }
    cn = add(clist, 0, 0, 0);
    for (var pos = 0; pos < n && cn > 0; pos++) {
      var c = s.charCodeAt(pos);
      nn = 0;
      for (var k = 0; k < cn; k++) if (prog[clist[k]].test(c)) nn = add(nlist, nn, clist[k] + 1, pos + 1);
      tmp = clist; clist = nlist; nlist = tmp; cn = nn;
    }
    return matched;
  }

  return { compile: compile, fullMatch: fullMatch };
});
