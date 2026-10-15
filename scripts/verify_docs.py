#!/usr/bin/env python3
"""문서 기계 검사 — 상대 링크·백틱 안 저장소 경로·명령의 실재 (FR-103, CLAUDE.md 4절 '문서에 적은 명령은 적은 그대로').

입력:  늘 검사 = README.md, docs/트러블슈팅.md, docs/P*_체크리스트_*.md, docs/P*_테스트결과서_*.md, docs/guide/*.md
       --release 에서 더 = CLAUDE.md, docs/scope-definition.md, docs/설계서_Architecture.md, docs/P*_인터뷰결과서_*.md,
                          docs/P*_요구사항정의서_*.md, docs/P*_설계서_*.md (앞으로 만들 명령을 적는 설계 문서)
       허용 목록 scripts/verify_docs_planned.txt — 아직 없는 예정 경로. 생겼는데 남아 있으면 위반
출력:  위반 목록(표준 출력). 위반이 있으면 종료 코드 1
트리거: scripts/verify.sh 의 문서 검사 단계
문서:  docs/P1_설계서_Probe.md 3.6절
MWL scripts/verify_docs.py(기준 커밋 e053470)를 옮겨 고쳤다: 대상 두 묶음, 코드 블록 안 명령, 이 저장소의 폴더·명령 꼴.
보지 않는 것: docs/BRIEF.md(기획 원문 — 고치지 않는다), history/(당시 기록), dist/(생성물),
              "MWL `경로`" 처럼 바로 앞에 'MWL ' 을 붙인 다른 저장소의 경로

사용: python3 scripts/verify_docs.py [--release] [--quiet]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOP_DIRS = ("mylearner", "docs", "scripts", "tools", "tests", "web", "config", "history", ".claude", "mobile", "dist")
TOP_FILES = {"CLAUDE.md", "README.md", ".gitignore"}
GENERATED = ("dist/",)
ALWAYS = ["README.md", "docs/트러블슈팅.md", "docs/P*_체크리스트_*.md", "docs/P*_테스트결과서_*.md", "docs/guide/*.md"]
RELEASE = ["CLAUDE.md", "docs/scope-definition.md", "docs/설계서_Architecture.md", "docs/P*_인터뷰결과서_*.md",
           "docs/P*_요구사항정의서_*.md", "docs/P*_설계서_*.md"]
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
TICK_RE = re.compile(r"`([^`\n]+)`")
PATH_RE = re.compile(r"^(?:" + "|".join(re.escape(d) for d in TOP_DIRS) + r")/[^\s]*$")
CMD_FILE_RES = [
    re.compile(r"(?:^|[\s;&|(])python3(?:\.\d+)?\s+(?:-\S+\s+)*((?:scripts|tools)/[\w./-]+\.py)"),
    re.compile(r"(?:^|[\s;&|(])(?:bash|sh)\s+((?:scripts|tools)/[\w./-]+\.sh)"),
    re.compile(r"(?:^|[\s;&|(])\./?((?:scripts|tools)/[\w./-]+\.sh)"),
]
CMD_MODULE_RE = re.compile(r"(?:python3(?:\.\d+)?|py -3)\s+-m\s+(mylearner(?:\.[\w.]+)?)")


def targets(root: Path, release: bool):
    out = []
    for pat in ALWAYS + (RELEASE if release else []):
        out += sorted(root.glob(pat)) if "*" in pat else [root / pat]
    seen, files = set(), []
    for f in out:
        if f.exists() and f not in seen:
            seen.add(f)
            files.append(f)
    return files


def load_planned(root: Path):
    path = root / "scripts" / "verify_docs_planned.txt"
    if not path.exists():
        return set()
    return {x.strip() for x in path.read_text(encoding="utf-8").splitlines() if x.strip() and not x.startswith("#")}


def looks_like_path(s: str) -> bool:
    if s in TOP_FILES:
        return True
    if not PATH_RE.match(s) or any(ch in s for ch in "{}*<>|…"):
        return False
    return not ("NN" in s or "{N}" in s or "/N/" in s)


def exists(root: Path, rel: str, planned) -> bool:
    if rel.startswith(GENERATED) or rel in planned or rel.rstrip("/") + "/" in planned:
        return True
    p = root / rel
    return p.is_dir() if rel.endswith("/") else p.exists()


def check_commands(root, rel_doc, no, line, planned, violations):
    for rx in CMD_FILE_RES:
        for m in rx.finditer(line):
            if not exists(root, m.group(1), planned):
                violations.append("%s:%d: SCRIPT: %s" % (rel_doc, no, m.group(1)))
    for m in CMD_MODULE_RE.finditer(line):
        mod = m.group(1).replace(".", "/")
        if not (root / (mod + ".py")).exists() and not (root / mod / "__init__.py").exists() and m.group(1) not in planned:
            violations.append("%s:%d: MODULE: %s" % (rel_doc, no, m.group(1)))


def check_file(root: Path, path: Path, planned, violations):
    rel_doc = path.relative_to(root).as_posix()
    in_code = False
    for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            check_commands(root, rel_doc, no, line, planned, violations)
            continue
        for m in LINK_RE.finditer(line):
            tgt = m.group(1)
            if tgt.startswith(("http://", "https://", "mailto:", "#")):
                continue
            tgt = tgt.split("#", 1)[0]
            if not tgt:
                continue
            resolved = (path.parent / tgt).resolve()
            try:
                rel = resolved.relative_to(root).as_posix()
            except ValueError:
                rel = None
            if not resolved.exists() and not (rel and exists(root, rel, planned)):
                violations.append("%s:%d: LINK: %s" % (rel_doc, no, tgt))
        for m in TICK_RE.finditer(line):
            s = m.group(1).strip()
            if line[max(0, m.start() - 4):m.start()] == "MWL ":   # 다른 저장소(MWL)의 경로 — "MWL `경로`" 로 적는다
                continue
            p = s.split("#", 1)[0]                                # `파일#앵커` 는 파일만 본다(링크와 같게)
            if looks_like_path(p) and not exists(root, p, planned):
                violations.append("%s:%d: PATH: %s" % (rel_doc, no, s))
            check_commands(root, rel_doc, no, s, planned, violations)


def check(root: Path = ROOT, release: bool = False):
    planned = load_planned(root)
    violations = ["scripts/verify_docs_planned.txt: PLANNED-EXISTS: %s (이미 있다 — 목록에서 지운다)" % p
                  for p in sorted(planned) if (root / p).exists()]
    files = targets(root, release)
    for f in files:
        check_file(root, f, planned, violations)
    return files, planned, violations


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--release", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    files, planned, violations = check(ROOT, args.release)
    if not args.quiet:
        print("검사 문서 %d개(%s), 예정 경로 %d개, 위반 %d건" % (len(files), "release" if args.release else "늘",
                                                       len(planned), len(violations)))
    for v in violations:
        print(v)
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
