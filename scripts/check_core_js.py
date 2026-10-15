#!/usr/bin/env python3
"""core JS 정적 검사(FR-201, 등급 C) — web/core/*.js 가 classic script 규칙을 지키고 보이지 않는 글자가 없는지 본다.

입력:  web/core/*.js(규칙 전부), tests/**/*.js·tests/ui/*.html(보이지 않는 글자만)
출력:  표준 출력 요약, 위반이 있으면 종료 코드 1
트리거: scripts/verify.sh 'core JS 정적 검사' 단계, 손으로
규칙:  ① 머리 주석 '/* MyLearner web/core/<이름>.js' ② 'use strict' ③ import·export·fetch·XMLHttpRequest·Worker·eval·new Function·
       innerHTML·document·window·localStorage·외부 주소를 쓰지 않는다(주석 밖) — 화면·저장은 Phase 3 의 다른 파일이 한다
       ④ require 는 UMD 머리의 require('./' + name + '.js') 하나만 ⑤ 줄바꿈 밖의 제어 글자·서식 글자·사용자 영역 글자·줄 구분자(U+2028/2029)가 없다
       — 개발 도구가 \\u2028 같은 이스케이프를 날것으로 써서 정규식이 깨진 적이 있다(트러블슈팅 T-005)
문서:  docs/P2_설계서_Core.md 3.1절, docs/설계서_Architecture.md 6절 '브라우저 JS'
"""
from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = [r"\bimport\s", r"\bexport\s", r"\bfetch\s*\(", r"XMLHttpRequest", r"\bWorker\s*\(", r"\beval\s*\(", r"new\s+Function\b",
             r"\binnerHTML\b", r"\bdocument\.", r"\bwindow\.", r"\blocalStorage\b", r"https?://[A-Za-z0-9]"]
REQUIRE_OK = "require('./' + name + '.js')"


def strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), src, flags=re.S)
    return re.sub(r"(^|[^:'\"\\])//[^\n]*", r"\1", src)


def invisible(text: str):
    for i, ch in enumerate(text):
        if ch != "\n" and unicodedata.category(ch) in ("Cc", "Cf", "Co", "Zl", "Zp"):
            yield text.count("\n", 0, i) + 1, "U+%04X" % ord(ch)


def check(root: Path = ROOT):
    problems = []
    core = sorted((root / "web" / "core").glob("*.js"))
    for p in core:
        rel = p.relative_to(root).as_posix()
        src = p.read_text(encoding="utf-8")
        if not src.startswith("/* MyLearner web/core/%s" % p.name):
            problems.append("%s: 머리 주석이 '/* MyLearner web/core/%s' 로 시작하지 않는다" % (rel, p.name))
        if "'use strict'" not in src:
            problems.append("%s: 'use strict' 가 없다" % rel)
        code = strip_comments(src)
        for pat in FORBIDDEN:
            for m in re.finditer(pat, code):
                problems.append("%s:%d: 쓰지 않는 것 %r" % (rel, code.count("\n", 0, m.start()) + 1, m.group(0)))
        for m in re.finditer(r"\brequire\s*\(", code):
            if code[m.start():m.start() + len(REQUIRE_OK)] != REQUIRE_OK:
                problems.append("%s:%d: UMD 머리 밖의 require" % (rel, code.count("\n", 0, m.start()) + 1))
    others = sorted(set((root / "tests").rglob("*.js")) | set((root / "tests" / "ui").glob("*.html")) | set((root / "scripts").glob("*.js")))
    for p in core + others:
        for line, what in invisible(p.read_text(encoding="utf-8")):
            problems.append("%s:%d: 보이지 않는 글자 %s — 이스케이프(\\uXXXX)로 쓴다" % (p.relative_to(root).as_posix(), line, what))
    return len(core), len(others), problems


def main() -> int:
    n, m, problems = check()
    for p in problems:
        print(p)
    print("core JS %d개 · 다른 JS·HTML %d개 검사 - 위반 %d" % (n, m, len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
