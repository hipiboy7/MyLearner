// 헤드리스 Chromium 을 CDP(DevTools 프로토콜)로 몰아 페이지를 열고, 조건이 될 때까지 기다린 뒤 결과를 모은다.
// 외부 패키지 없이 Node 22 이상의 내장 WebSocket 만 쓴다(Playwright 이미지의 Node 24 에서 돈다).
// 입력:  node cdp.js <job.json> <out.json>
//        job = {"profile": "/tmp/p", "steps": [{"url", "timeout", "ready"?, "inject"?: [파일], "shots": [{"path", "width", "height"}]}]}
//        ready  = 기다릴 조건 식(기본 document.body.dataset.done === "1"). inject = 준비된 뒤 차례로 넣어 돌릴 JS 파일들 —
//        마지막 파일은 약속(JSON 으로 바꿀 수 있는 값)을 내는 식이어야 한다. 그 값이 result 다(CSP 는 DevTools 평가에 걸리지 않는다)
//        단계마다 브라우저 프로세스를 새로 띄운다(같은 프로필) — '크롬을 닫았다 다시 연' 것과 같다.
// 출력:  out.json = [{"url", "done", "selftest", "code", "result", "exceptions", "console", "log", "shots"}] — log = 브라우저 오류 기록(CSP 위반·못 읽은 파일 등)
// 트리거: scripts/browser_smoke.py·render_smoke.py 가 Docker 안에서 부른다. 문서: docs/P1_설계서_Probe.md 3.6절
// 실패는 종료 코드 1 과 까닭(브라우저 종료 코드·신호·stderr 끝)으로 낸다. 브라우저가 도중에 죽어 CDP 응답이
// 오지 않으면 Node 는 이벤트 루프가 비어 out.json 없이 종료 코드 0 으로 끝난다 — 연결이 끊기면 기다리던 요청을
// 모두 실패시키고, 결과를 쓰기 전에 루프가 비면 1 로 끝낸다(트러블슈팅 T-009)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function findChrome() {
  const root = '/ms-playwright';
  for (const d of fs.readdirSync(root).sort()) {
    if (d.startsWith('chromium_headless_shell-')) {
      const p = path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('chrome-headless-shell 을 찾지 못했다');
}

function launch(chrome, profile) {
  return new Promise((resolve, reject) => {
    const proc = spawn(chrome, ['--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + profile,
      '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let buf = '';
    const state = { why: () => 'stderr 끝: ' + buf.slice(-600) };
    const timer = setTimeout(() => reject(new Error('브라우저가 뜨지 않았다: ' + buf.slice(-400))), 20000);
    proc.stderr.on('data', (d) => {
      buf = (buf + d.toString()).slice(-4000);
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve({ proc, ws: m[1], state }); }
    });
    proc.on('exit', (code, signal) => {
      state.why = () => '브라우저 종료 코드 ' + code + ' · 신호 ' + signal + ' · stderr 끝: ' + buf.slice(-600);
      clearTimeout(timer);
      reject(new Error('브라우저가 끝났다: ' + state.why()));
    });
  });
}

function connect(url, why) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    let closed = false;
    const waiting = new Map();
    const listeners = [];
    ws.onclose = () => {                         // 기다리던 요청이 영영 안 끝나 루프가 비는 것을 막는다
      closed = true;
      setTimeout(() => {                         // 연결이 프로세스 종료 알림보다 먼저 끊긴다 — 종료 코드를 잠깐 기다린다
        const err = new Error('CDP 연결이 끊겼다 — ' + why());
        for (const { rej } of waiting.values()) rej(err);
        waiting.clear();
        reject(err);
      }, 300);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && waiting.has(msg.id)) {
        const { res, rej } = waiting.get(msg.id);
        waiting.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
      } else if (msg.method) {
        listeners.forEach((fn) => fn(msg));
      }
    };
    ws.onerror = () => reject(new Error('WebSocket 오류'));
    ws.onopen = () => resolve({
      send(method, params, sessionId) {
        return new Promise((res, rej) => {
          if (closed) { rej(new Error('CDP 연결이 끊겼다 — ' + why())); return; }
          id += 1;
          waiting.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
        });
      },
      on(fn) { listeners.push(fn); },
      isClosed() { return closed; },
      close() { ws.close(); },
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 경주(race)에 쓰는 기다림은 unref — 진 쪽 타이머가 일이 끝난 뒤에도 Node 를 붙잡아 단계마다 수십 초씩 늦어졌다(T-011)
const idle = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
// 브라우저가 끝나기를 기다린다 — 이미 끝났으면 바로(exit 알림이 다시 오지 않는다), 아니면 끝나거나 ms 가 지나면. 타이머는 끝나면 푼다.
// unref 한 기다림으로 두었더니 이미 끝난 브라우저를 기다리는 동안 루프가 비어 '결과를 쓰기 전에 이벤트 루프가 비었다'로 끝났다(T-011)
function waitExit(proc, ms) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((r) => { const t = setTimeout(r, ms); proc.once('exit', () => { clearTimeout(t); r(); }); });
}

async function runStep(chrome, profile, step) {
  const out = { url: step.url, done: false, selftest: null, code: null, result: null, exceptions: [], console: [], log: [], shots: [] };
  const { proc, ws, state } = await launch(chrome, profile);
  const cdp = await connect(ws, () => state.why());
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    cdp.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        out.exceptions.push((d.exception && d.exception.description) || d.text);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        out.console.push(msg.params.args.map((a) => a.value || a.description).join(' '));
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {   // CSP 위반·못 읽은 파일은 여기로 온다(log — 화면 스모크가 본다)
        out.log.push('[' + msg.params.entry.source + '] ' + msg.params.entry.text);
      }
    });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    if (step.width) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: step.width, height: step.height || 900,
        deviceScaleFactor: 1, mobile: step.width < 600 }, sessionId);
    }
    await cdp.send('Page.navigate', { url: step.url }, sessionId);
    const until = Date.now() + (step.timeout || 60000);
    const ready = step.ready || 'document.body && document.body.dataset.done === "1"';
    while (Date.now() < until) {
      const r = await cdp.send('Runtime.evaluate', { expression: '!!(' + ready + ')',
        returnByValue: true }, sessionId).catch((e) => { if (cdp.isClosed()) throw e; return null; });
      if (r && r.result && r.result.value) { out.done = true; break; }
      await sleep(200);
    }
    if (out.done && step.inject) {
      for (const file of step.inject) {
        const r = await cdp.send('Runtime.evaluate', { expression: fs.readFileSync(file, 'utf8'), awaitPromise: true, returnByValue: true,
          timeout: step.timeout || 60000 }, sessionId);
        if (r.exceptionDetails) out.exceptions.push('inject ' + path.basename(file) + ': ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
        else out.result = r.result.value === undefined ? out.result : r.result.value;
      }
    }
    const r = await cdp.send('Runtime.evaluate', { returnByValue: true, expression:
      'JSON.stringify({s: (document.getElementById("selftest") || {}).textContent || null, c: (document.getElementById("code") || {}).textContent || null})' },
      sessionId);
    const got = JSON.parse(r.result.value);
    out.selftest = got.s ? JSON.parse(got.s) : null;
    out.code = got.c;
    if ((step.shots || []).length) await cdp.send('Page.bringToFront', {}, sessionId).catch(() => null);   // 뒤에 있는 탭은 그림을 그리지 않아 찍기가 오래 기다렸다(T-011)
    for (const shot of step.shots || []) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height,
        deviceScaleFactor: 1, mobile: shot.width < 600 }, sessionId);
      await sleep(300);
      const lm = await cdp.send('Page.getLayoutMetrics', {}, sessionId);
      // 전체 화면은 보이는 창을 내용 높이로 늘려 찍는다 — captureBeyondViewport 는 긴 화면(390px 의 강의)에서 수십 초 걸리거나 멈췄다.
      // 높이를 자르고, 찍기에도 시한을 둔다(트러블슈팅 T-011)
      const h = Math.max(shot.height, Math.min(Math.ceil((lm.cssContentSize || lm.contentSize).height), shot.maxHeight || 4000));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: h, deviceScaleFactor: 1, mobile: shot.width < 600 }, sessionId);
      await sleep(300);
      const img = await Promise.race([
        cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId),
        idle(30000).then(() => { throw new Error('스크린샷이 30초 안에 끝나지 않았다: ' + shot.path); })]);
      fs.writeFileSync(shot.path, Buffer.from(img.data, 'base64'));
      out.shots.push(shot.path);
    }
    await cdp.send('Browser.close').catch(() => null);
  } finally {
    cdp.close();
    await waitExit(proc, 5000);
    if (proc.exitCode === null) proc.kill('SIGKILL');
  }
  return out;
}

async function main() {
  const [jobPath, outPath] = process.argv.slice(2);
  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const chrome = findChrome();
  fs.mkdirSync(job.profile, { recursive: true });
  for (const c of job.copies || []) {           // file:// 공유 시험용 사본
    fs.mkdirSync(path.dirname(c.to), { recursive: true });
    fs.copyFileSync(c.from, c.to);
  }
  const results = [];
  for (const step of job.steps) results.push(await runStep(chrome, job.profile, step));
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  written = true;
}

let written = false;
process.on('beforeExit', () => {               // 끝나지 않는 약속만 남아 루프가 비었다 — 0 으로 끝내지 않는다
  if (!written) { console.error('결과를 쓰기 전에 이벤트 루프가 비었다(브라우저·CDP 응답 없음)'); process.exitCode = 1; }
});

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
