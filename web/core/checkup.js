/* MyLearner web/core/checkup.js — 점검(기준선·무작위·오답 다시 풀기) 문항 은행·뽑기·채점·오답노트.
 * MWL web/engine.js(MiddlewareLearner@e55b9c0) 점검 절(checkBank·sampleIds·gradeCheck·checkDetail·wrongNotes·retryIds)을 옮겨
 * 여러 과정으로 넓혔다 — 영역을 강의 ID 첫 글자가 아니라 그 과정 목차(강의 → 단원 → 영역)로 찾는다.
 * 입력: 과정 객체·replay 상태·답 / 출력: MyLearner.checkup / 트리거: 점검·오답노트 화면(web/app/views.js)
 * 문서: docs/P3_요구사항정의서_PC.md FR-316, docs/P3_설계서_PC.md 3.6절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { var m = node ? require('./' + name + '.js') : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.checkup = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var G = dep('grade'), K = dep('course');

  function table() { return Object.create(null); }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function roundHalfUp(x) { return Math.floor(x + 0.5); }
  function blank(raw) { return raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && !raw.length); }

  function bank(c) {
    var b = table();
    (c.diagnostic || []).forEach(function (it) { b[it.id] = it; });
    Object.keys(c.quizzes || {}).sort().forEach(function (qid) {
      (c.quizzes[qid].items || []).forEach(function (it) { b[qid + ':' + it.id] = it; });
    });
    return b;
  }
  function partOf(c, item) {
    var ix = K.index(c), lid = item && item.lesson;
    var uid = typeof lid === 'string' && own(c.lessons, lid) ? ix.unitOf(lid) : null;
    return (uid && ix.partOf(uid)) || '?';
  }
  function baselineIds(c) { return (c.diagnostic || []).map(function (it) { return it.id; }); }

  function sampleIds(c, b, per, parts, rnd) {
    rnd = rnd || Math.random;
    var by = table();
    Object.keys(b).sort().forEach(function (id) { var p = partOf(c, b[id]); (by[p] = by[p] || []).push(id); });
    var wanted = parts && parts.length ? Object.keys(parts.reduce(function (s, p) { s[p] = true; return s; }, table())).sort() : Object.keys(by).sort();
    var out = [];
    wanted.forEach(function (p) {
      var pool = (own(by, p) ? by[p] : []).slice();
      for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      Array.prototype.push.apply(out, pool.slice(0, Math.min(per, pool.length)));
    });
    return out;
  }

  function gradeCheck(c, b, ids, answers) {
    var per = table(), items = [];
    ids.forEach(function (id) {
      var it = b[id], raw = own(answers, id) ? answers[id] : '';
      if (raw === undefined || raw === null) raw = '';
      var ok = !blank(raw) && G.checkAnswer(it, raw);
      items.push({ id: id, answer: raw, correct: !!ok });
      var p = partOf(c, it);
      if (!per[p]) per[p] = [0, 0];
      per[p][1] += 1; if (ok) per[p][0] += 1;
    });
    var scores = {};
    Object.keys(per).sort().forEach(function (p) { scores[p] = roundHalfUp(100 * per[p][0] / per[p][1]); });
    var right = items.filter(function (i) { return i.correct; }).length;
    return { scores: scores, total: items.length ? roundHalfUp(100 * right / items.length) : 0, items: items };
  }

  function detail(check, b) {
    return ((check && check.items) || []).filter(function (r) { return own(b, r.id); }).map(function (r) {
      var it = b[r.id];
      return { id: r.id, q: it.q, type: it.type, options: (it.options || []).slice(), answer: r.answer === undefined ? '' : r.answer,
        expected: it.answer, explain: it.explain || '', lesson: it.lesson, correct: !!r.correct };
    });
  }

  function cmpNotes(a, b) {
    return (a.resolved === b.resolved ? 0 : a.resolved ? 1 : -1) || (b.wrong - a.wrong) || -cmp(a.last_wrong_at, b.last_wrong_at) || cmp(a.id, b.id);
  }
  function wrongNotes(c, st, b) {
    var attempts = table(), seq = 0;
    (st.quizzes || []).forEach(function (q) {
      if (q.course !== c.id) return;
      Object.keys(q.answers || {}).forEach(function (iid) {
        var id = q.id + ':' + iid;
        if (!own(b, id)) return;
        var raw = q.answers[iid];
        var ok = !blank(raw) && G.checkAnswer(b[id], raw);
        (attempts[id] = attempts[id] || []).push([q.at, 0, seq++, raw, !!ok]);
      });
    });
    (st.checks || []).forEach(function (d) {
      if (d.course !== c.id) return;
      (d.items || []).forEach(function (r) {
        if (!own(b, r.id)) return;
        (attempts[r.id] = attempts[r.id] || []).push([d.at, 1, seq++, r.answer === undefined ? '' : r.answer, !!r.correct]);
      });
    });
    var notes = [];
    Object.keys(attempts).forEach(function (id) {
      var atts = attempts[id].sort(function (x, y) { return cmp(x[0], y[0]) || (x[1] - y[1]) || (x[2] - y[2]); });
      var wrongs = atts.filter(function (a) { return !a[4]; });
      if (!wrongs.length) return;
      var last = wrongs[wrongs.length - 1];
      notes.push({ id: id, wrong: wrongs.length, attempts: atts.length, last_wrong_at: last[0], last_answer: last[3], resolved: atts[atts.length - 1][4] });
    });
    return notes.sort(cmpNotes);
  }
  function retryIds(notes, limit) { return notes.filter(function (n) { return !n.resolved; }).slice(0, limit).map(function (n) { return n.id; }); }

  return { bank: bank, partOf: partOf, baselineIds: baselineIds, sampleIds: sampleIds, gradeCheck: gradeCheck, detail: detail,
    wrongNotes: wrongNotes, retryIds: retryIds };
});
