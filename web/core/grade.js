/* MyLearner web/core/grade.js — 퀴즈·실습·드릴 채점. MWL web/engine.js(MiddlewareLearner@e55b9c0) 의 checkAnswer·gradeItems·checkLab·runDrill 을 옮겼다.
 * 다른 점: 실습 regex 는 MWL Python(mwl/cli/commands/lab.py 의 re.fullmatch)처럼 앞의 (?i) 를 받고, 선형 시간 엔진(regex.js)으로 맞춰 본다
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
  var C = dep('constants'), R = dep('regex');
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

  // 실습 정규식 답 → {prog}(regex.js 가 엮은 것) 또는 {why}. 앞의 (?i) 는 대소문자 무시(MWL Python re.fullmatch 처럼).
  // 먼저 V8 이 패턴만으로 읽는지 본다 — '^(?:…)$' 감싸개를 닫는 'a)|(b' 같은 패턴은 여기서 '문법'(독립 점검 ② F5).
  // 맞춰 보기는 V8 RegExp(되짚기)가 아니라 regex.js(선형) — 과정 파일이 남이 만든 것이어도 화면이 멈추지 않는다(F1·F2)
  function labPattern(answer) {
    var src = String(answer), ic = false;
    if (src.length > C.REGEX_MAX_PATTERN) return { why: '길이' };
    if (src.indexOf('(?i)') === 0) { src = src.slice(4); ic = true; }
    try { new RegExp(src, ic ? 'i' : ''); } catch (e) { return { why: '문법' }; }
    return R.compile(src, ic);
  }
  function checkLab(check, raw) {
    raw = String(raw).trim();
    if (check.type === 'choice') {
      if (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= check.options.length) raw = check.options[Number(raw) - 1];
      return raw.toLowerCase() === String(check.answer).trim().toLowerCase();
    }
    if (check.type === 'text') return raw.toLowerCase() === String(check.answer).trim().toLowerCase();
    if (raw.length > C.REGEX_MAX_INPUT) return false;
    var lp = labPattern(check.answer);
    return !lp.why && R.fullMatch(lp.prog, raw);
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

  return { checkAnswer: checkAnswer, gradeItems: gradeItems, checkLab: checkLab, labPattern: labPattern, runDrill: runDrill };
});
