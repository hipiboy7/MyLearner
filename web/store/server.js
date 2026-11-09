/* MyLearner web/store/server.js — 서버 모드 저장 어댑터(등급 B): 로컬 서버(mylearner/server.py)의 /api/… 를 부른다.
 * 인터페이스는 store/browser.js 와 같다(docs/P3_설계서_PC.md 3.2절). 기록 파일·백업·사용자 과정은 서버의 데이터 폴더에 있다.
 * 입력: {fetch, base('' = 같은 출처)} / 출력: MyLearner.storeServer.create(…)·probe(…) / 트리거: app/state.js(http://127.0.0.1)
 * 문서: docs/P3_요구사항정의서_PC.md FR-320·321·327, docs/P3_설계서_PC.md 3.2·3.3절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name, file) { var m = node ? require(file) : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.storeServer = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var L = dep('log', '../core/log.js');

  function call(env, path, opt) {
    opt = opt || {};
    opt.credentials = 'same-origin'; opt.cache = 'no-store';
    return env.fetch((env.base || '') + path, opt).then(function (r) {
      if (r.ok) return r;
      return r.text().then(function (t) {
        var msg = t;
        try { msg = JSON.parse(t).error || t; } catch (e) { /* 글 그대로 */ }
        var err = new Error('서버 ' + r.status + ': ' + String(msg).slice(0, 200));
        err.status = r.status;
        throw err;
      });
    });
  }
  function json(env, path, method, body) {
    return call(env, path, body === undefined ? { method: method || 'GET' }
      : { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }

  // 이 주소가 MyLearner 서버인가 — 아니면(파일·다른 서버) 브라우저 어댑터를 쓴다
  function probe(env) {
    return call(env, '/api/health').then(function (r) { return r.json(); })
      .then(function (j) { return !!j && j.app === 'mylearner' && j.ok === true ? j : null; }, function () { return null; });
  }

  function create(env) {
    return {
      kind: 'server',
      init: function () { return json(env, '/api/device'); },
      loadLog: function () {
        return call(env, '/api/log').then(function (r) { return r.text(); }).then(function (text) {
          var f = L.readFile(text);
          if (!f.ok) throw new Error('기록 파일을 읽을 수 없습니다(' + f.error + ')');
          return f.lines;
        });
      },
      append: function (lines) { return json(env, '/api/log', 'POST', { lines: lines }).then(function (j) { return { added: j.added, warn: null }; }); },
      seqFloor: function () { return 0; },
      loadCourses: function () { return json(env, '/api/courses').then(function (j) { return j.courses || []; }); },
      saveCourse: function (c) { return json(env, '/api/courses/' + encodeURIComponent(c.id), 'PUT', c).then(function () {}); },
      backup: function (reason) { return json(env, '/api/backups', 'POST', { reason: reason }).then(function (j) { return { name: j.name }; }); },
      listBackups: function () { return json(env, '/api/backups').then(function (j) { return j.backups || []; }); },
      backupText: function (name) { return call(env, '/api/backups/' + encodeURIComponent(name)).then(function (r) { return r.text(); }); },
      usage: function () { return Promise.resolve(null); }
    };
  }

  return { create: create, probe: probe };
});
