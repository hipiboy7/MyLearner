/* MyLearner web/core/grade.js — 퀴즈·실습·드릴 채점. MWL web/engine.js(MiddlewareLearner@e55b9c0) 의 checkAnswer·gradeItems·checkLab·runDrill 을 옮겼다.
 * 다른 점: 실습 regex 는 MWL Python(mwl/cli/commands/lab.py 의 re.fullmatch)처럼 앞의 (?i) 를 받고, 위험한 패턴·긴 답은 돌리지 않는다
 * (과정 파일은 남이 만든 것일 수 있다 — 화면이 멈추면 안 된다). MWL 의 JS 는 (?i) 에서 SyntaxError 로 늘 오답이었다.
 * 입력: 문항·답 / 출력: MyLearner.grade / 트리거: (Phase 3) 퀴즈·실습·드릴 화면, course.js 의 E-REGEX 검사
 * 문서: docs/P2_요구사항정의서_Core.md FR-244, docs/P2_설계서_Core.md 3.7절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.grade = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var C = dep('constants');
  var SEP = '|';

  function checkAnswer(item, raw) {
    if (item.type === 'mcq') {
      var s = String(raw).trim();
      if (/^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= item.options.length) s = item.options[Number(s) - 1];
      return s.toLowerCase() === String(item.answer).trim().toLowerCase();
    }
    if (item.type === 'short') return String(raw).trim().toLowerCase() === String(item.answer).trim().toLowerCase();
    var parts = Array.isArray(raw) ? raw.slice() : String(raw).split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    var low = parts.map(function (p) { return String(p).toLowerCase(); });
    var ans = item.answer.map(function (a) { return String(a).toLowerCase(); });
    if (item.type === 'multi') return low.slice().sort().join(SEP) === ans.slice().sort().join(SEP);
    return low.join(SEP) === ans.join(SEP);
  }
  function gradeItems(items, answers) {
    var correct = items.filter(function (it) { return Object.prototype.hasOwnProperty.call(answers, it.id) && checkAnswer(it, answers[it.id]); })
      .map(function (it) { return it.id; });
    return { score: items.length ? Math.round(100 * correct.length / items.length) : 0, correct: correct };
  }

  // 위험한 정규식인가 — 이유 글 또는 null. 반복되는 묶음 안에 반복·대안이 있으면(겹친 반복) 지수 시간이 될 수 있다
  function unsafeRegex(p) {
    if (typeof p !== 'string' || p.length > C.REGEX_MAX_PATTERN) return '길이';
    if (/\\[1-9]|\\k</.test(p)) return '역참조';
    var stack = [{ inner: false }], i = 0;
    function outerQuant(j) {
      var c = p.charAt(j);
      if (c === '+' || c === '*') return true;
      if (c !== '{') return false;
      var m = /^\{(\d+)(,(\d*))?\}/.exec(p.slice(j));
      return !!m && (m[2] !== undefined && (m[3] === '' || Number(m[3]) > 1));
    }
    while (i < p.length) {
      var c = p.charAt(i);
      if (c === '\\') { i += 2; continue; }
      if (c === '[') { i += 1; if (p.charAt(i) === ']') i += 1; while (i < p.length && p.charAt(i) !== ']') { if (p.charAt(i) === '\\') i += 1; i += 1; } i += 1; continue; }
      if (c === '(') { stack.push({ inner: false }); i += 1; continue; }
      if (c === ')') {
        var g = stack.length > 1 ? stack.pop() : { inner: false };
        if (g.inner && outerQuant(i + 1)) return '겹친 반복';
        if (g.inner || outerQuant(i + 1)) stack[stack.length - 1].inner = true;
        i += 1; continue;
      }
      if (c === '|' || c === '+' || c === '*' || (c === '{' && /^\{\d+(,\d*)?\}/.test(p.slice(i)))) stack[stack.length - 1].inner = true;
      i += 1;
    }
    return null;
  }
  function compileLab(answer) {
    var src = String(answer), flags = '';
    if (src.indexOf('(?i)') === 0) { src = src.slice(4); flags = 'i'; }
    return new RegExp('^(?:' + src + ')$', flags);
  }
  function checkLab(check, raw) {
    raw = String(raw).trim();
    if (check.type === 'choice') {
      if (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= check.options.length) raw = check.options[Number(raw) - 1];
      return raw.toLowerCase() === String(check.answer).trim().toLowerCase();
    }
    if (check.type === 'text') return raw.toLowerCase() === String(check.answer).trim().toLowerCase();
    if (raw.length > C.REGEX_MAX_INPUT || unsafeRegex(String(check.answer))) return false;
    try { return compileLab(check.answer).test(raw); } catch (e) { return false; }
  }
  function runDrill(drill, choices) {
    var run = { score: 0, max: drill.max_score, path: [], steps: [], finished: false, next_step: null };
    var current = drill.start;
    for (var k = 0; k < choices.length; k++) {
      var idx = choices[k];
      if (current === null || current === undefined) break;
      var step = drill.steps[current];
      if (!Number.isInteger(idx) || idx < 0 || idx >= step.options.length) throw new Error('선택지 범위 밖');
      var opt = step.options[idx];
      run.steps.push({ step_id: current, option_index: idx, option_text: opt.text, feedback: opt.feedback, score: opt.score });
      run.path.push(current); run.score += opt.score; current = opt.next;
    }
    run.finished = current === null || current === undefined;
    run.next_step = run.finished ? null : current;
    return run;
  }

  return { checkAnswer: checkAnswer, gradeItems: gradeItems, checkLab: checkLab, unsafeRegex: unsafeRegex, compileLab: compileLab, runDrill: runDrill };
});
