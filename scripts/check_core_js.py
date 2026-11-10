#!/usr/bin/env python3
"""웹 JS 정적 검사(FR-201·FR-301·FR-304, 등급 C) — web/core·web/store·web/app 의 JS 가 classic script 규칙을 지키고,
index.html 에 인라인 스크립트·인라인 style·외부 주소가 없고, 보이지 않는 글자가 없는지 본다.

입력:  web/core/*.js(규칙 전부), web/store/*.js·web/app/*.js(묶음별 규칙), web/*.js·web/index.html,
       tests/**/*.js·tests/ui/*.html·scripts/*.js·mylearner/**/*.py·scripts/*.py·tests/**/*.py(보이지 않는 글자만)
출력:  표준 출력 요약, 위반이 있으면 종료 코드 1
트리거: scripts/verify.sh 'core JS 정적 검사' 단계, 손으로
규칙:  ① 머리 주석 '/* MyLearner web/core/<이름>.js' ② 'use strict' ③ import·export·fetch·XMLHttpRequest·Worker·eval·new Function·
       innerHTML·document·window·localStorage·외부 주소를 쓰지 않는다(주석 밖) — 화면·저장은 Phase 3 의 다른 파일이 한다
       ④ require 는 UMD 머리의 require('./' + name + '.js') 하나만 ⑤ 줄바꿈 밖의 제어 글자·서식 글자·사용자 영역 글자·줄 구분자(U+2028/2029)가 없다
       — 개발 도구가 \\u2028 같은 이스케이프를 날것으로 써서 정규식이 깨진 적이 있다(트러블슈팅 T-005)
       Phase 3 묶음별: store — 머리·'use strict'·fetch 는 주입받은 env.fetch 만·innerHTML·document·외부 주소 없음·require 는 UMD 머리의
       require(file) 만 / app — 머리·'use strict'·fetch·XMLHttpRequest·eval·외부 주소 없음(저장은 store 가, 화면은 innerHTML 을 쓴다)
       / index.html — src 없는 <script>·style= 속성·외부 주소 없음, CSP 메타가 있다(CSP 'self' 가 인라인을 막는다 — P3 설계서 4절)
문서:  docs/P2_설계서_Core.md 3.1절, docs/P3_설계서_PC.md 2·4절, docs/설계서_Architecture.md 6절 '브라우저 JS'
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


GROUPS = {
    "store": {"forbid": [r"(?m)^\s*import\s", r"(?m)^\s*export\s", r"(?<![.\w])fetch\s*\(", r"XMLHttpRequest", r"\bWorker\s*\(", r"\beval\s*\(",
                         r"new\s+Function\b", r"\binnerHTML\b", r"\bdocument\.", r"\blocalStorage\b", r"https?://[A-Za-z0-9]"],
              "require": ["require(file)", "require('../core/' + name + '.js')"]},
    "app": {"forbid": [r"(?m)^\s*import\s", r"(?m)^\s*export\s", r"(?<![.\w])fetch\s*\(", r"XMLHttpRequest", r"\bWorker\s*\(", r"\beval\s*\(",
                       r"new\s+Function\b", r"https?://[A-Za-z0-9]", r"\brequire\s*\("], "require": []},
}


def _rules(root, files, folder, forbid, require_ok, problems):
    for p in files:
        rel = p.relative_to(root).as_posix()
        src = p.read_text(encoding="utf-8")
        if not src.startswith("/* MyLearner web/%s/%s" % (folder, p.name)):
            problems.append("%s: 머리 주석이 '/* MyLearner web/%s/%s' 로 시작하지 않는다" % (rel, folder, p.name))
        if "'use strict'" not in src:
            problems.append("%s: 'use strict' 가 없다" % rel)
        code = strip_comments(src)
        for pat in forbid:
            for m in re.finditer(pat, code):
                problems.append("%s:%d: 쓰지 않는 것 %r" % (rel, code.count("\n", 0, m.start()) + 1, m.group(0)))
        for m in re.finditer(r"\brequire\s*\(", code):
            if not any(code[m.start():m.start() + len(ok)] == ok for ok in require_ok):
                problems.append("%s:%d: UMD 머리 밖의 require" % (rel, code.count("\n", 0, m.start()) + 1))


def check_index(root: Path, problems) -> int:
    p = root / "web" / "index.html"
    if not p.exists():
        return 0
    rel = p.relative_to(root).as_posix()
    src = p.read_text(encoding="utf-8")
    html = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    for m in re.finditer(r"<script\b([^>]*)>", html, flags=re.I):
        if not re.search(r"\bsrc\s*=", m.group(1), flags=re.I):
            problems.append("%s: 인라인 <script>(src 없음)" % rel)
    if re.search(r"\sstyle\s*=", html, flags=re.I):
        problems.append("%s: style= 속성(CSP 가 막는다)" % rel)
    if re.search(r"https?://[A-Za-z0-9]", html):
        problems.append("%s: 외부 주소" % rel)
    if "Content-Security-Policy" not in html:
        problems.append("%s: CSP 메타가 없다" % rel)
    return 1


def check(root: Path = ROOT):
    problems = []
    core = sorted((root / "web" / "core").glob("*.js"))
    _rules(root, core, "core", FORBIDDEN, [REQUIRE_OK], problems)
    groups = []
    for folder, g in GROUPS.items():
        files = sorted((root / "web" / folder).glob("*.js"))
        _rules(root, files, folder, g["forbid"], g["require"], problems)
        groups += files
    tops = sorted((root / "web").glob("*.js"))
    for p in tops:
        if re.search(r"https?://[A-Za-z0-9]", strip_comments(p.read_text(encoding="utf-8"))):
            problems.append("%s: 외부 주소" % p.relative_to(root).as_posix())
    n_index = check_index(root, problems)
    web_more = groups + tops + ([root / "web" / "index.html"] if n_index else [])
    others = sorted(set((root / "tests").rglob("*.js")) | set((root / "tests" / "ui").glob("*.html")) | set((root / "scripts").glob("*.js"))
                    | set((root / "mylearner").rglob("*.py")) | set((root / "scripts").glob("*.py")) | set((root / "tests").rglob("*.py")))   # Python 도(T-005 — U+FEFF 가 날것으로 들어감, P3)
    for p in core + web_more + others:
        for line, what in invisible(p.read_text(encoding="utf-8")):
            problems.append("%s:%d: 보이지 않는 글자 %s — 이스케이프(\\uXXXX)로 쓴다" % (p.relative_to(root).as_posix(), line, what))
    return len(core), len(web_more), len(others), problems


def main() -> int:
    n, w, m, problems = check()
    for p in problems:
        print(p)
    print("core JS %d개 · 웹 JS·HTML %d개 · 시험 JS·HTML %d개 검사 - 위반 %d" % (n, w, m, len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
