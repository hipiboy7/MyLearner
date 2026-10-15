#!/usr/bin/env python3
"""폐쇄망 반입 묶음 — dist/mylearner-probe-v<판>.tgz (FR-106, CLAUDE.md 5·13절).

입력:  tools/ai_probe.py, tools/browser_probe.html, tools/README_KO.txt
출력:  dist/mylearner-probe-v<판>.tgz (안의 폴더 mylearner-probe-v<판>/). 크기와 SHA-256 을 찍는다
       --check 면 묶음을 두 번 만들어 바이트가 같은지와 외부 URL 0 만 보고 dist/ 에 쓰지 않는다
재현성: 이름순, mtime 고정, uid/gid 0, 사용자 이름 없음, USTAR, gzip 머리의 이름·시각 없음 -> 같은 입력·같은 zlib 이면 같은 바이트
외부 URL: 묶음 안 글에 루프백(127.*, localhost)과 문서용 대역(RFC 5737) 말고는 http(s) 주소가 없어야 한다
트리거: scripts/verify.sh 의 묶음 단계(--check), 반입할 때 손으로
문서:  docs/P1_설계서_Probe.md 3.6절
사용: python3 scripts/pack_probe.py [--out DIR] [--check]
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import re
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import ai_probe as P  # noqa: E402

FILES = ["tools/ai_probe.py", "tools/browser_probe.html", "tools/README_KO.txt"]
MTIME = 1792022400          # 2026-10-15T00:00:00Z — 고정(재현성)
BOM = b"\xef\xbb\xbf"
URL_RE = re.compile(r"https?://([^\s/'\"<>),\\]+)")
ALLOWED_HOST = re.compile(r"^(127\.\d+\.\d+\.\d+|localhost|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)(:[\d%a-z]+)?$")


def top_name() -> str:
    return "mylearner-probe-v%d" % P.CODE_VERSION


def external_urls(text: str):
    return [m.group(0) for m in URL_RE.finditer(text) if not ALLOWED_HOST.match(m.group(1))]


def contents():
    out = []
    for rel in FILES:
        data = (ROOT / rel).read_bytes()
        if rel.endswith(".txt") and not data.startswith(BOM):
            data = BOM + data                       # 메모장이 UTF-8 로 알아보게
        out.append((Path(rel).name, data))
    return sorted(out)


def build_bytes() -> bytes:
    top = top_name()
    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        d = tarfile.TarInfo(top)
        d.type, d.mode, d.mtime, d.uid, d.gid, d.uname, d.gname = tarfile.DIRTYPE, 0o755, MTIME, 0, 0, "", ""
        tar.addfile(d)
        for name, data in contents():
            ti = tarfile.TarInfo(top + "/" + name)
            ti.size, ti.mode, ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = (
                len(data), 0o755 if name.endswith(".py") else 0o644, MTIME, 0, 0, "", "")
            tar.addfile(ti, io.BytesIO(data))
    gz_buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=gz_buf, mtime=0, compresslevel=9) as g:
        g.write(tar_buf.getvalue())
    return gz_buf.getvalue()


def problems_of(blob: bytes):
    out = []
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        names = sorted(m.name for m in tar.getmembers())
        want = sorted([top_name()] + ["%s/%s" % (top_name(), Path(f).name) for f in FILES])
        if names != want:
            out.append("묶음 목록이 다르다: %s" % names)
        for m in tar.getmembers():
            if m.isfile():
                text = tar.extractfile(m).read().decode("utf-8", "replace")
                out += ["외부 URL: %s 안의 %s" % (m.name, u) for u in external_urls(text)]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "dist"))
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    a, b = build_bytes(), build_bytes()
    problems = [] if a == b else ["두 번 만든 묶음의 바이트가 다르다"]
    problems += problems_of(a)
    for p in problems:
        print("문제: " + p)
    if problems:
        return 1
    digest = hashlib.sha256(a).hexdigest()
    if args.check:
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / (top_name() + ".tgz")).write_bytes(a)
        print("묶음 %s.tgz: %d 바이트, sha256 %s, 두 번 만들어 같음, 외부 URL 0" % (top_name(), len(a), digest))
        return 0
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    path = out / (top_name() + ".tgz")
    path.write_bytes(a)
    print("만듦: %s (%d 바이트, sha256 %s)" % (path, len(a), digest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
