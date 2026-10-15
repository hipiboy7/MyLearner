#!/usr/bin/env python3
"""표준 라이브러리만으로 Python 줄 커버리지를 재고 TDD 등급별 기준을 검사한다 (FR-104).

입력:  scripts/coverage_grades.json — roots(측정 폴더), A·B(경로 앞부분 또는 '경로::함수이름패턴'), exclude, thresholds
       시험: tests/unit/py, tests/integration/py (unittest)
출력:  파일별·등급별 표(표준 출력), --json 이면 JSON 파일. --enforce 면 기준 미달·등급 없는 줄이 있을 때 종료 코드 1
트리거: scripts/verify.sh 의 커버리지 단계, 또는 손으로
문서:  docs/P1_설계서_Probe.md 3.6절, docs/설계서_Architecture.md 9절
MWL scripts/coverage_lite.py(기준 커밋 e053470)를 옮겨 고쳤다: 측정 폴더 설정, 함수 단위 등급, 시험 폴더 이름.
한계: 줄 커버리지만(분기 없음). subprocess 로 뜬 프로세스는 재지 않는다.

사용: python3 scripts/coverage_lite.py [--enforce] [--json out.json] [--suites unit,integration]
"""
from __future__ import annotations

import argparse
import ast
import fnmatch
import json
import sys
import threading
import unittest
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRADES_FILE = ROOT / "scripts" / "coverage_grades.json"


def executable_lines(tree, src_lines) -> set:
    doc = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) \
                    and isinstance(body[0].value.value, str):
                doc.update(range(body[0].lineno, getattr(body[0], "end_lineno", body[0].lineno) + 1))
    lines = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.stmt) and node.lineno not in doc:
            text = src_lines[node.lineno - 1] if node.lineno - 1 < len(src_lines) else ""
            if "pragma: no cover" not in text:
                lines.add(node.lineno)
    return lines


def file_grade(rel, grades):
    for g in ("A", "B"):
        for entry in grades.get(g, []):
            if "::" not in entry and (rel == entry or rel.startswith(entry.rstrip("/") + "/")):
                return g
    return None


def line_grades(rel, tree, grades) -> dict:
    """최상위 함수·클래스 이름이 '경로::패턴' 에 맞으면 그 줄은 그 등급이다."""
    patterns = [(g, e.split("::", 1)[1]) for g in ("A", "B") for e in grades.get(g, [])
                if "::" in e and e.split("::", 1)[0] == rel]
    out = {}
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        for g, pat in patterns:
            if fnmatch.fnmatchcase(node.name, pat):
                start = min([node.lineno] + [d.lineno for d in node.decorator_list])
                for ln in range(start, node.end_lineno + 1):
                    out[ln] = g
                break
    return out


def measured_files(grades):
    excluded = set(grades.get("exclude", []))
    for root in grades.get("roots", []):
        base = ROOT / root
        if not base.is_dir():
            continue
        for py in sorted(base.rglob("*.py")):
            rel = py.relative_to(ROOT).as_posix()
            if rel not in excluded and "__pycache__" not in rel:
                yield py, rel


def run_suites(suites, hits, prefixes):
    def tracer(frame, event, arg):
        fn = frame.f_code.co_filename
        if not fn.startswith(prefixes):
            return None
        if event == "line":
            hits[fn].add(frame.f_lineno)
        return tracer

    sys.path.insert(0, str(ROOT))
    sys.settrace(tracer)
    threading.settrace(tracer)
    try:
        loader, suite = unittest.TestLoader(), unittest.TestSuite()
        for s in suites:
            d = ROOT / "tests" / s.strip() / "py"
            if d.is_dir():
                suite.addTests(loader.discover(str(d), pattern="test_*.py", top_level_dir=str(ROOT)))
        return unittest.TextTestRunner(verbosity=1, stream=sys.stderr).run(suite)
    finally:
        sys.settrace(None)
        threading.settrace(None)  # type: ignore[arg-type]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--suites", default="unit,integration")
    ap.add_argument("--json", dest="json_out", default=None)
    ap.add_argument("--enforce", action="store_true")
    ap.add_argument("--grades", default=str(GRADES_FILE))
    args = ap.parse_args(argv)
    grades = json.loads(Path(args.grades).read_text(encoding="utf-8"))
    hits = defaultdict(set)
    prefixes = tuple(str(ROOT / r) for r in grades.get("roots", []))
    result = run_suites(args.suites.split(","), hits, prefixes)

    rows, agg, unassigned = [], defaultdict(lambda: [0, 0]), []
    for py, rel in measured_files(grades):
        src = py.read_text(encoding="utf-8")
        tree = ast.parse(src)
        total = executable_lines(tree, src.splitlines())
        per_line = line_grades(rel, tree, grades)
        default = file_grade(rel, grades)
        hit = hits.get(str(py), set())
        by_grade = defaultdict(lambda: [0, 0, []])
        for ln in sorted(total):
            g = per_line.get(ln, default) or "?"
            cell = by_grade[g]
            cell[1] += 1
            if ln in hit:
                cell[0] += 1
            else:
                cell[2].append(ln)
        for g, (h, t, missing) in sorted(by_grade.items()):
            rows.append({"file": rel, "grade": g, "total": t, "hit": h, "pct": round(100.0 * h / t, 1) if t else 100.0,
                         "missing": missing})
            agg[g][0] += h
            agg[g][1] += t
            if g == "?":
                unassigned.append(rel)

    print("\n%-44s %-4s %5s %5s %7s" % ("파일", "등급", "줄", "실행", "커버"))
    for r in rows:
        print("%-44s %-4s %5d %5d %6.1f%%" % (r["file"], r["grade"], r["total"], r["hit"], r["pct"]))
    summary = {}
    print("\n등급별:")
    for g in sorted(agg):
        h, t = agg[g]
        pct = 100.0 * h / t if t else 0.0
        summary[g] = {"hit": h, "total": t, "pct": round(pct, 1)}
        print("  %s: %d/%d = %.1f%%" % (g, h, t, pct))
    print("\n테스트: %d건, 실패 %d, 오류 %d, 건너뜀 %d" % (result.testsRun, len(result.failures), len(result.errors),
                                                    len(result.skipped)))
    below = ["%s=%s%% < %s%%" % (g, summary[g]["pct"], th) for g, th in grades.get("thresholds", {}).items()
             if g in summary and summary[g]["pct"] < th]
    if args.json_out:
        Path(args.json_out).write_text(json.dumps({"files": rows, "summary": summary, "tests_run": result.testsRun,
                                                   "tests_ok": result.wasSuccessful()}, ensure_ascii=False, indent=2,
                                                  sort_keys=True), encoding="utf-8")
    if not result.wasSuccessful():
        return 1
    if args.enforce and (below or unassigned):
        if below:
            print("기준 미달: " + ", ".join(below))
        if unassigned:
            print("등급이 없는 줄이 있는 파일: " + ", ".join(sorted(set(unassigned))))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
