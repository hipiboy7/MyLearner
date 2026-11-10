#!/usr/bin/env python3
"""워크플로 정적 검사(등급 B, P4 FR-472·473) — .github/workflows/*.yml 이 CLAUDE.md 7절 'GitHub Actions' 규칙을 지키는지 줄 단위로 본다.
public 저장소라 남이 PR 로 워크플로를 돌릴 수 있고 로그·artifact 를 누구나 본다. YAML 해석기 없이(PyYAML 없는 Python 3.9~3.14 에서도) 돈다.

규칙: ① 맨 위 permissions: 아래 contents: read 하나뿐(write·다른 권한 0) ② pull_request_target·workflow_run 이벤트 없음
      ③ 모든 uses: 가 @<40자리 16진>(커밋 SHA 고정) ④ secrets. 참조 0 ⑤ run: 안 ${{ github.event. 0(주입)
      ⑥ actions/checkout 에 persist-credentials: false ⑦ upload-artifact 에 retention-days ⑧ 표준 러너만(ubuntu-·windows-·macos- 의 정한 이름, -large·-xlarge·self-hosted 없음)
입력: 워크플로 폴더(기본 .github/workflows) / 출력: 위반 줄. 위반이 있거나 워크플로가 없으면 종료 코드 1
트리거: scripts/verify.sh '워크플로 정적 검사' 단계. 문서: docs/P4_설계서_Mobile.md 3.9절
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHA = re.compile(r"^[^@\s]+@[0-9a-f]{40}(\s+#.*)?$")
RUNNER = re.compile(r"^(ubuntu-(latest|\d\d\.\d\d)|windows-(latest|20\d\d)|macos-(latest|\d+))$")


def check_text(name: str, text: str) -> list:
    out = []
    lines = text.splitlines()
    top_perm = [i for i, ln in enumerate(lines) if ln.rstrip() == "permissions:"]
    if not top_perm:
        out.append("%s: 맨 위 permissions: 가 없다" % name)
    else:
        body = []
        for ln in lines[top_perm[0] + 1:]:
            if ln.startswith("  ") and ln.strip():
                body.append(ln.strip())
            elif ln.strip():
                break
        if body != ["contents: read"]:
            out.append("%s: permissions 는 contents: read 하나여야 한다(지금 %s)" % (name, body))
    if any(re.search(r"permissions:\s*(write-all|read-all)", ln) for ln in lines):
        out.append("%s: permissions 를 통째로 주지 않는다" % name)
    for i, ln in enumerate(lines, 1):
        s = ln.strip()
        where = "%s:%d" % (name, i)
        if re.search(r"\b(pull_request_target|workflow_run)\b", s):
            out.append("%s: 금지 이벤트 %s" % (where, s))
        if re.search(r"\S+:\s*write\b", s) and not s.startswith("#"):
            out.append("%s: 쓰기 권한 %s" % (where, s))
        m = re.match(r"^-?\s*uses:\s*(\S+(?:\s+#.*)?)$", s)
        if m and not SHA.match(m.group(1)):
            out.append("%s: 액션을 커밋 SHA 로 고정하지 않았다 — %s" % (where, m.group(1)))
        if "secrets." in s and not s.startswith("#"):
            out.append("%s: 비밀값 참조 — %s" % (where, s))
        m = re.match(r"^runs-on:\s*(\S+)$", s)
        if m and not RUNNER.match(m.group(1)):
            out.append("%s: 표준 러너가 아니다 — %s" % (where, m.group(1)))
    # run: 블록 안의 ${{ github.event. — 줄 단위로 run: 에 이어진 들여쓴 줄까지
    in_run, indent = False, 0
    for i, ln in enumerate(lines, 1):
        m = re.match(r"^(\s*)(?:-\s+)?run:\s*(.*)$", ln)
        if m:
            in_run, indent = True, len(m.group(1))
            if "${{ github.event." in m.group(2):
                out.append("%s:%d: run 에 github.event 값을 바로 넣는다(주입)" % (name, i))
            continue
        if in_run:
            if ln.strip() and len(ln) - len(ln.lstrip()) <= indent:
                in_run = False
            elif "${{ github.event." in ln:
                out.append("%s:%d: run 에 github.event 값을 바로 넣는다(주입)" % (name, i))
    for i, ln in enumerate(lines):
        if re.search(r"uses:\s*actions/checkout@", ln):
            block = "\n".join(lines[i + 1:i + 6])
            if "persist-credentials: false" not in block:
                out.append("%s:%d: actions/checkout 에 persist-credentials: false 가 없다" % (name, i + 1))
        if re.search(r"uses:\s*actions/upload-artifact@", ln):
            block = "\n".join(lines[i + 1:i + 9])
            if not re.search(r"retention-days:\s*\d+", block):
                out.append("%s:%d: upload-artifact 에 retention-days 가 없다" % (name, i + 1))
    return out


def main(argv=None) -> int:
    args = sys.argv[1:] if argv is None else argv
    d = Path(args[0]) if args else ROOT / ".github" / "workflows"
    files = sorted(list(d.glob("*.yml")) + list(d.glob("*.yaml"))) if d.is_dir() else []
    if not files:
        print("워크플로가 없다: %s" % d)
        return 1
    problems = []
    for f in files:
        problems += check_text(f.name, f.read_text(encoding="utf-8"))
    for p in problems:
        print("위반: " + p)
    print("워크플로 %d개 검사(%s) - 위반 %d" % (len(files), ", ".join(f.name for f in files), len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
