// 헤드리스 Chromium 을 CDP(DevTools 프로토콜)로 몰아 페이지를 열고, 조건이 될 때까지 기다린 뒤 결과를 모은다.
// 외부 패키지 없이 Node 22 이상의 내장 WebSocket 만 쓴다(Playwright 이미지의 Node 24 에서 돈다).
// 입력:  node cdp.js <job.json> <out.json>
//        job = {"profile": "/tmp/p", "steps": [{"url", "timeout", "shots": [{"path", "width", "height"}]}]}
//        단계마다 브라우저 프로세스를 새로 띄운다(같은 프로필) — '크롬을 닫았다 다시 연' 것과 같다.
// 출력:  out.json = [{"url", "done", "selftest", "code", "exceptions", "console", "shots"}]
// 트리거: scripts/browser_smoke.py 가 Docker 안에서 부른다. 문서: docs/P1_설계서_Probe.md 3.6절
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
    const timer = setTimeout(() => reject(new Error('브라우저가 뜨지 않았다: ' + buf.slice(-400))), 20000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve({ proc, ws: m[1] }); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error('브라우저가 끝났다: ' + code)); });
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const waiting = new Map();
    const listeners = [];
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
          id += 1;
          waiting.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
        });
      },
      on(fn) { listeners.push(fn); },
      close() { ws.close(); },
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runStep(chrome, profile, step) {
  const out = { url: step.url, done: false, selftest: null, code: null, exceptions: [], console: [], shots: [] };
  const { proc, ws } = await launch(chrome, profile);
  const cdp = await connect(ws);
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
      }
    });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    if (step.width) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: step.width, height: step.height || 900,
        deviceScaleFactor: 1, mobile: step.width < 600 }, sessionId);
    }
    await cdp.send('Page.navigate', { url: step.url }, sessionId);
    const until = Date.now() + (step.timeout || 60000);
    while (Date.now() < until) {
      const r = await cdp.send('Runtime.evaluate', { expression: '!!(document.body && document.body.dataset.done === "1")',
        returnByValue: true }, sessionId).catch(() => null);
      if (r && r.result && r.result.value) { out.done = true; break; }
      await sleep(200);
    }
    const r = await cdp.send('Runtime.evaluate', { returnByValue: true, expression:
      'JSON.stringify({s: (document.getElementById("selftest") || {}).textContent || null, c: (document.getElementById("code") || {}).textContent || null})' },
      sessionId);
    const got = JSON.parse(r.result.value);
    out.selftest = got.s ? JSON.parse(got.s) : null;
    out.code = got.c;
    for (const shot of step.shots || []) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height,
        deviceScaleFactor: 1, mobile: shot.width < 600 }, sessionId);
      await sleep(300);
      const lm = await cdp.send('Page.getLayoutMetrics', {}, sessionId);
      const h = Math.ceil((lm.cssContentSize || lm.contentSize).height);
      const img = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: shot.width, height: h, scale: 1 } }, sessionId);
      fs.writeFileSync(shot.path, Buffer.from(img.data, 'base64'));
      out.shots.push(shot.path);
    }
    await cdp.send('Browser.close').catch(() => null);
  } finally {
    cdp.close();
    await Promise.race([new Promise((r) => proc.on('exit', r)), sleep(5000)]);
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
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
