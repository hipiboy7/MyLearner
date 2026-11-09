/* MyLearner web/store/browser.js — 브라우저 저장 어댑터(등급 B, 보류 결정 7 잠정): 기록은 localStorage 의 학습일 달별 키,
 * 큰 것(사용자 과정·백업)은 KV(IndexedDB — store/idb.js)에 둔다. 저장소 객체를 주입받아 Node 에서 가짜로 시험한다.
 * 인터페이스는 store/server.js 와 같다(docs/P3_설계서_PC.md 3.2절): init·loadLog·append·loadCourses·saveCourse·backup·listBackups·backupText·usage·seqFloor
 * 입력: {ls(localStorage 꼴), kv(get·put·keys·del 약속 — 없으면 null), now() → Date, random(n) → 바이트,
 *        lock(fn) → 약속(있으면 달 키 읽기-합치기-쓰기를 그 안에서 — 브라우저는 navigator.locks, 독립 점검 S11)}
 * 출력: MyLearner.storeBrowser.create(…) / 트리거: app/state.js(file:// 또는 서버가 없을 때)
 * 문서: docs/P3_요구사항정의서_PC.md FR-320·322·323·324·326, docs/P3_설계서_PC.md 3.2절 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name, file) { var m = node ? require(file) : ns[name]; if (!m) throw new Error('MyLearner.' + name + ' 을 먼저 싣는다'); return m; }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.storeBrowser = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  var L = dep('log', '../core/log.js'), SC = dep('storeCommon', './common.js');
  var K = SC.KEYS;

  function create(env) {
    var ls = env.ls, kv = env.kv || null, now = env.now || function () { return new Date(); };
    var lock = env.lock || function (fn) { return Promise.resolve().then(fn); };
    var dev = null;

    function logKeys() {
      var out = [];
      for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (SC.isLogKey(k)) out.push(k); }
      return out.sort();
    }
    function allLines() {
      var out = [];
      logKeys().forEach(function (k) { Array.prototype.push.apply(out, SC.splitText(ls.getItem(k))); });
      return out;
    }
    function needKv(what) { if (!kv) throw new Error('이 브라우저에서는 IndexedDB 를 쓸 수 없어 ' + what + ' 을(를) 할 수 없습니다'); }

    function backup(reason) {
      return Promise.resolve().then(function () {
        needKv('백업');
        var text = L.writeFile(L.merge([allLines()]));
        var name = SC.backupName(now(), reason);
        return kv.put('backup_text', name, text)
          .then(function () { return kv.put('backups', name, { name: name, at: now().toISOString(), reason: reason, bytes: text.length }); })
          .then(function () { return kv.keys('backups'); })
          .then(function (names) {
            return SC.pruneBackups(names, name).reduce(function (p, n) {
              return p.then(function () { return kv.del('backups', n); }).then(function () { return kv.del('backup_text', n); });
            }, Promise.resolve());
          })
          .then(function () { return { name: name }; });
      });
    }

    var api = {
      kind: 'browser',
      init: function () {
        dev = ls.getItem(K.device);
        if (!dev || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(dev)) { dev = L.newDeviceId(env.random); ls.setItem(K.device, dev); }
        return Promise.resolve({ dev: dev, where: '이 브라우저 저장소' });
      },
      loadLog: function () { return Promise.resolve().then(allLines); },
      // 하루 첫 덧붙이기 전에 하루 백업(실패해도 기록은 쓴다 — 기록을 잃는 것보다 낫다). 키마다 다시 읽어 합집합 후 쓴다
      append: function (lines, day) {
        var warn = null;
        var pre = (day && ls.getItem(K.daily) !== day)   // 기록이 비어 있으면 남길 것이 없다(서버 storage.py 와 같게)
          ? (kv && allLines().length ? backup('daily').catch(function (e) { warn = '하루 백업 실패: ' + e.message; }) : Promise.resolve())
              .then(function () { ls.setItem(K.daily, day); })
          : Promise.resolve();
        return pre.then(function () {
          return lock(function () {
            var groups = SC.groupByKey(lines), added = 0;
            Object.keys(groups).sort().forEach(function (k) {
              var u = SC.union(SC.splitText(ls.getItem(k)), groups[k]);
              if (u.added) { ls.setItem(k, SC.joinLines(u.lines)); added += u.added; }
            });
            var top = dev ? SC.maxSeq(lines, dev) : 0;
            if (top > api.seqFloor()) ls.setItem(K.seq, String(top));
            return { added: added, warn: warn };
          });
        });
      },
      seqFloor: function () { var n = Number(ls.getItem(K.seq)); return Number.isInteger(n) && n > 0 ? n : 0; },
      loadCourses: function () {
        if (!kv) return Promise.resolve([]);
        return kv.keys('courses').then(function (ids) {
          return Promise.all(ids.sort().map(function (id) { return kv.get('courses', id); }));
        });
      },
      saveCourse: function (c) {
        return Promise.resolve().then(function () { needKv('과정 저장'); return kv.put('courses', c.id, JSON.parse(JSON.stringify(c))); });
      },
      backup: backup,
      listBackups: function () {
        if (!kv) return Promise.resolve([]);
        return kv.keys('backups').then(function (names) {
          return Promise.all(names.sort().reverse().map(function (n) { return kv.get('backups', n); }));
        });
      },
      backupText: function (name) { return Promise.resolve().then(function () { needKv('백업 읽기'); return kv.get('backup_text', name); }); },
      usage: function () {
        var chars = 0, keys = 0;
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (k && k.indexOf(SC.PREFIX) === 0) { keys += 1; chars += k.length + String(ls.getItem(k) || '').length; }
        }
        return Promise.resolve({ chars: chars, keys: keys });
      }
    };
    return api;
  }

  return { create: create };
});
