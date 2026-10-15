#!/usr/bin/env python3
"""MWL 골든 벡터를 기준 커밋에서 이 저장소로 복사하고, 그 계획 시험용 과정 파일을 만든다(FR-263, 등급 C).

입력:  MWL 저장소(scripts/dev_tools.env 의 MWL_REPO, 또는 --mwl)의 기준 커밋(mylearner/constants.py MWL_COMMIT)의
       tests/fixtures/srs_vectors.json·scheduler_cases.json
출력:  tests/fixtures/mwl/srs_vectors.json·scheduler_cases.json(바이트 그대로), scheduler_course.json(content → 과정 파일),
       markdown_parity.json(tests/fixtures/markdown_inputs.json 을 MWL mwl/content/markdown.py 로 그린 결과), source.json(기준 커밋·파일 해시)
트리거: 손으로(기준 커밋을 바꿀 때), --check 는 전체 검증의 '골든 벡터 복사본' 단계
사용:  python3 scripts/import_mwl_fixtures.py [--mwl DIR] [--check] [--dir 고정 자료 폴더(기본 tests/fixtures/mwl)]
       --check: 쓰지 않고 견준다. MWL 저장소가 없으면 원본 대조는 건너뛰고(알린다) 복사본에서 만든 과정만 견준다
문서:  docs/P2_설계서_Core.md 2·3.5절
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from mylearner import constants as K  # noqa: E402
from mylearner.convert import mwl as M  # noqa: E402

OUT = ROOT / "tests" / "fixtures" / "mwl"
FILES = ("srs_vectors.json", "scheduler_cases.json")


def dev_tools():
    out = {}
    for line in (ROOT / "scripts" / "dev_tools.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def from_mwl(repo: Path, name: str) -> bytes:
    return subprocess.run(["git", "-c", "safe.directory=*", "-C", str(repo), "show", "%s:tests/fixtures/%s" % (K.MWL_COMMIT, name)],
                          check=True, stdout=subprocess.PIPE).stdout


def mwl_markdown(repo: Path):
    """MWL 렌더러(markdown.py)를 기준 커밋에서 꺼내 따로 된 이름공간에서 읽는다 — MWL 패키지를 가져오지 않는다."""
    src = subprocess.run(["git", "-c", "safe.directory=*", "-C", str(repo), "show", "%s:mwl/content/markdown.py" % K.MWL_COMMIT],
                         check=True, stdout=subprocess.PIPE).stdout.decode("utf-8")
    ns = {"__name__": "mwl_markdown_e55b9c0"}
    exec(compile(src, "mwl/content/markdown.py@" + K.MWL_COMMIT, "exec"), ns)  # noqa: S102 — 읽기만 하는 MWL 원본(같은 사용자의 저장소)
    return ns["render_markdown"]


def parity(render, inputs_path: Path) -> bytes:
    inputs = json.loads(inputs_path.read_text(encoding="utf-8"))
    out = [{"name": c["name"], "md": c["md"], "html": render(c["md"])} for c in inputs]
    return (json.dumps(out, ensure_ascii=False, indent=1) + "\n").encode("utf-8")


def build(cases_bytes: bytes) -> dict:
    files = {}
    cases = json.loads(cases_bytes.decode("utf-8"))
    ref = "MiddlewareLearner@%s" % K.MWL_COMMIT
    files["scheduler_course.json"] = M.dumps(M.to_course(cases["content"], ref)).encode("utf-8")
    return files


def source_json(originals: dict) -> bytes:
    data = {"repo": "MiddlewareLearner", "commit": K.MWL_COMMIT, "path": "tests/fixtures/",
            "sha256": {n: hashlib.sha256(b).hexdigest() for n, b in sorted(originals.items())},
            "note": "scheduler_course.json 은 scheduler_cases.json 의 content 를 mylearner.convert.mwl.to_course 로 바꾼 것"}
    return (json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(allow_abbrev=False)
    ap.add_argument("--mwl", default=dev_tools().get("MWL_REPO", ""))
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--dir", default=str(OUT), help="고정 자료 폴더(시험은 사본을 준다)")
    args = ap.parse_args(argv)
    out_dir = Path(args.dir)
    repo = Path(args.mwl) if args.mwl else None
    have_repo = bool(repo) and (repo / ".git").exists()
    problems = []
    if have_repo:
        originals = {n: from_mwl(repo, n) for n in FILES}
    elif args.check:
        print("MWL 저장소가 없다: 원본 대조는 건너뛰고 복사본으로 만든 과정만 견준다")
        originals = {n: (out_dir / n).read_bytes() for n in FILES}
    else:
        print("MWL 저장소가 없다: --mwl 로 준다")
        return 2
    want = dict(originals)
    want.update(build(originals["scheduler_cases.json"]))
    if have_repo:
        want["markdown_parity.json"] = parity(mwl_markdown(repo), out_dir.parent / "markdown_inputs.json")
    want["source.json"] = source_json(originals)
    for name, data in sorted(want.items()):
        path = out_dir / name
        if args.check:
            if not path.is_file() or path.read_bytes() != data:
                problems.append(name)
        else:
            out_dir.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    if args.check:
        if problems:
            print("다르다: %s - python3 scripts/import_mwl_fixtures.py 로 다시 만든다" % ", ".join(problems))
            return 1
        print("골든 벡터 복사본이 MiddlewareLearner@%s 와 같다 (%d개 파일)%s" % (K.MWL_COMMIT, len(want), "" if have_repo else " - 원본 대조 건너뜀"))
        return 0
    print("썼다: %s" % ", ".join(sorted(want)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
