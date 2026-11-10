// 화면 스모크 시나리오(등급 C) — scripts/app_smoke.py 가 DevTools 평가로 넣는다(window.__scenario 를 먼저 넣고 이 파일). 실제 화면을 눌러
// 오늘 → 강의 마침 → 복습(단추·키보드·보류) → 퀴즈 → 점검 → 설정 → 회고 → 주 과정 → 보류 풀기 → 통계 → MWL 진도 두 번 들여오기
// → (P4) 교환 파일 내보내기 → 다른 기기 교환 파일 두 번 합치기 → 되돌리기 → 되살리기 전으로 다시 → 내보내기 알림 띠 → 탭 임대를 돌리고,
// 화면마다 접근성 검사(tests/ui/a11y.js)를 한다. 'persist' 는 브라우저를 다시 연 뒤 앞 단계의 사건이 모두 남았는지 본다(NFR-306).
// 입력: window.__scenario {name, mode, edition, courses, bad, progress} / 출력: 약속 → {problems, a11y, counts, timings, verify, lines}
// 'phone' 은 폰 폭(창 폭은 app_smoke.py 가 정한다)에서 가로 넘침·누르는 곳 44px·접근성을 본다(P4 FR-461).
// 문서: docs/P3_설계서_PC.md 6절, docs/P3_요구사항정의서_PC.md 6절 완료 기준 2, docs/P4_설계서_Mobile.md 3.10절
(async () => {
  'use strict';
  const S = window.__scenario || {};
  const ML = window.MyLearner, A = ML.app;
  const problems = [], a11y = {}, timings = {}, counts = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (ok, msg) => { if (!ok) problems.push(msg); return ok; };
  async function waitFor(fn, ms, what) {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* 아직 */ } await sleep(40); }
    problems.push('기다리다 시간 초과: ' + what);
    return false;
  }
  async function settle() { await waitFor(() => A.pending.length === 0 && A.saving === 0, 8000, '저장 끝'); await sleep(30); }
  async function go(hash) {
    document.body.setAttribute('data-ready', '0');
    if (location.hash === hash) ML.route(); else location.hash = hash;
    await waitFor(() => document.body.getAttribute('data-ready') === '1', 8000, '화면 ' + hash);
  }
  const $ = (s) => document.querySelector(s);
  const byType = (t) => A.events.filter((e) => e.type === t);
  function audit(name) { const v = window.__a11y(); if (v.length) a11y[name] = v; }
  function errBox() { return !!$('#app .err-box'); }
  async function act(sel, what) {
    const el = $(sel);
    if (!check(!!el, '없는 단추: ' + (what || sel))) return false;
    el.click();
    await sleep(30);
    await settle();
    await waitFor(() => document.body.getAttribute('data-ready') === '1', 4000, '다시 그림 ' + (what || sel));
    return true;
  }
  async function submit(sel, fill, keep) {
    const f = $(sel);
    if (!check(!!f, '없는 폼: ' + sel)) return;
    if (fill) fill(f);
    document.body.setAttribute('data-ready', '0');
    f.requestSubmit();
    await sleep(30);
    if (!keep) await settle();
    await waitFor(() => document.body.getAttribute('data-ready') === '1', 4000, '제출 뒤 화면 ' + sel);
  }

  check(A.ready && !A.error, '앱이 준비되지 않았다: ' + (A.error && A.error.message));
  if (S.name === 'persist') {
    await waitFor(() => A.writer === 'mine' && A.pending.length === 0 && !Object.keys(localStorage).some((k) => k.indexOf('mylearner.pending.') === 0), 12000, '앞 탭이 남긴 줄 되살리기');
    check(A.counts.conflicts === 0, '같은 (기기, 순번) 다른 줄 ' + A.counts.conflicts + '(독립 점검 S1)');
    const want = JSON.parse(localStorage.getItem('smoke.expect') || '[]');
    const have = new Set(A.events.map((e) => e.line));
    const lost = want.filter((l) => !have.has(l));
    check(want.length > 0, '앞 단계가 남긴 기대 목록이 없다');
    check(lost.length === 0, '브라우저를 다시 연 뒤 사라진 사건 ' + lost.length + '개');
    check(A.pending.length === 0, '저장 못 한 기록 ' + A.pending.length);
    counts.events = A.events.length; counts.expected = want.length; counts.lost = lost.length;
    await go('#/stats'); audit('stats(persist)');
    return { problems, a11y, counts, timings };
  }
  if (S.name === 'perf-seed') {
    const ids = Object.keys(A.course('mwl').cards), lines = [], L = ML.log;
    for (let i = 0; i < 5000; i++) {
      const day = ML.dates.addDays(A.today, -1 - (i % 200));
      lines.push(L.make({ dev: 'smoke-perf', seq: i + 1, t: day + 'T09:00:00.000Z', day: day, type: 'review', course: 'mwl', card: ids[i % ids.length], grade: ['again', 'hard', 'good', 'easy'][i % 4] }).line);
    }
    for (let i = 0; i < lines.length; i += 1000) await A.store.append(lines.slice(i, i + 1000), A.today);
    return { problems, counts: { seeded: lines.length } };
  }
  if (S.name === 'perf') {
    timings.ready_ms = Math.round(window.__readyAt || -1);
    const tl = performance.now();   // 바로 앞 단계의 브라우저가 CDP 로 닫혀 pagehide 가 오지 않으면 임대가 6초 뒤에 풀린다 — 그 시간을 따로 적고 잰다
    await waitFor(() => A.writer === 'mine', 9000, '쓰는 탭 임대');
    timings.lease_wait_ms = Math.round(performance.now() - tl);
    counts.events = A.events.length;
    const t0 = performance.now(); await go('#/today'); timings.today_ms = Math.round(performance.now() - t0);
    const t1 = performance.now(); await go('#/stats'); timings.stats_ms = Math.round(performance.now() - t1);
    await go('#/review');
    const t2 = performance.now(); await act('[data-action=reveal]', '답 보기'); await act('[data-action=grade][data-g=good]', 'good'); timings.review_ms = Math.round(performance.now() - t2);
    return { problems, counts, timings };
  }
  // P4 — 다른 기기(폰)의 교환 파일: mwl 카드 12장 복습 + 강의 하나 + 사용자 과정 하나
  const PHONE = 'f0f0f0f0f0f0f0f0';
  function phoneExchange() {
    const L = ML.log, cards = Object.keys(A.course('mwl').cards).sort().slice(0, 12), day = ML.dates.addDays(A.today, -1), lines = [];
    cards.forEach((c, i) => lines.push(L.make({ dev: PHONE, seq: i + 1, t: day + 'T08:00:' + String(10 + i) + '.000Z', day: day, type: 'review', course: 'mwl', card: c, grade: 'good' }).line));
    const lid = Object.keys(A.course('mwl').lessons).sort()[1];
    lines.push(L.make({ dev: PHONE, seq: 13, t: day + 'T09:00:00.000Z', day: day, type: 'lesson', course: 'mwl', lesson: lid, done: true, confidence: 3 }).line);
    const notes = { format: 'mylearner-course', version: 1, min_reader: 1, id: 'phone-notes', title: '폰 메모', kind: 'notes', parts: [],
      lessons: { n1: { title: '폰에서 적은 메모', body: '본문' } }, cards: { 'n1-c1': { lesson: 'n1', type: 'concept', q: '질문', a: '답' } } };
    const ex = ML.exchange.build({ lines: lines, raw: [], courses: [notes], app: { version: '0.4.0', edition: 'mobile', label: '모바일판' }, dev: PHONE, now: new Date(), dayStartHour: 0 });
    return { lines: lines, ex: ex };
  }
  function overflowAndTargets(tag) {
    const w = window.innerWidth, sw = document.documentElement.scrollWidth;
    check(sw <= w + 1, tag + ': 가로로 넘친다(' + sw + ' > ' + w + 'px)');
    const small = [];
    document.querySelectorAll('.btn, button, .nav a, select, input[type=text], input[type=number]').forEach((el) => {
      if (el.closest('[hidden]') || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.height < 43.5 || r.width < 43.5) small.push((el.textContent || el.name || el.tagName).trim().slice(0, 20) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
    });
    check(small.length === 0, tag + ': 44px 보다 작은 누르는 곳 ' + small.length + ' — ' + small.slice(0, 4).join(' / '));
  }
  if (S.name === 'phone') {
    await waitFor(() => A.writer === 'mine', 9000, '쓰는 탭 임대');
    const lesson0 = Object.keys(A.course('mwl').lessons).sort()[0];
    for (const r of ['#/today', '#/review', '#/learn/mwl/' + lesson0, '#/stats', '#/courses', '#/map/mwl', '#/settings', '#/import/merge', '#/import/mwl', '#/check/mwl']) {
      await go(r);
      check(!errBox(), r + ': 오류 상자');
      overflowAndTargets(r + ' @' + window.innerWidth);
      audit(r + ' @' + window.innerWidth);
    }
    counts.width = window.innerWidth;
    return { problems, a11y, counts };
  }
  if (S.name === 'prep-merge') {
    await go('#/import/merge');
    ML.mergeFile(new File([phoneExchange().ex.bytes], 'mylearner-exchange-phone.zip'));
    await waitFor(() => A.mrg && A.mrg.pv, 8000, '합치기 미리보기');
    await sleep(50);
    return { problems };
  }
  if (S.name === 'prep-review') { await go('#/review'); const b = $('[data-action=reveal]'); if (b) { b.click(); await sleep(50); } return { problems }; }
  if (S.name === 'prep-import') {
    await go('#/import/mwl');
    ML.importFile(new File([JSON.stringify(S.progress)], 'progress.json'));
    await waitFor(() => A.imp && A.imp.conv, 8000, '미리보기');
    await sleep(50);
    return { problems };
  }

  // ---------------------------------------------------------------- first
  timings.ready_ms = Math.round(window.__readyAt || -1);
  check(A.store.kind === S.mode, '저장소 ' + A.store.kind + ' (기대 ' + S.mode + ')');
  check(JSON.stringify(A.courses.map((c) => c.id).sort()) === JSON.stringify(S.courses.slice().sort()), '실린 과정 ' + A.courses.map((c) => c.id).join(','));
  check(A.problems.length === (S.bad || 0), '싣지 못한 과정 ' + A.problems.length + ' (기대 ' + (S.bad || 0) + ')');
  check((A.cfg.edition) === S.edition, '판 ' + A.cfg.edition);
  const routes = ['#/today', '#/review', '#/check', '#/check/mwl', '#/checks', '#/wrong', '#/courses', '#/map/mwl', '#/stats', '#/stats/mwl', '#/glossary', '#/journal', '#/settings', '#/import/mwl', '#/import/merge', '#/restore/bad-name', '#/nope/x'];
  for (const r of routes) {
    await go(r);
    check(!!$('#app h1'), r + ': h1 없음');
    if (r !== '#/courses' && r !== '#/restore/bad-name') check(!errBox(), r + ': 오류 상자');
    if (r === '#/restore/bad-name') check(errBox(), r + ': 틀린 백업 이름인데 오류 상자가 없다');
    audit(r);
  }
  document.documentElement.setAttribute('data-theme', 'dark');
  for (const r of ['#/today', '#/stats', '#/settings']) { await go(r); audit(r + ' (어둡게)'); }
  document.documentElement.removeAttribute('data-theme');

  // 강의 마침
  let p = A.plan();
  const lesson = p.lesson;
  check(!!lesson, '계획에 강의가 없다');
  let n0 = A.events.length;
  await go('#/learn/' + lesson.course + '/' + lesson.id);
  audit('#/learn');
  check(!!$('#lesson-toc a') || !!$('#lesson-toc[hidden]'), '강의 목차');
  const ext = document.querySelectorAll('.lesson a[href^="http"]').length;
  await act('[data-action=lessonDone][data-c="3"]', '자신감 3');
  check(A.events.length === n0 + 2, '강의 마침 사건 2(lesson·session) — ' + (A.events.length - n0));
  check(location.hash === '#/today', '강의 마친 뒤 오늘로');
  // 외부 링크(판 설정): 실린 과정 가운데 마크다운 http 링크가 있는 강의를 찾아 그린다(MWL 은 주소를 글로만 써서 Learn 과정에서 찾는다)
  const mwl = A.course('mwl');
  let withLink = null;
  A.courses.some((c) => Object.keys(c.lessons || {}).some((id) => { if (/\]\(https?:\/\//.test(c.lessons[id].body || '')) { withLink = c.id + '/' + id; return true; } return false; }));
  check(!!withLink || S.courses.length === 1, '외부 링크가 있는 강의를 찾지 못했다');
  if (withLink) {
    await go('#/learn/' + withLink);
    const n = document.querySelectorAll('.lesson a[href^="http"]').length;
    if (S.edition === 'closed') check(n === 0, '폐쇄망판인데 외부 링크 ' + n + '개');
    else check(n > 0, '인터넷판인데 외부 링크가 없다');
    counts.ext_links = n; counts.ext_lesson = withLink;
  }
  counts.first_lesson_ext = ext;

  // 복습 — 단추 둘, 보류 하나, 키보드 하나
  await go('#/review');
  audit('#/review');
  const q = A.review ? A.review.queue.length : 0;
  check(q > 0, '복습 대기열이 비었다(강의를 마쳤는데)');
  n0 = A.events.length;
  for (let i = 0; i < 2; i++) { await act('[data-action=reveal]', '답 보기'); audit('#/review (답)'); await act('[data-action=grade][data-g=good]', 'good'); }
  await act('[data-action=hold]', '보류');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); await sleep(60);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true })); await sleep(60); await settle();
  check(byType('review').length === 3, '복습 사건 3(단추 2·키보드 1) — ' + byType('review').length);
  check(byType('card.hold').length === 1, '보류 사건 1');
  check(byType('review').filter((e) => e.data.grade === 'again').length === 1, '키보드 1 = again');
  counts.review_queue = q;

  // 퀴즈·점검
  const qz = Object.keys(mwl.quizzes || {}).sort()[0];
  if (qz) {
    await go('#/quiz/mwl/' + qz); audit('#/quiz');
    await submit('form[data-submit=quizSubmit]');
    check(byType('quiz').length === 1, '퀴즈 사건');
    check(/결과/.test(($('#app h1') || {}).textContent || ''), '퀴즈 결과 화면');
  }
  if ((mwl.diagnostic || []).length) {
    await go('#/check/mwl');
    await act('[data-action=checkStart][data-mode=baseline]', '기준선 시작');
    check(location.hash === '#/check/mwl/run', '점검 문항 화면');
    audit('#/check/run');
    await submit('form[data-submit=checkSubmit]', (f) => { const r = f.querySelector('input[type=radio]'); if (r) r.checked = true; });
    check(byType('check').length === 1, '점검 사건');
    check(/^#\/checks\/\d+$/.test(location.hash), '점검 기록 화면으로 — ' + location.hash);
    audit('#/checks/n');
  }
  // 설정·회고
  await go('#/settings');
  await submit('form[data-submit=settingsSubmit]', (f) => { f.querySelector('[name=weekday_minutes]').value = '40'; });
  check(A.settings().weekday_minutes === 40, '설정 사건(평일 40분)');
  await go('#/settings');
  check(!!$('[data-action=exportLog]') === (S.edition !== 'closed'), '기록 내려받기 단추 — 판 설정 export');
  await go('#/journal');
  await submit('form[data-submit=journalSubmit]', (f) => { f.querySelector('[name=summary]').value = '스모크 회고'; });
  check(byType('journal').length === 1, '회고 사건');
  // 주 과정 바꾸기·되돌리기, 보류 풀기
  const other = A.courses.filter((c) => c.kind !== 'notes' && c.id !== 'mwl')[0];
  if (other) {
    await go('#/courses');
    await act('[data-action=setMain][data-course="' + other.id + '"]', '주 과정 ' + other.id);
    check(A.plan().course === other.id, '주 과정이 바뀌었다');
    await act('[data-action=setMain][data-course="mwl"]', '주 과정 mwl');
  }
  await go('#/map/mwl');
  await act('[data-action=unhold]', '보류 풀기');
  check(Object.keys(A.st.held.mwl || {}).length === 0, '보류가 풀렸다');
  // 통계 — ①~⑥ 절과 차트
  await go('#/stats');
  check(document.querySelectorAll('#app section h2').length === 6, '통계 절 6개');
  check(document.querySelectorAll('#app svg.chart').length >= 2, '통계 차트');
  check(!!$('#app .stack span'), '카드 상태 막대');
  audit('#/stats (기록 뒤)');

  // MWL 진도 들여오기 — 두 번(멱등)
  window.confirm = () => true;
  async function importOnce() {
    await go('#/import/mwl');
    ML.importFile(new File([JSON.stringify(S.progress)], 'progress.json'));
    await waitFor(() => A.imp && A.imp.conv, 8000, '미리보기');
    await waitFor(() => !!$('[data-action=impRun]'), 4000, '들여오기 단추');
    audit('#/import/mwl (미리보기)');
    const fresh = A.imp.fresh;
    $('[data-action=impRun]').click();
    await waitFor(() => A.imp && A.imp.done, 15000, '들여오기 끝');
    await settle();
    return { fresh: fresh, done: A.imp.done };
  }
  const e1 = A.events.length;
  const i1 = await importOnce();
  const e2 = A.events.length;
  const i2 = await importOnce();
  const e3 = A.events.length;
  check(i1.fresh > 0 && i1.done.added === i1.fresh, '첫 들여오기 새 줄 ' + i1.fresh + ' · 더함 ' + (i1.done && i1.done.added));
  check(i1.done.verify.match === i1.done.verify.total && i1.done.verify.total > 0, '변환 일치 ' + i1.done.verify.match + '/' + i1.done.verify.total);
  check(i2.fresh === 0 && i2.done.added === 0 && e3 === e2, '두 번째 들여오기는 아무것도 더하지 않는다(멱등) — 새 ' + i2.fresh + ', 사건 ' + e2 + '→' + e3);
  check(e2 - e1 === i1.fresh, '사건 수가 새 줄만큼 늘었다');
  check(!!A.course('mwl-notes') === ((S.progress.knowledge || []).length > 0), '메모 과정');
  if (A.store.kind === 'browser' || A.store.kind === 'server') {
    const bl = await A.store.listBackups();
    check(bl.filter((b) => b.reason === 'import-mwl').length === 2, '들여오기 전 백업 2개 — ' + bl.map((b) => b.reason).join(','));
  }
  counts.import = { fresh1: i1.fresh, verify: i1.done.verify, now_mismatch: i1.done.now.mismatches.length, fresh2: i2.fresh };

  // ---------------------------------------------------------------- P4 — 교환 파일·합치기·되살리기·알림 띠
  if (S.edition !== 'closed') {
    let got = null;
    ML.platform = { kind: 'smoke', save: (name, bytes) => { got = { name: name, bytes: bytes }; return Promise.resolve(true); } };
    await go('#/settings');
    await act('[data-action=exportExchange]', '교환 파일 내보내기');
    await waitFor(() => !!got, 8000, '교환 파일');
    delete ML.platform;
    if (got) {
      const r = await ML.exchange.open(got.bytes, { inflateRaw: ML.inflateRaw });
      check(r.ok && r.kind === 'exchange', '내보낸 교환 파일을 다시 연다 ' + (r.error || ''));
      check(r.lines.length === A.events.length + A.raw.length, '교환 파일 줄 ' + r.lines.length + ' = 기록 ' + (A.events.length + A.raw.length));
      check(/^mylearner-exchange-\d{4}-\d{2}-\d{2}-[0-9a-f]{6}\.zip$/.test(got.name), '교환 파일 이름 ' + got.name);
      check(r.courses.some((c) => c.id === 'mwl-notes'), '교환 파일에 사용자 과정(mwl-notes)');
      check(!!localStorage.getItem('mylearner.exported'), '마지막 내보내기 시각');
      counts.exchange = { name: got.name, bytes: got.bytes.length, lines: r.lines.length, courses: r.courses.length };
    }
  } else {
    await go('#/settings');
    check(!$('[data-action=exportExchange]'), '폐쇄망판에 교환 파일 내보내기 단추가 있다');
    check(!!$('a[href="#/import/merge"]'), '폐쇄망판에 합치기 입구가 없다');
  }
  const phone = phoneExchange();
  async function mergeOnce() {
    await go('#/import/merge');
    audit('#/import/merge');
    ML.mergeFile(new File([phone.ex.bytes], phone.ex.name));
    await waitFor(() => A.mrg && (A.mrg.pv || A.mrg.error) && !A.mrg.busy, 8000, '합치기 미리보기');
    await waitFor(() => document.body.getAttribute('data-ready') === '1' && !!$('#app h2'), 4000, '미리보기 화면');
    audit('#/import/merge (미리보기)');
    return A.mrg;
  }
  const own0 = A.events.filter((e) => A.isOwn(e.dev)).length, all0 = A.events.length;
  const m1 = await mergeOnce();
  check(!m1.error, '합치기 미리보기 오류 ' + (m1.error && m1.error.error));
  check(m1.pv && m1.pv.fresh === phone.lines.length, '새 줄 ' + (m1.pv && m1.pv.fresh) + ' (기대 ' + phone.lines.length + ')');
  check(m1.courses && m1.courses.length === 1 && m1.courses[0].status === 'new', '새 사용자 과정');
  await act('[data-action=mergeRun]', '백업하고 합치기');
  await waitFor(() => A.mrg && A.mrg.done, 15000, '합치기 끝');
  const d1 = (A.mrg && A.mrg.done) || {};
  check(d1.added === phone.lines.length && d1.present && d1.present.present === phone.lines.length && d1.present.total === phone.lines.length,
    '합친 결과 ' + JSON.stringify({ added: d1.added, present: d1.present }));
  check(!!A.course('phone-notes'), '사용자 과정 저장');
  check(A.events.length === all0 + phone.lines.length, '사건이 새 줄만큼 늘었다');
  audit('#/import/merge (결과)');
  const m2 = await mergeOnce();
  check(m2.pv && m2.pv.fresh === 0 && !$('[data-action=mergeRun]'), '같은 파일 다시 — 새 줄 0(멱등)');
  check(m2.courses && m2.courses[0] && m2.courses[0].status === 'same', '같은 과정은 같음');
  async function restore(name) {
    await go('#/restore/' + encodeURIComponent(name));
    await waitFor(() => A.rst && A.rst.name === name && !A.rst.loading && document.body.getAttribute('data-ready') === '1' && !!$('[data-action=restoreRun]'), 8000, '되살리기 미리보기 ' + name);
    audit('#/restore (미리보기)');
    const plan = A.rst.plan;
    await act('[data-action=restoreRun]', '백업하고 되살리기');
    await waitFor(() => A.rst && A.rst.done, 15000, '되살리기 끝');
    return { plan: plan, done: A.rst.done };
  }
  const u1 = d1.backup ? await restore(d1.backup) : { plan: {}, done: {} };
  check(u1.plan.remove && u1.plan.remove.length === phone.lines.length, '되돌리기 — 뺄 줄 ' + (u1.plan.remove && u1.plan.remove.length));
  check(A.events.filter((e) => e.dev === PHONE).length === 0, '되돌린 뒤 폰 줄이 남았다');
  check(A.events.filter((e) => A.isOwn(e.dev)).length === own0, '되돌려도 이 기기 줄은 그대로');
  const u2 = u1.done.backup ? await restore(u1.done.backup) : { plan: {}, done: {} };
  check(u2.plan.add === phone.lines.length, '되살리기 전으로 다시 — 돌아올 줄 ' + u2.plan.add);
  check(A.events.filter((e) => e.dev === PHONE).length === phone.lines.length, '되살리기 전으로 다시 — 폰 줄이 돌아왔다');
  const stored = await A.store.loadLog();
  check(phone.lines.every((l) => stored.indexOf(l) >= 0), '저장소에도 폰 줄이 있다');
  const bl2 = await A.store.listBackups();
  check(bl2.filter((b) => b.reason === 'import-merge').length === 1 && bl2.filter((b) => b.reason === 'restore').length === 2, '합치기 전 백업 1 · 되살리기 전 백업 2 — ' + bl2.map((b) => b.reason).join(','));
  counts.merge = { fresh: m1.pv && m1.pv.fresh, present: d1.present, undo_removed: u1.done.removed, redo_added: u2.done.added };
  // 내보내기 알림 띠 — 판 설정 날 수(모바일판 7)를 넘게 내보내지 않았을 때만
  const cfg0 = { days: A.cfg.remind_export_days, exp: A.cfg.export };
  A.cfg.remind_export_days = 7; A.cfg.export = true;
  localStorage.setItem('mylearner.exported', new Date(Date.now() - 10 * 86400000).toISOString());
  await go('#/today');
  check(!!$('.notice.remind'), '내보내기 알림 띠가 없다(10일 전)');
  audit('#/today (알림 띠)');
  localStorage.setItem('mylearner.exported', new Date().toISOString());
  await go('#/today');
  check(!$('.notice.remind'), '방금 내보냈는데 알림 띠가 있다');
  A.cfg.remind_export_days = cfg0.days; A.cfg.export = cfg0.exp;
  localStorage.removeItem('mylearner.exported');

  // 쓰는 탭 임대 — 다른 탭이 쓰는 중이면 기록을 만들지 않는다(독립 점검 S1·S8), 넘겨받은 뒤에 다시 한다
  localStorage.setItem('mylearner.writer', JSON.stringify({ id: 'other-tab', at: Date.now() }));
  const j0 = byType('journal').length, n0lease = A.events.length;
  await go('#/journal');
  await submit('form[data-submit=journalSubmit]', (f) => { f.querySelector('[name=summary]').value = '임대 시험'; }, true);
  await sleep(50);
  check(A.events.length === n0lease && A.pending.length === 0 && A.writer === 'other', '다른 탭이 쓰는 중 — 사건을 만들지 않는다(사건 ' + (A.events.length - n0lease) + ', 남은 ' + A.pending.length + ', ' + A.writer + ')');
  check(/다른 탭이 기록을 쓰고/.test(($('#banner') || {}).textContent || ''), '알림 띠');
  await go('#/today');
  check(!!$('.ro-band [data-action=takeover]'), '읽기 전용 띠');
  await act('[data-action=takeover]', '이 탭에서 쓰기');
  check(A.writer === 'mine', '넘겨받았다');
  await go('#/journal');
  await submit('form[data-submit=journalSubmit]', (f) => { f.querySelector('[name=summary]').value = '임대 시험'; });
  check(byType('journal').length === j0 + 1 && A.pending.length === 0, '넘겨받은 뒤에는 저장');

  // 닫을 때(pagehide) 내 임대를 놓는다 — 다시 연 탭이 곧바로 쓴다
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  check(localStorage.getItem('mylearner.writer') === null, '닫을 때 임대를 놓지 않았다');
  await go('#/journal');
  await submit('form[data-submit=journalSubmit]', (f) => { f.querySelector('[name=summary]').value = '임대를 놓은 뒤'; });
  check(A.pending.length === 0 && JSON.parse(localStorage.getItem('mylearner.writer') || '{}').id === A.tabId, '놓은 뒤 다시 쓰면 임대를 다시 잡는다');

  // 상태를 바꾸는 주소가 기록을 바꾸지 않는다(P2 설계서 7절)
  const before = A.events.length;
  for (const r of ['#/check/mwl/run', '#/import/mwl', '#/import/merge', '#/review', '#/settings']) await go(r);
  check(A.events.length === before, '주소만으로 사건이 생겼다');

  // 저장이 실패한 줄은 탭 키에 남긴다 — 이 탭을 그대로 닫고, persist 단계가 되살려 저장하는지 본다(독립 점검 S8)
  const realAppend = A.store.append;
  A.store.append = () => Promise.reject(new Error('시험 - 저장 실패'));
  await go('#/journal');
  await submit('form[data-submit=journalSubmit]', (f) => { f.querySelector('[name=summary]').value = '저장 실패 시험'; }, true);
  await sleep(100);
  const mk = JSON.parse(localStorage.getItem('mylearner.pending.' + A.tabId) || '[]');
  check(A.pending.length === 1 && mk.length === 1 && mk[0] === A.pending[0], '저장 못 한 줄을 탭 키에 적었다(' + A.pending.length + '/' + mk.length + ')');
  counts.left_pending = A.pending.length;
  A.store.append = realAppend;
  A.pending.length = 0;   // 이 탭은 '닫힌' 것으로 친다 — 메모리의 줄은 버리고 탭 키만 남긴다

  const t0 = performance.now(); await go('#/today'); timings.today_ms = Math.round(performance.now() - t0);
  if (S.mode === 'server') { const r = await fetch('/api/log', { credentials: 'same-origin' }); counts.server_lines = (await r.text()).trim().split('\n').length - 1; }
  counts.events = A.events.length;
  counts.by_type = A.events.reduce((m, e) => { m[e.type] = (m[e.type] || 0) + 1; return m; }, {});
  const lines = A.events.map((e) => e.line);
  localStorage.setItem('smoke.expect', JSON.stringify(lines));
  return { problems, a11y, counts, timings, lines };
})()
