#!/usr/bin/env python3
"""안드로이드 에뮬레이터 시험(등급 C, P4 FR-471·NFR-403) — 실제 안드로이드(API 36, x86_64, KVM, 머리 없이, 네트워크 없음)의 WebView 에
시험용 APK(build_android.sh --test-key --debuggable)를 설치하고, WebView DevTools(CDP)로 화면을 눌러 본다. VM 과 GitHub Actions 가 같이 쓴다.

표준 라이브러리만. 두 겹으로 돈다:
  호스트:  python3 mobile/android/e2e/emulator_test.py <APK> <캡처 폴더> [--fetch] [--keep]
           시스템 이미지를 Docker 볼륨 mylearner-android-<uid>(Docker 데이터 = /data)에 받고(--fetch 이거나 없을 때만 — 네트워크),
           에뮬레이터 컨테이너(ANDROID_IMAGE · --device /dev/kvm · --network none)를 켜서 같은 파일을 --inside 로 돌린다. 끝나면 컨테이너를 지운다.
  안:      adb 로 설치·권한·비행기 모드·켜기 → CDP 로 오늘·강의 마침·복습 → 채점 직후 강제 종료 → 다시 켜도 그 사건이 있다(파일 KV — FR-410)
           → 앱 파일(run-as) → 회전에도 화면을 다시 만들지 않는다 → 교환 파일 '파일로 저장'(시스템 저장 창) → 다운로드 폴더의 zip 을 열어 머리·줄 수
           → 뒤로 가기(오늘에서 닫힘) → 크래시·스크립트 오류 0. 캡처(PNG)는 <캡처 폴더>
출력: 표준 출력에 ✓/✗ 줄과 끝에 '에뮬레이터 시험 N건 통과 · 실패 M건'. 실패가 있으면 종료 코드 1. 기록 내용·토큰은 찍지 않는다(Actions 로그는 공개)
문서: docs/P4_설계서_Mobile.md 3.9·3.10절. MWL mobile/android/e2e/emulator_test.py(MiddlewareLearner@e55b9c0)의 흐름을 본떴다(누르기는 CDP 로 바꿨다)
"""
from __future__ import annotations

import base64
import json
import os
import re
import socket
import subprocess
import sys
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PKG = "io.github.hipiboy7.mylearningplatform"
ACT = PKG + "/.MainActivity"
SYSIMG = "system-images;android-36;default;x86_64"
SDK = "/opt/android-sdk-linux"
CDP_PORT = 9333
PASS = 0
FAIL = 0


def ok(name: str, cond: bool, extra: str = "") -> bool:
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  OK   %s" % name, flush=True)
    else:
        FAIL += 1
        print("  FAIL %s%s" % (name, (" - " + extra[:300]) if extra else ""), flush=True)
    return cond


def run(cmd, check=True, timeout=180, text=True):
    r = subprocess.run(cmd, capture_output=True, timeout=timeout, text=text)
    if check and r.returncode != 0:
        raise SystemExit("명령 실패(%d): %s\n%s" % (r.returncode, " ".join(cmd), (r.stderr or r.stdout)[-1500:]))
    return r


# ---------------------------------------------------------------- 호스트 쪽
def dev_tools() -> dict:
    out = {}
    for line in (ROOT / "scripts" / "dev_tools.env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"')
    return out


def host(apk: Path, shots: Path, fetch: bool, keep: bool) -> int:
    image = dev_tools()["ANDROID_IMAGE"]
    vol = "mylearner-android-%d" % os.getuid()
    name = "mylearner-emu-%d" % os.getuid()
    shots.mkdir(parents=True, exist_ok=True)
    run(["docker", "volume", "create", vol])
    have = run(["docker", "run", "--rm", "--network", "none", "-v", "%s:/img" % vol, image, "sh", "-c",
                "test -f /img/android-36/default/x86_64/system.img && echo yes || echo no"]).stdout.strip() == "yes"
    if fetch or not have:
        print("== 시스템 이미지 받기(%s) — 이 단계만 네트워크를 쓴다" % SYSIMG, flush=True)
        env = []
        for k in ("HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"):
            if os.environ.get(k):
                env += ["-e", k]
        run(["docker", "run", "--rm"] + env + ["-v", "%s:%s/system-images" % (vol, SDK), image, "sh", "-c",
             "yes | sdkmanager --install '%s' >/dev/null && du -sh %s/system-images/android-36" % (SYSIMG, SDK)], timeout=1800)
    run(["docker", "rm", "-f", name], check=False)
    print("== 에뮬레이터 켜기(API 36 · x86_64 · KVM · 네트워크 없음)", flush=True)
    # -gpu swangle_indirect: 기본 소프트웨어 GL(swiftshader_indirect)은 JIT 코드를 힙에 두는데 이 VM 의 컨테이너(SELinux)는 힙에 실행 권한을 주지 않아
    #   게스트가 그리기 시작할 때 세그폴트(종료 139)로 죽었다(2026-11-10 재현 — MWL emulator_test.py 가 먼저 찾은 것과 같다). ANGLE + Vulkan SwiftShader 는 된다
    # -feature -ModemSimulator: 모뎀 시뮬레이터는 ::1 로 붙는데 네트워크 없는 컨테이너에서는 그 주소 풀이가 거절된다(로그 'address resolution failed for ::1')
    # -change-locale ko-KR: 사용자 폰(갤럭시, 한국어)처럼 — 시스템 저장 창의 단추가 '저장'이다
    boot = ("set -e; export ANDROID_AVD_HOME=/tmp/avd; mkdir -p $ANDROID_AVD_HOME; "
            "echo no | avdmanager create avd -n t -k '%s' -d pixel_6 >/dev/null; "
            "printf 'hw.ramSize=2048\\nhw.gpu.enabled=yes\\nhw.gpu.mode=swangle_indirect\\nhw.keyboard=no\\nhw.gsmModem=no\\nhw.audioInput=no\\n"
            "hw.camera.back=none\\nhw.camera.front=none\\ndisk.dataPartition.size=2G\\nfastboot.forceColdBoot=yes\\n' >> $ANDROID_AVD_HOME/t.avd/config.ini; "
            "exec emulator -avd t -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics -wipe-data -gpu swangle_indirect -accel on -memory 2048 "
            "-feature -ModemSimulator -change-locale ko-KR -timezone Asia/Seoul >/tmp/emu.log 2>&1" % SYSIMG)
    run(["docker", "run", "-d", "--name", name, "--network", "none", "--device", "/dev/kvm",
         "-v", "%s:%s/system-images:ro" % (vol, SDK), "-v", "%s:/src:ro" % ROOT, "-v", "%s:/apk/app.apk:ro" % apk.resolve(),
         "-v", "%s:/shots" % shots.resolve(), image, "sh", "-c", boot])
    try:
        r = subprocess.run(["docker", "exec", name, "python3", "/src/mobile/android/e2e/emulator_test.py", "--inside"], timeout=2400)
        rc = r.returncode
    except subprocess.TimeoutExpired:
        print("시간 초과(40분)")
        rc = 1
    if rc != 0:
        tail = run(["docker", "exec", name, "sh", "-c", "tail -20 /tmp/emu.log"], check=False).stdout
        print("에뮬레이터 로그 끝:\n" + tail)
    if not keep:
        run(["docker", "rm", "-f", name], check=False)
    return rc


# ---------------------------------------------------------------- 안쪽(에뮬레이터 컨테이너)
ADB = SDK + "/platform-tools/adb"


def adb(*args, check=True, timeout=120, text=True):
    return run([ADB] + list(args), check=check, timeout=timeout, text=text)


def sh(cmd: str, check=True, timeout=120) -> str:
    return adb("shell", cmd, check=check, timeout=timeout).stdout


class WS:
    """CDP 용 최소 웹소켓 클라이언트(RFC 6455 — 글 프레임·마스킹·조각 모으기). 표준 라이브러리만"""

    def __init__(self, port: int, path: str):
        # WebView 가 주는 주소는 호스트가 빈 'ws:///devtools/page/<id>' 다 — adb 로 넘긴 127.0.0.1:<port> 에 경로만 쓴다
        self.s = socket.create_connection(("127.0.0.1", port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(("GET %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (path, port, key)).encode())
        head = b""
        while b"\r\n\r\n" not in head:
            head += self.s.recv(1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise RuntimeError("웹소켓 연결 실패: %r" % head[:80])
        self.n = 0
        self.events = []

    def _recv(self, n: int) -> bytes:
        b = b""
        while len(b) < n:
            c = self.s.recv(n - len(b))
            if not c:
                raise RuntimeError("웹소켓이 닫혔다")
            b += c
        return b

    def _frame(self):
        h = self._recv(2)
        op, ln = h[0] & 0x0F, h[1] & 0x7F
        if ln == 126:
            ln = int.from_bytes(self._recv(2), "big")
        elif ln == 127:
            ln = int.from_bytes(self._recv(8), "big")
        return h[0] & 0x80, op, self._recv(ln)

    def send(self, obj) -> None:
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        hdr = bytes([0x81])
        if len(data) < 126:
            hdr += bytes([0x80 | len(data)])
        elif len(data) < 65536:
            hdr += bytes([0x80 | 126]) + len(data).to_bytes(2, "big")
        else:
            hdr += bytes([0x80 | 127]) + len(data).to_bytes(8, "big")
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        buf = b""
        while True:
            fin, op, data = self._frame()
            if op == 9:   # ping
                continue
            if op == 8:
                raise RuntimeError("웹소켓이 닫혔다")
            buf += data
            if fin:
                return json.loads(buf.decode("utf-8"))

    def call(self, method: str, params=None, timeout=60):
        self.n += 1
        my = self.n
        self.send({"id": my, "method": method, "params": params or {}})
        end = time.time() + timeout
        while time.time() < end:
            msg = self.recv()
            if msg.get("id") == my:
                if "error" in msg:
                    raise RuntimeError("CDP %s: %s" % (method, msg["error"]))
                return msg.get("result", {})
            self.events.append(msg)
        raise RuntimeError("CDP %s 시간 초과" % method)

    def js(self, expr: str, timeout=60):
        r = self.call("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True}, timeout=timeout)
        if r.get("exceptionDetails"):
            raise RuntimeError("JS 예외: %s" % json.dumps(r["exceptionDetails"])[:300])
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass


def wait(fn, secs: float, what: str, step=0.5):
    end = time.time() + secs
    last = None
    while time.time() < end:
        try:
            v = fn()
            if v:
                return v
        except Exception as e:   # noqa: BLE001 — 아직 준비 안 됨
            last = e
        time.sleep(step)
    raise RuntimeError("기다리다 시간 초과: %s%s" % (what, (" (%s)" % last) if last else ""))


def pid() -> str:
    return sh("pidof %s" % PKG, check=False).strip()


def connect() -> WS:
    p = wait(pid, 30, "앱 프로세스")
    sock = "webview_devtools_remote_%s" % p
    wait(lambda: sock in sh("cat /proc/net/unix", check=False), 30, "WebView DevTools 소켓")
    adb("forward", "--remove-all", check=False)
    adb("forward", "tcp:%d" % CDP_PORT, "localabstract:" + sock)

    def page():
        with socket.create_connection(("127.0.0.1", CDP_PORT), timeout=5) as s:
            s.sendall(b"GET /json HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            data = b""
            while True:
                c = s.recv(65536)
                if not c:
                    break
                data += c
                if data.count(b"[") and data.rstrip().endswith(b"]"):
                    break
        lst = json.loads(data.split(b"\r\n\r\n", 1)[1].decode())
        return [x for x in lst if x.get("type") == "page" and "appassets" in x.get("url", "")]
    pages = wait(page, 30, "화면 페이지")
    ws = WS(CDP_PORT, re.sub(r"^ws://[^/]*", "", pages[0]["webSocketDebuggerUrl"]))
    wait(lambda: ws.js("document.body && document.body.getAttribute('data-ready') === '1' && !!(window.MyLearner && MyLearner.app && MyLearner.app.ready)"),
         60, "화면 준비")
    return ws


def launch() -> WS:
    adb("shell", "am", "start", "-W", "-n", ACT)
    return connect()


def go(ws: WS, hash_: str) -> None:
    ws.js("document.body.setAttribute('data-ready','0'); if (location.hash === %s) MyLearner.route(); else location.hash = %s; true" % (json.dumps(hash_), json.dumps(hash_)))
    wait(lambda: ws.js("document.body.getAttribute('data-ready') === '1'"), 20, "화면 " + hash_)


def click(ws: WS, sel: str) -> bool:
    return bool(ws.js("(function(){var e=document.querySelector(%s); if(!e) return false; e.click(); return true;})()" % json.dumps(sel)))


def shot(name: str) -> None:
    time.sleep(1.5)   # 소프트웨어 GL 이라 화면이 바뀐 뒤 그림이 늦게 나온다 — 바로 찍으면 앞 화면이 찍혔다
    png = adb("exec-out", "screencap", "-p", text=False).stdout
    Path("/shots/%s.png" % name).write_bytes(png)


def ui_tap(pattern: str, secs=20) -> bool:
    """시스템 화면(저장 창)에서 글자로 단추를 찾아 누른다 — uiautomator 덤프"""
    rx = re.compile(pattern)

    def find():
        sh("uiautomator dump /sdcard/ui.xml >/dev/null 2>&1", check=False)
        xml = sh("cat /sdcard/ui.xml", check=False)
        for m in re.finditer(r'<node [^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
            if rx.fullmatch(m.group(1)):
                return m
        return None
    m = wait(find, secs, "단추 " + pattern, step=1)
    x, y = (int(m.group(2)) + int(m.group(4))) // 2, (int(m.group(3)) + int(m.group(5))) // 2
    sh("input tap %d %d" % (x, y))
    return True


def inside() -> int:
    print("== 부팅 기다리기", flush=True)
    adb("wait-for-device", timeout=300)
    wait(lambda: sh("getprop sys.boot_completed", check=False).strip() == "1", 600, "부팅", step=3)
    # -change-locale 은 부팅 직후 프레임워크를 한 번 다시 띄운다 — system_server 의 pid 가 20초 동안 그대로면 안정으로 본다(MWL 실측)
    seen = {"pid": None, "since": time.time()}

    def stable():
        p = sh("pidof system_server", check=False).strip()
        if p != seen["pid"]:
            seen["pid"], seen["since"] = p, time.time()
        return bool(p) and time.time() - seen["since"] >= 20 and sh("getprop sys.boot_completed", check=False).strip() == "1"
    wait(stable, 300, "프레임워크 안정", step=2)
    sh("settings put global window_animation_scale 0; settings put global transition_animation_scale 0; settings put global animator_duration_scale 0", check=False)
    sh("input keyevent 82", check=False)   # 잠금 화면 풀기
    print("== 설치·판·권한", flush=True)
    r = adb("install", "-r", "/apk/app.apk", timeout=240, check=False)
    if "INSTALL_FAILED_UPDATE_INCOMPATIBLE" in (r.stdout + r.stderr):
        # 시험 키는 빌드마다 새로 만든다 — 앞 시험의 앱이 남아 있으면 키가 달라 덮어 설치가 안 된다(폰에서도 같다: 같은 키여야 덮어 설치). 지우고 깐다
        adb("uninstall", PKG, check=False)
        r = adb("install", "/apk/app.apk", timeout=240, check=False)
    ok("설치", "Success" in r.stdout, (r.stdout + r.stderr)[-200:])
    dump = sh("dumpsys package %s" % PKG)
    ver = re.search(r"versionName=(\S+)", dump)
    ok("판 " + (ver.group(1) if ver else "?"), bool(ver))
    req = re.search(r"requested permissions:\n((?:\s+\S.*\n)*)", dump)
    ok("요청 권한 0(인터넷 포함)", not req or not req.group(1).strip(), (req.group(1) if req else "")[:200])
    sh("cmd connectivity airplane-mode enable", check=False)
    sh("settings put global airplane_mode_on 1", check=False)
    ok("비행기 모드", sh("settings get global airplane_mode_on", check=False).strip() == "1")

    print("== 첫 화면", flush=True)
    ws = launch()
    info = ws.js("({kind: MyLearner.app.store.kind, edition: MyLearner.app.cfg.edition, platform: MyLearner.platform && MyLearner.platform.kind,"
                 " courses: MyLearner.app.courses.length, where: MyLearner.app.where, shell: document.documentElement.getAttribute('data-shell'), h1: (document.querySelector('#app h1')||{}).textContent})")
    ok("저장소 = android(파일 KV)", info.get("kind") == "android", str(info))
    ok("판 = 모바일판", info.get("edition") == "mobile")
    ok("셸·플랫폼 훅", info.get("shell") == "android" and info.get("platform") == "android")
    ok("과정 실림(%s개)" % info.get("courses"), (info.get("courses") or 0) >= 1)
    ok("읽기 전용 띠 없음(쓰는 곳 하나 — T-014)", ws.js("MyLearner.app.writer === 'mine' && !document.querySelector('.ro-band')"))
    shot("01-today")

    print("== 강의 마침·복습 → 채점 직후 강제 종료", flush=True)
    n0 = ws.js("MyLearner.app.events.length")
    lesson = ws.js("(function(){var p=MyLearner.app.plan(); return p.lesson ? p.lesson.course + '/' + p.lesson.id : null;})()")
    ok("계획에 강의", bool(lesson))
    if lesson:
        go(ws, "#/learn/" + lesson)
        shot("02-learn")
        click(ws, '[data-action=lessonDone][data-c="3"]')
        wait(lambda: ws.js("MyLearner.app.events.length") >= n0 + 2 and ws.js("MyLearner.app.pending.length") == 0, 20, "강의 사건")
    wait(lambda: ws.js("location.hash") == "#/today", 10, "강의 마친 뒤 오늘로")   # 강의를 마치면 화면이 오늘로 간다 — 그 뒤에 옮긴다
    go(ws, "#/review")
    shot("03-review")
    click(ws, "[data-action=reveal]")
    time.sleep(0.3)
    before = ws.js("MyLearner.app.events.filter(function(e){return e.type==='review'}).length")
    click(ws, "[data-action=grade][data-g=good]")
    time.sleep(0.1)
    line = ws.js("(function(){var r=MyLearner.app.events.filter(function(e){return e.type==='review'}); return r.length ? r[r.length-1].line : null;})()")
    sh("am force-stop %s" % PKG)
    ws.close()
    ok("채점 사건을 만들었다", bool(line) and ws is not None and before is not None)
    ws = launch()
    after = ws.js("MyLearner.app.events.map(function(e){return e.line})")
    ok("강제 종료 뒤 다시 켜도 바로 쓴다(읽기 전용 띠 없음)", ws.js("MyLearner.app.writer === 'mine' && !document.querySelector('.ro-band')"))
    ok("채점 0.1초 뒤 강제 종료 → 다시 켜도 그 사건이 있다(FR-410)", line in (after or []))
    kvs = sh("run-as %s ls files/kv" % PKG, check=False)
    ok("기록이 앱 전용 파일에(files/kv/ls.mylearner.log.*)", "ls.mylearner.log." in kvs, kvs[:200])
    ok("임시 파일이 남지 않았다", ".tmp" not in kvs)

    print("== 회전 — 화면을 다시 만들지 않는다", flush=True)
    go(ws, "#/stats")
    ws.js("window.__mark = 42; true")
    sh("settings put system accelerometer_rotation 0; settings put system user_rotation 1")
    time.sleep(3)
    rot = ws.js("({mark: window.__mark, wide: innerWidth > innerHeight, hash: location.hash})")
    ok("가로로 돌려도 같은 화면(다시 만들지 않음)", rot.get("mark") == 42 and rot.get("hash") == "#/stats", str(rot))
    ok("가로 폭으로 그린다", bool(rot.get("wide")))
    shot("04-stats-landscape")
    sh("settings put system user_rotation 0")
    time.sleep(2)

    print("== 교환 파일 → 파일로 저장(시스템 저장 창)", flush=True)
    go(ws, "#/settings")
    shot("05-settings")
    ev_n = ws.js("MyLearner.app.events.length + MyLearner.app.raw.length")
    sh("rm -f /sdcard/Download/mylearner-exchange-*.zip", check=False)
    click(ws, "[data-action=exportExchange]")
    try:
        ui_tap(r"(?i)save|저장", 30)
        wait(lambda: "mylearner-exchange-" in sh("ls /sdcard/Download/", check=False), 30, "다운로드 폴더의 교환 파일")
        name = re.search(r"(mylearner-exchange-\S+\.zip)", sh("ls /sdcard/Download/")).group(1)
        adb("pull", "/sdcard/Download/" + name, "/tmp/ex.zip")
        with zipfile.ZipFile("/tmp/ex.zip") as z:
            man = json.loads(z.read("manifest.json").decode("utf-8"))
            log_lines = [x for x in z.read("log.jsonl").decode("utf-8").splitlines()[1:] if x.strip()]
        ok("교환 파일 머리(mylearner-exchange v1 · 모바일판)", man.get("format") == "mylearner-exchange" and man.get("app", {}).get("edition") == "mobile")
        ok("교환 파일 줄 수 = 기록(%d)" % ev_n, len(log_lines) == ev_n, "%d" % len(log_lines))
        done = wait(lambda: ws.js("!!localStorage.getItem('mylearner.exported')"), 20, "내보낸 시각")
        ok("저장 끝을 화면이 받았다", bool(done))
    except RuntimeError as e:
        ok("교환 파일 저장", False, str(e))
    shot("06-after-export")

    print("== 뒤로 가기", flush=True)
    go(ws, "#/today")
    go(ws, "#/stats")
    sh("input keyevent KEYCODE_BACK")
    time.sleep(1.5)
    ok("뒤로 가기 — 한 걸음 뒤(오늘)", ws.js("location.hash") == "#/today")
    sh("input keyevent KEYCODE_BACK")
    time.sleep(2)
    top = sh("dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity'", check=False)
    ok("오늘에서 뒤로 가기 — 앱이 닫힌다", PKG not in top, top.strip()[:200])
    ws.close()

    crash = adb("logcat", "-b", "crash", "-d", check=False).stdout
    ok("크래시 0", PKG not in crash, crash[-300:])
    logs = adb("logcat", "-d", "-s", "chromium:*", check=False).stdout
    errs = [ln for ln in logs.splitlines() if "Uncaught" in ln]
    ok("스크립트 오류 0", not errs, "\n".join(errs[:3]))
    print("에뮬레이터 시험 %d건 통과 · 실패 %d건" % (PASS, FAIL))
    return 0 if FAIL == 0 else 1


def main(argv) -> int:
    if argv[:1] == ["--inside"]:
        try:
            return inside()
        except (RuntimeError, SystemExit, subprocess.TimeoutExpired) as e:
            ok("시험이 끝까지 돌았다", False, str(e))
            print("에뮬레이터 시험 %d건 통과 · 실패 %d건" % (PASS, FAIL))
            return 1
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        return 2
    return host(Path(args[0]), Path(args[1]), "--fetch" in argv, "--keep" in argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
