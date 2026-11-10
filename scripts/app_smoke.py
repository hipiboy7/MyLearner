#!/usr/bin/env python3
"""화면 스모크(등급 C, FR-301~364·NFR-301~306) — 실제 Chromium(헤드리스)으로 앱을 file:// 와 서버 모드에서 끝까지 돌린다.

입력:  web/, mylearner/, config/editions/, 과정 파일(dist/courses/mwl.course.json — 없으면 tests/fixtures/mwl/scheduler_course.json,
       Learn 변환은 scripts/dev_tools.env LEARN_ROOT 가 있으면), tests/ui/cdp.js·app_check.js·a11y.js, 개발 이미지 PLAYWRIGHT_IMAGE
출력:  표준 출력 요약. 문제·접근성 위반·스크립트 예외·브라우저 오류(CSP 위반 등)가 하나라도 있으면 종료 코드 1
       --shots DIR 이면 화면마다 1280·390px PNG(테스트결과서 '화면 확인')
단계:  [file:// · 폐쇄망판 설정] first(전 화면 접근성 + 흐름 + MWL 두 번 들여오기 + 합치기·되돌리기(P4) + 탭 임대) → persist(브라우저를 다시 열어 사건 비교)
       → phone@344·390·690(가로 넘침·누름 44px·접근성 — P4) → (스크린샷: 1280·390, 폴드 344·690) → perf-seed(사건 5,000줄) → perf(첫 화면·복습 한 장 시간)
       [서버 모드 · 인터넷판 설정 + 깨진 과정 하나(FR-303)] first → persist, 끝난 뒤 데이터 폴더의 log.jsonl 에 화면이 만든 줄이 모두 있는지(명령 단위 — 기록 유실 0)
트리거: scripts/verify.sh '화면 스모크' 단계, 손으로
문서:  docs/P3_설계서_PC.md 6절, docs/P3_테스트결과서_PC.md, docs/P4_설계서_Mobile.md 3.10절
사용:  python3 scripts/app_smoke.py [--shots DIR] [--keep]
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from mylearner.convert import learn as LC  # noqa: E402
from scripts import pack_app as PA  # noqa: E402
from scripts.import_mwl_fixtures import dev_tools  # noqa: E402

PORT = 18770
SHOTS = [("today", "#/today", None), ("review", "#/review", "prep-review"), ("learn", None, None), ("stats", "#/stats", None),
         ("check", "#/check/mwl", None), ("map", "#/map/mwl", None), ("courses", "#/courses", None), ("settings", "#/settings", None),
         ("import", "#/import/mwl", "prep-import"), ("merge", "#/import/merge", "prep-merge")]
FOLD_SHOTS = [("today", "#/today", None), ("review", "#/review", "prep-review"), ("settings", "#/settings", None), ("merge", "#/import/merge", "prep-merge")]
PHONE_WIDTHS = (344, 390, 690)   # 폴드5 접은 화면·폰·폴드5 펼친 화면(추정 — docs/P4_설계서_Mobile.md 3.7절 ⚠️)
LIMITS = {"ready_ms": 2000, "review_ms": 400}


def courses():
    mwl = ROOT / "dist" / "courses" / "mwl.course.json"
    base = json.loads((mwl if mwl.exists() else ROOT / "tests" / "fixtures" / "mwl" / "scheduler_course.json").read_text(encoding="utf-8"))
    out = [base]
    learn = dev_tools().get("LEARN_ROOT")
    if learn and Path(learn).is_dir():
        for p in sorted(Path(learn).iterdir()):
            if (p / "content" / "index.md").is_file():
                try:
                    out.append(LC.build(p, "%s@smoke" % p.name))
                except LC.LearnError:
                    continue   # kids 등 — 가져오지 않는다
    return out


def broken():
    return {"format": "mylearner-course", "version": 1, "min_reader": 1, "id": "broken-demo", "title": "깨진 과정", "kind": "course",
            "parts": [{"id": "P", "title": "P", "units": [{"id": "U", "title": "U", "lessons": ["nope"]}]}], "lessons": {}}


def progress(course):
    """MWL 진도(스키마 2) — 과정의 앞 카드 30장 상태·강의 3과 마침·세션·퀴즈·내 지식 2건(카드 3장)."""
    cards = sorted(course["cards"])[:30]
    lessons = [lid for p in course["parts"] for u in p["units"] for lid in u["lessons"]][:3]
    st = {}
    for i, cid in enumerate(cards):
        st[cid] = {"ef": 2.5 - (i % 3) * 0.1, "interval": 1 + i % 5, "reps": 1 + i % 4, "lapses": i % 2, "due": "2026-11-%02d" % (10 + i % 15),
                   "last": "2026-11-%02d" % (1 + i % 8), "grades": [2, 3, 2][: 1 + i % 3]}
    return {"schema": 2, "version": "1.7.2", "created": "2026-09-01", "cards": st,
            "lessons": {lid: {"status": "done", "done_at": "2026-10-0%d" % (1 + j), "confidence": 3} for j, lid in enumerate(lessons)},
            "labs": {}, "drills": [], "quizzes": [], "diagnostics": [],
            "sessions": [{"date": "2026-10-01", "minutes": 30, "reviewed": 10}, {"date": "2026-10-02", "minutes": 25, "reviewed": 8}],
            "journal": [{"date": "2026-10-02", "summary": "요약", "apply": "", "unclear": "", "teach": ""}],
            "knowledge": [{"id": "K0001", "title": "메모 하나", "domain": "A", "module": None, "kind": "fact", "confidence": "likely", "source": "현장",
                           "body": "본문", "tags": [], "cards": [{"q": "질문1", "a": "답1"}, {"q": "질문2", "a": "답2"}], "created": "2026-10-01", "origin": "manual"},
                          {"id": "K0002", "title": "메모 둘", "domain": "A", "module": None, "kind": "fact", "confidence": "unverified", "source": "",
                           "body": "본문2", "tags": [], "cards": [{"q": "질문3", "a": "답3"}], "created": "2026-10-02", "origin": "manual"}],
            "knowledge_seq": 2}


def build_web(dst: Path, ed: str, course_list) -> None:
    web = dst / "web"
    for f in PA.WEB_TOP:
        (web).mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "web" / f, web / f)
    for d in PA.WEB_DIRS:
        shutil.copytree(ROOT / "web" / d, web / d)
    (web / "config.js").write_text(PA.config_js(PA.edition(ed)), encoding="utf-8")
    for k, v in PA.data_files(course_list).items():
        (web / "data" / k).parent.mkdir(parents=True, exist_ok=True)
        (web / "data" / k).write_bytes(v)


def scenario_file(work: Path, name: str, data: dict) -> str:
    p = work / ("sc-%s.js" % name)
    p.write_text("window.__scenario = %s;\n" % json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return "/o/" + p.name


def run_container(image, work: Path, job: dict, server_cmd: str = None):
    (work / "job.json").write_text(json.dumps(job), encoding="utf-8")
    node = "node /w/tests/ui/cdp.js /o/job.json /o/out.json"
    if server_cmd:
        wait = ("for i in $(seq 1 80); do python3 -c \"import socket;socket.create_connection(('127.0.0.1',%d),0.2)\" 2>/dev/null && break; sleep 0.1; done; " % PORT)
        cmd = ["sh", "-c", "cd /w && (%s > /o/server.log 2>&1 &) ; %s%s" % (server_cmd, wait, node)]
    else:
        cmd = ["sh", "-c", node]
    full = ["docker", "run", "--rm", "--network", "none", "--user", "%d:%d" % (os.getuid(), os.getgid()), "-e", "HOME=/tmp", "-e", "PYTHONDONTWRITEBYTECODE=1",
            "-v", "%s:/w:ro" % ROOT, "-v", "%s:/o" % work, image] + cmd
    r = subprocess.run(full, capture_output=True, text=True, timeout=900)
    if r.returncode != 0 or not (work / "out.json").exists():
        print(r.stdout[-2000:], r.stderr[-2000:])
        raise SystemExit("브라우저 실행 실패(종료 코드 %d)" % r.returncode)
    return json.loads((work / "out.json").read_text(encoding="utf-8"))


def judge(tag: str, outs, names, problems, report):
    for out, name in zip(outs, names):
        res = out.get("result") or {}
        label = "%s/%s" % (tag, name)
        if not out.get("done"):
            problems.append("%s: 화면이 준비되지 않았다" % label)
        problems.extend("%s: 예외 %s" % (label, e) for e in out.get("exceptions", []))
        problems.extend("%s: 브라우저 오류 %s" % (label, c) for c in out.get("console", []) + out.get("log", []))
        problems.extend("%s: %s" % (label, p) for p in res.get("problems", []))
        for route, vs in sorted((res.get("a11y") or {}).items()):
            problems.extend("%s: 접근성 %s — %s" % (label, route, v) for v in vs)
        report[label] = {k: res.get(k) for k in ("counts", "timings") if res.get(k)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--shots", default=None)
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args(argv)
    image = dev_tools()["PLAYWRIGHT_IMAGE"]
    if subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode != 0:
        print("개발 이미지가 없다: %s (bash scripts/check_env.sh 참고)" % image)
        return 2
    t0 = time.monotonic()
    cl = courses()
    prog = progress(cl[0])
    ids = [c["id"] for c in cl]
    tmp = Path(tempfile.mkdtemp(prefix="ml-app-"))
    tmp.chmod(0o777)
    problems, report = [], {}
    ready = 'document.body && document.body.getAttribute("data-ready") === "1"'
    # 스크린샷은 쓰는 탭이 된 뒤에 — CDP 로 닫은 앞 브라우저는 pagehide 가 없어 임대가 6초 뒤에 풀린다(T-010)
    shot_ready = ready + ' && MyLearner.app.writer === "mine" && !document.querySelector(".ro-band")'
    inj = ["/w/tests/ui/a11y.js", "/w/tests/ui/app_check.js"]
    try:
        # ---- file:// · 폐쇄망판
        fw = tmp / "file"
        fw.mkdir()
        fw.chmod(0o777)
        build_web(fw, "closed", cl)
        base = {"mode": "browser", "edition": "closed", "courses": ids, "bad": 0, "progress": prog}
        url = "file:///o/web/index.html"
        steps, names = [], []

        def step(name, hash_, extra_inject=None, shots=None, timeout=180000):
            sc = scenario_file(fw, name, dict(base, name=name))
            s = {"url": url + (hash_ or "#/today"), "timeout": timeout, "ready": shot_ready if shots else ready, "inject": [sc] + (extra_inject if extra_inject is not None else inj)}
            if shots:
                s["shots"] = shots
            steps.append(s)
            names.append(name)

        step("first", "#/today")
        step("persist", "#/today")
        for w in PHONE_WIDTHS:   # P4 FR-461 — 폰 폭(창 폭을 정해 연다)
            sc = scenario_file(fw, "phone-%d" % w, dict(base, name="phone"))
            steps.append({"url": url + "#/today", "timeout": 180000, "ready": shot_ready, "inject": [sc] + inj, "width": w, "height": 860})
            names.append("phone@%d" % w)
        if args.shots:
            (fw / "shots").mkdir()
            (fw / "shots").chmod(0o777)
            lesson_id = sorted(cl[0]["lessons"])[0]
            for name, hash_, prep in SHOTS:
                h = hash_ or "#/learn/mwl/%s" % lesson_id
                sh = [{"path": "/o/shots/%s-%d.png" % (name, w), "width": w, "height": 900} for w in (1280, 390)]
                if prep:
                    step(prep, h, ["/w/tests/ui/a11y.js", "/w/tests/ui/app_check.js"], sh)
                    names[-1] = "shot-" + name
                else:
                    steps.append({"url": url + h, "timeout": 60000, "ready": shot_ready, "shots": sh})
                    names.append("shot-" + name)
            for name, hash_, prep in FOLD_SHOTS:   # 폴드5 두 폭(P4)
                sh = [{"path": "/o/shots/fold-%s-%d.png" % (name, w), "width": w, "height": 860} for w in (344, 690)]
                if prep:
                    step(prep, hash_, ["/w/tests/ui/a11y.js", "/w/tests/ui/app_check.js"], sh)
                    names[-1] = "shot-fold-" + name
                else:
                    steps.append({"url": url + hash_, "timeout": 60000, "ready": shot_ready, "shots": sh})
                    names.append("shot-fold-" + name)
        step("perf-seed", "#/today")
        step("perf", "#/today")
        outs = run_container(image, fw, {"profile": "/tmp/prof", "steps": steps})
        judge("file", outs, names, problems, report)
        perf = (outs[names.index("perf")].get("result") or {}).get("timings", {})
        for k, lim in LIMITS.items():
            if perf.get(k, 0) > lim:
                problems.append("file/perf: %s %dms > %dms(NFR-302)" % (k, perf.get(k), lim))
        # ---- 서버 모드 · 인터넷판
        sw = tmp / "server"
        (sw / "data").mkdir(parents=True)
        sw.chmod(0o777)
        (sw / "data").chmod(0o777)
        build_web(sw, "internet", cl + [broken()])   # 깨진 과정은 싣지 않고 알린다(FR-303)
        tok = secrets.token_hex(32)
        (sw / "data" / "token").write_text(tok + "\n", encoding="utf-8")
        (sw / "edition.json").write_text(json.dumps(PA.edition("internet")), encoding="utf-8")
        sbase = {"mode": "server", "edition": "internet", "courses": ids, "bad": 1, "progress": prog}
        ssteps = []
        for i, name in enumerate(("first", "persist")):
            ssteps.append({"url": "http://127.0.0.1:%d/%s#/today" % (PORT, "?token=" + tok if i == 0 else ""), "timeout": 180000, "ready": ready,
                           "inject": [scenario_file(sw, "s-" + name, dict(sbase, name=name))] + inj})
        server_cmd = "python3 -m mylearner serve --no-browser --port %d --data /o/data --web /o/web --config /o/edition.json" % PORT
        souts = run_container(image, sw, {"profile": "/tmp/prof", "steps": ssteps}, server_cmd)
        judge("server", souts, ["first", "persist"], problems, report)
        lines = set((souts[0].get("result") or {}).get("lines") or [])
        log = (sw / "data" / "log.jsonl")
        disk = set(log.read_text(encoding="utf-8").splitlines()[1:]) if log.exists() else set()
        lost = lines - disk
        if not lines or lost:
            problems.append("server: 데이터 폴더의 log.jsonl 에 없는 화면 사건 %d개(화면 %d줄 · 파일 %d줄)" % (len(lost), len(lines), len(disk)))
        report["server/disk"] = {"screen_lines": len(lines), "file_lines": len(disk), "lost": len(lost),
                                 "backups": len(list((sw / "data" / "backups").glob("*.jsonl")))}
        if args.shots:
            dst = Path(args.shots)
            dst.mkdir(parents=True, exist_ok=True)
            for png in sorted((fw / "shots").glob("*.png")):
                shutil.copy2(png, dst / png.name)
            report["shots"] = len(list((fw / "shots").glob("*.png")))
    finally:
        if args.keep:
            print("남김: %s" % tmp)
        else:
            shutil.rmtree(tmp, ignore_errors=True)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=1))
    print("화면 스모크 %.1f초: 과정 %s · file://(폐쇄망판) %d단계(폰 폭 %s) · 서버 모드(인터넷판) 2단계 · 문제 %d" % (
        time.monotonic() - t0, ",".join(ids), len(names), "·".join(str(w) for w in PHONE_WIDTHS), len(problems)))
    for p in problems[:60]:
        print("  " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
