#!/usr/bin/env python3
"""MWL 실데이터 대조(FR-251·260, NFR-202·203, 등급 C) — 기준 커밋의 MWL 미들웨어 과정을 실제로 바꾸고 그려 본다.

입력:  MWL 저장소(scripts/dev_tools.env 의 MWL_REPO)의 기준 커밋(mylearner/constants.py MWL_COMMIT) — content/ 와 web/data/bundle.js 를 git archive 로 꺼낸다
출력:  표준 출력 요약. 문제가 있으면 종료 코드 1. 바꾼 과정 파일은 임시 폴더에만(커밋하지 않는다), --out 이면 그 경로에도
트리거: scripts/verify.sh 'MWL 실데이터 대조' 단계(MWL 저장소가 없으면 그 단계는 건너뛴다), 손으로
사용:  python3 scripts/check_mwl_real.py [--out dist/courses/mwl.course.json]
단계:  ① 변환을 두 번 해 같은 바이트인지 ② Node(Docker)에서 과정 검사·개수·135과/91실습/24드릴 렌더를 MWL HTML 과 견준다(tests/realdata/mwl_check.js)
문서:  docs/P2_설계서_Core.md 2·3.6·3.9절
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from mylearner import constants as K  # noqa: E402
from scripts.import_mwl_fixtures import dev_tools  # noqa: E402


def convert(content: Path, out: Path) -> bytes:
    r = subprocess.run([sys.executable, "-m", "mylearner.convert.mwl", "--content", str(content), "--ref", "MiddlewareLearner@" + K.MWL_COMMIT,
                        "--out", str(out)], cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding="utf-8")
    print(r.stdout.strip())
    if r.returncode != 0:
        raise SystemExit(1)
    return out.read_bytes()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(allow_abbrev=False)
    ap.add_argument("--out", help="바꾼 과정 파일을 여기에도 둔다")
    args = ap.parse_args(argv)
    tools = dev_tools()
    repo = Path(tools.get("MWL_REPO", ""))
    if not (repo / ".git").exists():
        print("MWL 저장소가 없다: 이 대조는 MWL 이 있는 개발 VM 에서만 돈다")
        return 2
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        src = tmp / "mwl"
        src.mkdir()
        arc = subprocess.run(["git", "-c", "safe.directory=*", "-C", str(repo), "archive", K.MWL_COMMIT, "content", "web/data/bundle.js"],
                             check=True, stdout=subprocess.PIPE).stdout
        subprocess.run(["tar", "-x", "-C", str(src)], input=arc, check=True)
        a = convert(src / "content", tmp / "a.course.json")
        b = convert(src / "content", tmp / "b.course.json")
        if a != b:
            print("다름: 같은 입력인데 변환 결과가 다르다")
            return 1
        print("재현: 두 번 바꾼 결과가 같은 바이트 (%d B, sha256 %s)" % (len(a), hashlib.sha256(a).hexdigest()[:12]))
        if args.out:
            out = ROOT / args.out if not Path(args.out).is_absolute() else Path(args.out)
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(tmp / "a.course.json", out)
        r = subprocess.run(["docker", "run", "--rm", "--user", "%d:%d" % (_uid(), _gid()), "-v", "%s:/w:ro" % ROOT, "-v", "%s:/d:ro" % tmp,
                            "-w", "/w", tools["NODE_IMAGE"], "node", "tests/realdata/mwl_check.js", "/d/a.course.json", "/d/mwl/web/data/bundle.js"],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding="utf-8")
        print(r.stdout.strip())
        return 0 if r.returncode == 0 else 1


def _uid() -> int:
    import os
    return os.getuid()


def _gid() -> int:
    import os
    return os.getgid()


if __name__ == "__main__":
    sys.exit(main())
