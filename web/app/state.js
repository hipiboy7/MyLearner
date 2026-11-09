/* MyLearner web/app/state.js — 앱 상태: 판 설정, 저장소 고르기(서버 모드·브라우저 모드), 과정 싣기(묶음 + 사용자, 검사), 사건 → 상태,
 * 사건 만들기·저장(쓰는 탭 임대·실패하면 메모리에 남겨 다시 보냄), 날짜 넘김. MWL web/app.js(MiddlewareLearner@e55b9c0)의 App·persist·checkDay 를
 * 사건 기록 꼴로 옮겼다 — 상태는 늘 사건에서 다시 계산한다(docs/P2_설계서_Core.md 1절).
 * 입력: MyLearner.config·manifest·courseData, 저장 어댑터 / 출력: MyLearner.app / 트리거: app/main.js(시작)·화면의 행동
 * 문서: docs/P3_요구사항정의서_PC.md FR-302·303·306·320·325·326, docs/P3_설계서_PC.md 1·3.2·3.5절 */
(function (root) {
  'use strict';
  var ns = root.MyLearner = root.MyLearner || {};
  var ui = ns.ui, L = ns.log, R = ns.replay, D = ns.dates, K = ns.course, P = ns.plan, C = ns.constants, SC = ns.storeCommon;
  var DEFAULT_CFG = { edition: 'dev', label: '개발', export: true, link_hosts: ['*'], stats_scope: '이 기기에 모인 기록', ai_presets: [] };
  var SETTING_TYPES = { weekday_minutes: 'count', weekend_minutes: 'count', weekend_review_only: 'bool', max_reviews_per_day: 'count',
    new_cards_per_day: 'count', study_days: 'days', main_course: 'text', day_start_hour: 'hour' };

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function hex(n) { var b = root.crypto.getRandomValues(new Uint8Array(n)); return Array.prototype.map.call(b, function (x) { return (x & 255).toString(16).padStart(2, '0'); }).join(''); }
  function ls() { try { return root.localStorage; } catch (e) { return null; } }

  var App = {
    cfg: Object.assign({}, DEFAULT_CFG, ns.config || {}),
    store: null, dev: null, where: '', events: [], raw: [], counts: {}, st: null, today: '', courses: [], byId: Object.create(null), problems: [],
    pending: [], saving: 0, writer: 'mine', tabId: hex(8), lastSeq: 0, ready: false, error: null,
    review: null, drill: null, lastQuiz: null, check: null, wrongAll: false, glossaryQuery: '', imp: null, dayAsked: null, reading: false
  };

  // ---------------------------------------------------------------- 과정
  function loadScript(src) {
    return new Promise(function (ok, bad) {
      var s = root.document.createElement('script');
      s.src = src;
      s.onload = function () { ok(); };
      s.onerror = function () { bad(new Error('과정 자료를 싣지 못했습니다: ' + src)); };
      root.document.head.appendChild(s);
    });
  }
  function accept(obj, source) {
    var id = obj && typeof obj.id === 'string' ? obj.id : '(ID 없음)';
    var v;
    try { v = K.validate(obj); } catch (e) { v = { ok: false, errors: [{ code: 'E-THROW', path: '', msg: e.message }] }; }
    if (!v.ok) { App.problems.push({ source: source, id: id, why: v.errors.slice(0, 5).map(function (e) { return e.code + ' ' + e.path + ' ' + e.msg; }) }); return; }
    if (own(App.byId, obj.id)) { App.problems.push({ source: source, id: id, why: ['같은 ID 의 과정이 이미 있어 싣지 않았습니다(묶음 과정이 이깁니다)'] }); return; }
    App.byId[obj.id] = obj;
    App.courses.push(obj);
  }
  function loadCourses() {
    App.courses = []; App.byId = Object.create(null); App.problems = [];
    var man = ns.manifest;
    var first = Promise.resolve();
    if (!man || !Array.isArray(man.courses)) App.problems.push({ source: '묶음', id: '-', why: ['과정 자료(data/manifest.js)가 없습니다 - 개발 중이면 python3 scripts/pack_app.py --web-data'] });
    else if (!ns.courseData || ns.courseData.length < man.courses.length) {
      ns.courseData = ns.courseData || [];
      first = man.courses.reduce(function (p, e) {
        return p.then(function () { return /^[a-z0-9][a-z0-9.-]{0,80}\.js$/.test(e.file) ? loadScript('data/courses/' + e.file) : Promise.reject(new Error('과정 자료 이름이 틀렸습니다')); });
      }, Promise.resolve()).catch(function (e) { App.problems.push({ source: '묶음', id: '-', why: [e.message] }); });
    }
    return first.then(function () {
      (ns.courseData || []).forEach(function (c) { accept(c, '묶음'); });
      return App.store.loadCourses().catch(function (e) { App.problems.push({ source: '사용자', id: '-', why: [e.message] }); return []; });
    }).then(function (list) { list.forEach(function (c) { accept(c, '사용자'); }); });
  }
  function course(id) { return own(App.byId, id) ? App.byId[id] : null; }
  function regular() { return App.courses.filter(function (c) { return c.kind !== 'notes'; }); }

  // ---------------------------------------------------------------- 설정·상태
  function okSetting(k, v) {
    var t = SETTING_TYPES[k];
    if (t === 'count') return Number.isInteger(v) && v >= 0 && v <= 10000;
    if (t === 'bool') return typeof v === 'boolean';
    if (t === 'days') return Array.isArray(v) && v.length > 0 && v.every(function (d) { return Number.isInteger(d) && d >= 1 && d <= 7; });
    if (t === 'text') return v === null || typeof v === 'string';
    if (t === 'hour') return Number.isInteger(v) && v >= 0 && v <= 23;
    return false;
  }
  function settings() {
    var s = Object.assign({}, C.PLAN_DEFAULTS, { plan_variants: {} }), got = (App.st && App.st.settings) || {};
    Object.keys(got).forEach(function (k) {
      var v = got[k];
      if (k.indexOf('plan_variants.') === 0) { if (typeof v === 'string' || v === null) s.plan_variants[k.slice(14)] = v; }
      else if (own(SETTING_TYPES, k) && okSetting(k, v)) s[k] = v;
    });
    return s;
  }
  function recompute(fresh) {
    if (fresh || !App.today) {
      App.st = R.run(App.events, {});
      App.today = D.learningDay(new Date(), settings().day_start_hour);
    }
    App.st = R.run(App.events, { today: App.today });
  }
  function plan() { return P.build(App.courses, App.st, settings(), App.today, { docker: false }); }
  function setEvents(lines) {
    var m = L.merge([lines]);
    App.events = m.events; App.raw = m.raw; App.counts = m.counts;
  }

  // ---------------------------------------------------------------- 렌더러 연결(판 설정의 링크 행선지)
  function allowLink(href) {
    if (href.charAt(0) === '#') return true;
    var hosts = App.cfg.link_hosts || [];
    if (hosts.indexOf('*') >= 0) return true;
    var m = /^https?:\/\/([^\/?#:@]+)/i.exec(href);
    if (!m) return false;
    var h = m[1].toLowerCase();
    return hosts.some(function (x) { x = String(x).toLowerCase(); return x === h || (x.indexOf('*.') === 0 && h.slice(-(x.length - 1)) === x.slice(1)); });
  }
  function lessonHref(c, id) { return c && own(c.lessons, id) ? '#/learn/' + c.id + '/' + id : null; }
  function render(md, c) {
    return ns.markdown.render(String(md || ''), { lessonRef: function (id) { return lessonHref(c, id); }, allowLink: allowLink, image: function () { return null; } });
  }

  // ---------------------------------------------------------------- 쓰는 탭 임대(FR-325)
  function leaseState() {
    var s = ls();
    if (!s) return 'mine';
    try { return SC.lease(SC.parseLease(s.getItem(SC.KEYS.writer)), App.tabId, Date.now()); } catch (e) { return 'mine'; }
  }
  function claim() { var s = ls(); if (s) { try { s.setItem(SC.KEYS.writer, JSON.stringify({ id: App.tabId, at: Date.now() })); } catch (e) { /* 임대를 못 적어도 쓴다 */ } } }
  function leaseTick() {
    var was = App.writer;
    if (leaseState() === 'mine') {
      claim();
      App.writer = 'mine';
      if (was === 'other') reloadLog().then(flush).then(function () { if (ns.route) ns.route(); });   // 다른 탭이 닫혀 임대가 끝났다
    } else {
      App.writer = 'other';
      if (was === 'mine' && ns.route) ns.route();
    }
  }
  // 닫을 때 내 임대를 놓는다 — 바로 다시 연 탭이 6초 동안 읽기 전용이 되지 않게(스모크가 잡았다, 테스트결과서 7절)
  function release() {
    var s = ls();
    if (!s || App.writer !== 'mine') return;
    try { var rec = SC.parseLease(s.getItem(SC.KEYS.writer)); if (rec && rec.id === App.tabId) s.removeItem(SC.KEYS.writer); } catch (e) { /* 닫는 중 */ }
  }
  if (root.addEventListener) root.addEventListener('pagehide', release);
  function takeover() {
    claim();
    App.writer = 'mine';
    return reloadLog().then(flush);
  }

  // ---------------------------------------------------------------- 사건 만들기·저장(FR-326)
  function reloadLog() {
    return App.store.loadLog().then(function (lines) {
      setEvents(lines.concat(App.events.map(function (e) { return e.line; }), App.raw));
      recompute(false);
    });
  }
  function nextSeq() { return Math.max(L.nextSeq(App.events, App.dev), App.store.seqFloor() + 1, App.lastSeq + 1); }
  function record(type, fields) {
    var stamp = L.stamp(new Date(), settings().day_start_hour);
    var seq = nextSeq();
    var ev = L.make(Object.assign({ dev: App.dev, seq: seq, t: stamp.t, day: stamp.day, type: type }, fields));
    App.lastSeq = seq;
    App.events = L.order(App.events.concat([ev]));
    App.pending.push(ev.line);
    recompute(false);
    return flush();
  }
  function flush() {
    if (!App.pending.length) return Promise.resolve(true);
    if (leaseState() !== 'mine') {
      App.writer = 'other';
      ui.banner('다른 탭이 기록을 쓰고 있어 이 탭의 기록 ' + App.pending.length + '건을 아직 저장하지 않았습니다 - 위의 [이 탭에서 쓰기]를 누르세요', 'bad');
      return Promise.resolve(false);
    }
    claim();
    var lines = App.pending.slice();
    App.saving += 1;
    return App.store.append(lines, App.today).then(function (r) {
      App.saving -= 1;
      var sent = Object.create(null);
      lines.forEach(function (l) { sent[l] = true; });
      App.pending = App.pending.filter(function (l) { return sent[l] !== true; });
      if (r && r.warn) ui.banner(r.warn, 'bad');
      return true;
    }, function (e) {
      App.saving -= 1;
      ui.banner('저장 실패: ' + e.message + ' - 기록 ' + App.pending.length + '건은 이 화면에 남아 있고 다음 저장 때 다시 보냅니다', 'bad');
      return false;
    });
  }

  // ---------------------------------------------------------------- 시작
  function chooseStore() {
    var proto = root.location.protocol;
    var server = /^https?:$/.test(proto) ? ns.storeServer.probe({ fetch: root.fetch.bind(root) }) : Promise.resolve(null);
    return server.then(function (h) {
      if (h) return ns.storeServer.create({ fetch: root.fetch.bind(root) });
      return ns.storeIdb.open().then(function (kv) {
        var s = ls();
        if (!s) throw new Error('이 브라우저는 저장소(localStorage)를 쓸 수 없습니다 - 서버 모드(py -3 -m mylearner serve)로 여세요');
        return ns.storeBrowser.create({ ls: s, kv: kv, random: function (n) { return root.crypto.getRandomValues(new Uint8Array(n)); } });
      });
    });
  }
  function boot() {
    return chooseStore().then(function (store) {
      App.store = store;
      return store.init();
    }).then(function (info) {
      App.dev = info.dev; App.where = info.where;
      return App.store.loadLog();
    }).then(function (lines) {
      setEvents(lines);
      return loadCourses();
    }).then(function () {
      recompute(true);
      if (leaseState() === 'mine') claim(); else App.writer = 'other';
      root.setInterval(leaseTick, SC.LEASE_BEAT);
      App.ready = true;
    });
  }
  if (root.addEventListener) {
    root.addEventListener('storage', function (ev) {
      if (!App.ready) return;
      if (ev.key === SC.KEYS.writer) leaseTick();
      else if (SC.isLogKey(ev.key) && App.writer === 'other') reloadLog().then(function () { if (ns.route) ns.route(); });
    });
  }

  // ---------------------------------------------------------------- 날짜 넘김(FR-306, MWL T-031)
  function hasDraft() {
    if (App.drill && App.drill.choices.length && !App.drill.saved) return true;
    if (App.check) return true;
    return [].some.call(root.document.querySelectorAll('#app input:not([type=file]), #app textarea, #app select'), function (el) {
      if (el.type === 'radio' || el.type === 'checkbox') return el.checked !== el.defaultChecked;
      if (el.tagName === 'SELECT') { var d = [].filter.call(el.options, function (o) { return o.defaultSelected; })[0] || el.options[0]; return !!d && !d.selected; }
      return el.value !== el.defaultValue;
    });
  }
  function checkDay() {
    if (!App.ready) return false;
    var now = D.learningDay(new Date(), settings().day_start_hour);
    if (now === App.today || App.reading || App.saving) return false;
    if (App.pending.length) { flush().then(function (ok) { if (ok) checkDay(); }); return false; }
    if (hasDraft()) {
      if (App.dayAsked === now) return false;
      App.dayAsked = now;
      if (!root.confirm('날짜가 바뀌었습니다(' + now + '). 저장하지 않은 입력이 있어 새로 읽으면 사라집니다.\n지금 새로 읽을까요?')) {
        ui.banner('날짜가 바뀌었습니다 - 적던 것을 저장하면 다음에 이 화면으로 돌아올 때 오늘 날짜로 새로 읽습니다');
        return false;
      }
    }
    root.location.reload();
    return true;
  }
  if (root.addEventListener) {
    root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) checkDay(); });
    root.addEventListener('focus', checkDay);
    root.addEventListener('pageshow', function (ev) { if (ev.persisted) checkDay(); });
  }

  App.boot = boot; App.course = course; App.regular = regular; App.settings = settings; App.plan = plan; App.recompute = recompute;
  App.render = render; App.lessonHref = lessonHref; App.allowLink = allowLink; App.record = record; App.flush = flush; App.takeover = takeover;
  App.reloadLog = reloadLog; App.loadCourses = loadCourses; App.checkDay = checkDay; App.setEvents = setEvents; App.own = own;
  ns.app = App;
})(typeof self !== 'undefined' ? self : this);
