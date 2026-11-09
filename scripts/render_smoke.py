#!/usr/bin/env python3
"""렌더러 Chromium 점검(FR-201·253, 등급 C) — 실제 Chromium(헤드리스)이 file:// 에서 web/core 를 classic script 로 싣고 XSS 사례를 그린다.

입력:  tests/ui/render_check.html, web/core/*.js, tests/fixtures/xss_cases.js, 개발 이미지 scripts/dev_tools.env 의 PLAYWRIGHT_IMAGE
출력:  표준 출력 요약. 실행된 XSS·허용 밖 태그·속성·주소·예외가 하나라도 있으면 종료 코드 1
트리거: scripts/verify.sh '렌더러 Chromium(XSS)' 단계, 또는 손으로
사용:  python3 scripts/render_smoke.py
문서:  docs/P2_설계서_Core.md 3.6절. CDP 를 모는 것은 P1 의 tests/ui/cdp.js 그대로
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.import_mwl_fixtures import dev_tools  # noqa: E402

PARITY = ('<h1>제목</h1>\n<ul>\n<li><a class="ref" href="#/learn/mwl/A1-1"><code>A1-1</code></a> <strong>굵게</strong> 한*글*</li>\n</ul>\n'
          '<ol>\n<li>전각</li>\n</ol>')
CORE_FILES = 14
FUZZ_N = 5000   # tests/ui/render_check.html 의 FUZZ_N 과 같다


def main() -> int:
    image = dev_tools()["PLAYWRIGHT_IMAGE"]
    if subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode != 0:
        print("개발 이미지가 없다: %s (bash scripts/check_env.sh 참고)" % image)
        return 2
    work = Path(tempfile.mkdtemp(prefix="ml-render-"))
    work.chmod(0o777)
    try:
        job = {"profile": "/tmp/prof", "steps": [{"url": "file:///w/tests/ui/render_check.html", "timeout": 60000},
                                                 {"url": "file:///w/tests/ui/render_check.html#control", "timeout": 60000}]}
        (work / "job.json").write_text(json.dumps(job), encoding="utf-8")
        cmd = ["docker", "run", "--rm", "--network", "none", "--user", "%d:%d" % (os.getuid(), os.getgid()), "-e", "HOME=/tmp",
               "-v", "%s:/w:ro" % ROOT, "-v", "%s:/o" % work, image, "node", "/w/tests/ui/cdp.js", "/o/job.json", "/o/out.json"]
        t0 = time.monotonic()
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-2000:], r.stderr[-2000:])
            print("브라우저 실행 실패(종료 코드 %d)" % r.returncode)
            return 1
        outs = json.loads((work / "out.json").read_text(encoding="utf-8"))
        out, control = outs[0], (outs[1].get("selftest") or {})
        res = out.get("selftest") or {}
        problems = list(res.get("problems", []))
        if not out.get("done"):
            problems.append("끝 표지(data-done)가 오지 않았다")
        if res.get("xss") != 0:
            problems.append("XSS 가 실행됐다(window.__xss=%r)" % res.get("xss"))
        if res.get("classic") != CORE_FILES:
            problems.append("classic script 로 실린 core 파일 %r개(기대 %d)" % (res.get("classic"), CORE_FILES))
        if res.get("cases", 0) < 40:
            problems.append("사례 수 %r" % res.get("cases"))
        if res.get("fuzz") != FUZZ_N:
            problems.append("무작위 글 수 %r(기대 %d)" % (res.get("fuzz"), FUZZ_N))
        if res.get("parity") != PARITY:
            problems.append("브라우저 렌더가 Node 와 다르다: %r" % res.get("parity"))
        if res.get("scripts") != CORE_FILES + 2:
            problems.append("script 요소 수 %r — 사례가 script 를 넣었다" % res.get("scripts"))
        problems += ["예외: %s" % e for e in out.get("exceptions", [])]
        # 대조군(날것의 HTML)은 잡혀야 한다 — 잡지 못하면 이 점검이 눈먼 것이다
        caught = control.get("xss") == 1 and any("control: 속성 IMG.onerror" in p for p in control.get("problems", [])) \
            and any("control: href javascript:" in p for p in control.get("problems", []))
        if not caught:
            problems.append("대조군을 잡지 못했다: %r" % control)
        print("Chromium %.1f초: core %s개 classic script · XSS 사례 %s가지 · 무작위 글 %s가지 · 실행된 XSS %s · 렌더 Node 와 같음 %s · 대조군 잡음 %s" % (
            time.monotonic() - t0, res.get("classic"), res.get("cases"), res.get("fuzz"), res.get("xss"), "예" if res.get("parity") == PARITY else "아니오",
            "예" if caught else "아니오"))
        if problems:
            print("문제 %d건:" % len(problems))
            for p in problems[:20]:
                print("  " + p)
            return 1
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
