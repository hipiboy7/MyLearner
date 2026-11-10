#!/usr/bin/env python3
"""묶음 실기 시험(등급 B, P4 FR-470) — GitHub Actions Windows 러너에서 폐쇄망판 zip 을 풀어 MyLearner.cmd(py -3)로 켜고 써 본다.
VM(Linux)에서도 돈다(그때는 MyLearner.cmd 대신 python -m mylearner serve) — 흐름을 먼저 확인하려고.

입력:  저장소(scripts/pack_app.py · tests/fixtures/mwl/scheduler_course.json — Actions 는 MWL·Learn 자료를 읽지 못한다)
출력:  표준 출력에 OK/FAIL 줄과 끝에 '묶음 실기 N건 통과 · 실패 M건'. 실패가 있으면 종료 코드 1. 토큰·경로·기록 내용은 찍지 않는다(Actions 로그는 공개)
흐름:  폐쇄망판 zip 만들기 → 풀기(Windows 는 PowerShell Expand-Archive) → 켜기(Windows 는 cmd /c MyLearner.cmd, PY_PYTHON3=<판>,
       PYTHONIOENCODING=cp949 — 한국어 Windows 의 파이프 출력처럼) → 첫 줄을 cp949 로 엄격히 풀 수 있나 → /api/health → ?token= 쿠키
       → 기록 한 줄 덧붙이기 → 끄기 → 다시 켜기 → 그 줄이 남았나 → 폐쇄망판 백업 내려받기 404 → 되살리기 차이 API(P4)
사용:  python scripts/ci_windows_bundle.py [--python 3.9] [--keep]
문서:  docs/P4_요구사항정의서_Mobile.md FR-470, docs/P4_설계서_Mobile.md 3.9절
"""
from __future__ import annotations

import argparse
import contextlib
import http.client
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import pack_app as PA  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "mwl" / "scheduler_course.json"
WIN = os.name == "nt"
PORT = 8781
PASS = 0
FAIL = 0


def ok(name: str, cond: bool, extra: str = "") -> bool:
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  OK   %s" % name, flush=True)
    else:
        FAIL += 1
        print("  FAIL %s%s" % (name, (" - " + extra[:200]) if extra else ""), flush=True)
    return cond


def extract(zpath: Path, dst: Path) -> None:
    if WIN:   # 사용자가 하는 것처럼 Windows 의 압축 풀기로
        subprocess.run(["powershell", "-NoProfile", "-Command", "Expand-Archive -LiteralPath '%s' -DestinationPath '%s' -Force" % (zpath, dst)],
                       check=True, capture_output=True, timeout=120)
    else:
        with zipfile.ZipFile(zpath) as z:
            z.extractall(dst)


def start(bundle: Path, py: str):
    env = dict(os.environ, PYTHONIOENCODING="cp949", PYTHONDONTWRITEBYTECODE="1")
    if WIN:
        env["PY_PYTHON3"] = py   # py -3 이 이 판을 고른다
        cmd = ["cmd", "/c", "chcp 949 >nul & MyLearner.cmd --no-browser --port %d" % PORT]
    else:
        cmd = [sys.executable, "-m", "mylearner", "serve", "--no-browser", "--port", str(PORT)]
    p = subprocess.Popen(cmd, cwd=str(bundle), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    head = b""
    end = time.time() + 60
    while time.time() < end and b"http://127.0.0.1" not in head:
        b = p.stdout.readline()
        if not b:
            break
        head += b
    return p, head


def stop(p) -> None:
    if WIN:
        subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
    else:
        p.terminate()
    try:
        p.wait(timeout=20)
    except subprocess.TimeoutExpired:
        p.kill()


def req(method: str, path: str, token: str, body=None, cookie: str = None):
    h = {"Host": "127.0.0.1:%d" % PORT, "X-MyLearner-Token": token}
    if cookie:
        h = {"Host": "127.0.0.1:%d" % PORT, "Cookie": cookie}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=15)
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    out = (r.status, dict(r.getheaders()), r.read())
    c.close()
    return out


def utf8_out() -> None:
    """이 시험 도구 자신의 출력만 UTF-8 로 — 러너 콘솔은 cp1252 라 한글 print 가 UnicodeEncodeError 로 죽었다
    (2026-11-10 Actions 첫 실행, 트러블슈팅 T-015). 앱(자식 프로세스)의 출력은 PYTHONIOENCODING=cp949 로 따로 본다."""
    for s in (sys.stdout, sys.stderr):
        with contextlib.suppress(AttributeError, ValueError, io.UnsupportedOperation):
            s.reconfigure(encoding="utf-8", errors="replace")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--python", default="3")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args(argv)
    tmp = Path(tempfile.mkdtemp(prefix="ml-ci-"))
    try:
        print("== 묶음 실기 — %s · Python %s" % ("Windows(MyLearner.cmd)" if WIN else "Linux(python -m)", args.python if WIN else sys.version.split()[0]), flush=True)
        with contextlib.redirect_stdout(io.StringIO()):   # 묶음 도구는 만든 경로를 찍는다 — Actions 로그에 남기지 않는다
            rc = PA.main(["--edition", "closed", "--courses", str(FIXTURE), "--out", str(tmp / "dist")])
        top = PA.top_name("closed")
        zpath = tmp / "dist" / (top + ".zip")
        ok("폐쇄망판 zip 을 만들었다", rc == 0 and zpath.exists())
        extract(zpath, tmp / "x")
        bundle = tmp / "x" / top
        ok("풀었다(MyLearner.cmd·README_KO.txt·web·mylearner)", all((bundle / n).exists() for n in ("MyLearner.cmd", "README_KO.txt", "web", "mylearner")))

        p, head = start(bundle, args.python)
        try:
            text = head.decode("cp949")
            ok("켤 때 출력이 cp949 로 깨지지 않는다", True)
        except UnicodeDecodeError as e:
            text = head.decode("cp949", "replace")
            ok("켤 때 출력이 cp949 로 깨지지 않는다", False, str(e))
        m = re.search(r"http://127\.0\.0\.1:(\d+)/\?token=([0-9a-f]{64})", text)
        ok("주소·토큰 줄(MyLearner %s 폐쇄망판)" % PA.__version__, bool(m) and ("MyLearner %s" % PA.__version__) in text, re.sub(r"token=[0-9a-f]+", "token=…", text)[:200])
        if not m:
            stop(p)
            raise SystemExit(1)
        token = m.group(2)
        st, _, body = req("GET", "/api/health", token)
        h = json.loads(body) if st == 200 else {}
        ok("/api/health — 폐쇄망판", st == 200 and h.get("edition") == "closed")
        st, hd, _ = req("GET", "/?token=" + token, "", cookie="x=1")
        sc = hd.get("Set-Cookie", "")
        ok("?token= → 쿠키(HttpOnly·SameSite=Strict)", st == 302 and "HttpOnly" in sc and "SameSite=Strict" in sc)
        line = json.dumps({"v": 1, "dev": "c1c1c1c1c1c1c1c1", "seq": 1, "t": "2026-11-10T01:00:00.000Z", "day": "2026-11-10", "type": "session",
                           "minutes": 5, "reviewed": 0}, sort_keys=True, separators=(",", ":"))
        st, _, body = req("POST", "/api/log", token, {"lines": [line]})
        ok("기록 한 줄 덧붙이기", st == 200 and json.loads(body).get("added") == 1)
        st, _, body = req("POST", "/api/backups", token, {"reason": "import-merge"})
        name = json.loads(body).get("name", "") if st == 200 else ""
        ok("백업 만들기", bool(name))
        ok("폐쇄망판 — 백업 내려받기 404", req("GET", "/api/backups/" + name, token)[0] == 404)
        st, _, body = req("GET", "/api/backups/%s/diff" % name, token)
        ok("되살리기 차이 API(P4)", st == 200 and json.loads(body) == {"only_current": [], "only_backup": 0})
        stop(p)

        p, head = start(bundle, args.python)
        ok("다시 켰다", b"http://127.0.0.1" in head)
        st, _, body = req("GET", "/api/log", token)
        ok("끄고 다시 켜도 그 줄이 남았다(data/log.jsonl)", st == 200 and line in body.decode("utf-8").splitlines())
        stop(p)
        ok("데이터 폴더가 묶음 안에(data/log.jsonl)", (bundle / "data" / "log.jsonl").is_file())
    finally:
        if args.keep:
            print("남김: %s" % tmp)
        else:
            shutil.rmtree(tmp, ignore_errors=True)
    print("묶음 실기 %d건 통과 · 실패 %d건" % (PASS, FAIL))
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    utf8_out()
    sys.exit(main())
