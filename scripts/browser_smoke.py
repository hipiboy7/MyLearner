#!/usr/bin/env python3
"""browser_probe.html 헤드리스 스모크 — 실제 Chromium 으로 file://·http://127.0.0.1 에서 끝까지 돌린다 (FR-160~169, 등급 C).

입력:  tools/browser_probe.html, tools/ai_probe.py(--serve-test), tests/integration/py/fakes.py(가짜 AI 서버, CORS 있음·없음)
       개발 이미지 scripts/dev_tools.env 의 PLAYWRIGHT_IMAGE(Chromium headless shell + Node — 이미 있는 이미지만 쓴다)
출력:  단계별 결과 코드와 검사(표준 출력). 문제가 하나라도 있으면 종료 코드 1. --shots DIR 이면 1280·390px 전체 화면 PNG
트리거: scripts/verify.sh 의 브라우저 스모크 단계, 또는 손으로
문서:  docs/P1_설계서_Probe.md 3.5·3.6절

단계(같은 브라우저 프로필, 단계마다 브라우저 프로세스를 새로 띄운다):
  1 file://  tools/browser_probe.html   + CORS 를 주는 가짜 AI   -> 처음: 표지 없음(r=nn), 사본 하나(s=n), a=c
  2 file://  다른 폴더의 사본           + CORS 없는 가짜 AI      -> 다시 연 뒤 남음(r=yy), 사본끼리 공유(s=y), a=b
  3 http://127.0.0.1 (--serve-test)                           -> g=h, 쿠키·큰 POST(t=yy), 시험 서버 콘솔에 같은 코드
사용: python3 scripts/browser_smoke.py [--shots DIR] [--keep]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
import ai_probe as P  # noqa: E402
from tests.integration.py.fakes import FakeAI  # noqa: E402


def dev_tools():
    out = {}
    for line in (ROOT / "scripts" / "dev_tools.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def clean_env():
    env = {k: v for k, v in os.environ.items() if not k.lower().endswith("_proxy")}
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def start_serve_test():
    proc = subprocess.Popen([sys.executable, "-u", str(ROOT / "tools" / "ai_probe.py"), "--serve-test", "--no-browser",
                             "--port", "0", "--serve-seconds", "240", "--no-pause"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                            env=clean_env())
    lines, found = [], threading.Event()

    def reader():
        for line in proc.stdout:
            lines.append(line.rstrip("\n"))
            if "크롬에서 이 주소를 여세요: " in line:
                found.set()

    threading.Thread(target=reader, daemon=True).start()
    if not found.wait(20):
        proc.kill()
        raise RuntimeError("시험 서버 주소가 나오지 않았다: %s" % lines[-5:])
    url = next(x for x in lines if "크롬에서 이 주소를 여세요: " in x).split(": ", 1)[1].strip()
    return proc, url, lines


def check(name, res, expect, problems):
    if not res.get("done"):
        problems.append("%s: 페이지가 끝까지 돌지 않았다(data-done 없음)" % name)
        return None
    for what in ("exceptions", "console"):
        if res.get(what):
            problems.append("%s: 스크립트 %s %s" % (name, what, res[what][:3]))
    st = res.get("selftest") or {}
    if st.get("errors"):
        problems.append("%s: 페이지가 잡은 오류 %s" % (name, st["errors"][:3]))
    for text, cs in (st.get("vectors") or {}).items():
        if P.checksum(text) != cs:
            problems.append("%s: 검사합 검산 값이 Python 과 다르다 %r JS=%s Py=%s" % (name, text, cs, P.checksum(text)))
    try:
        d = P.parse_line(st.get("code") or "")
    except ValueError as e:
        problems.append("%s: 결과 코드를 읽지 못했다 (%s)" % (name, e))
        return None
    if not d["ok"]:
        problems.append("%s: 결과 코드 검사합이 틀렸다 %s" % (name, st.get("code")))
    if st.get("code") != res.get("code"):
        problems.append("%s: 화면의 코드와 보고한 코드가 다르다" % name)
    for k, want in expect.items():
        got = d["fields"].get(k)
        if got is None or not re.fullmatch(want, got):
            problems.append("%s: %s=%s (기대 %s)" % (name, k, got, want))
    return d


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--shots", default=None, help="스크린샷을 둘 폴더")
    ap.add_argument("--keep", action="store_true", help="작업 폴더를 지우지 않는다")
    args = ap.parse_args(argv)
    image = dev_tools()["PLAYWRIGHT_IMAGE"]
    if subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode != 0:
        print("개발 이미지가 없다: %s (bash scripts/check_env.sh 참고)" % image)
        return 2
    work = Path(tempfile.mkdtemp(prefix="ml-smoke-"))
    work.chmod(0o777)
    fakes = [FakeAI("vllm", cors="full"), FakeAI("vllm", cors="none")]
    proc = None
    problems = []
    try:
        proc, serve_url, serve_lines = start_serve_test()
        idb = "&idb=16"
        steps = [
            {"url": "file:///w/tools/browser_probe.html#selftest%s&ai=%s" % (idb, fakes[0].base), "timeout": 90000},
            {"url": "file:///tmp/copy/browser_probe.html#selftest%s&ai=%s" % (idb, fakes[1].base), "timeout": 90000},
            {"url": serve_url + "#selftest" + idb, "timeout": 90000},
        ]
        if args.shots:
            steps.append({"url": "file:///w/tools/browser_probe.html#selftest" + idb, "timeout": 90000,
                          "shots": [{"path": "/o/browser_probe_1280.png", "width": 1280, "height": 900},
                                    {"path": "/o/browser_probe_390.png", "width": 390, "height": 844}]})
        job = {"profile": "/tmp/prof", "copies": [{"from": "/w/tools/browser_probe.html",
                                                    "to": "/tmp/copy/browser_probe.html"}], "steps": steps}
        (work / "job.json").write_text(json.dumps(job), encoding="utf-8")
        cmd = ["docker", "run", "--rm", "--network", "host", "--user", "%d:%d" % (os.getuid(), os.getgid()),
               "-e", "HOME=/tmp", "-v", "%s:/w:ro" % ROOT, "-v", "%s:/o" % work, image,
               "node", "/w/tests/ui/cdp.js", "/o/job.json", "/o/out.json"]
        t0 = time.monotonic()
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-2000:], r.stderr[-2000:])
            print("브라우저 실행 실패(종료 코드 %d)" % r.returncode)
            return 1
        results = json.loads((work / "out.json").read_text(encoding="utf-8"))
        print("브라우저 %d단계 %.1f초" % (len(results), time.monotonic() - t0))
        expect = [
            ("1 file://", {"g": "f", "c": r"[ch]\d+", "l": r"\d+/\d+", "i": r"16/\d+", "e": "y", "u": "y", "s": "n",
                           "m": "n", "r": "nn", "t": "-", "a": "c", "z": "0"}),
            ("2 file:// 사본", {"g": "f", "s": "y", "r": "yy", "a": "b", "z": "0"}),
            ("3 http://127.0.0.1", {"g": "h", "t": "yy", "s": "-", "f": "y", "a": "-", "z": "0"}),
        ]
        parsed = []
        for (name, exp), res in zip(expect, results):
            d = check(name, res, exp, problems)
            parsed.append(d)
            print("  %-18s %s" % (name, (res.get("selftest") or {}).get("code")))
        time.sleep(0.5)
        http_code = (results[2].get("selftest") or {}).get("code") if len(results) > 2 else None
        if http_code and not any(("브라우저 결과 코드: " + http_code) in x for x in serve_lines):
            problems.append("3 http: 시험 서버 콘솔에 같은 결과 코드가 찍히지 않았다")
        if args.shots:
            dest = Path(args.shots)
            dest.mkdir(parents=True, exist_ok=True)
            for name in ("browser_probe_1280.png", "browser_probe_390.png"):
                shutil.copyfile(work / name, dest / name)
                print("  스크린샷: %s" % (dest / name))
    finally:
        if proc is not None:
            proc.kill()
            proc.wait()
        for f in fakes:
            f.close()
        if not args.keep:
            shutil.rmtree(work, ignore_errors=True)
    for p in problems:
        print("문제: " + p)
    print("스모크 %s" % ("통과" if not problems else "실패 %d건" % len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
