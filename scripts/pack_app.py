#!/usr/bin/env python3
"""앱 묶음 — 과정 자료를 JS 로 감싸고(web/data), 판 설정을 넣고(web/config.js), 반입 묶음(.tgz, 인터넷판은 .zip 도)을 만든다 (FR-302·353·354).

입력:  web/(index.html·boot.js·styles.css·app/·core/·store/), mylearner/(서버 파일만), config/editions/<판>.json, config/bundle/(안내·실행 파일),
       과정 파일(--courses, 기본 dist/courses/*.course.json — python3 scripts/check_mwl_real.py --out … · python3 -m mylearner.convert.learn …)
출력:  --web-data            web/config.js(인터넷판, 개발용) · web/data/manifest.js · web/data/courses/<id>.js (커밋하지 않음)
       --edition 판          dist/mylearner-<판>-v<판번호>.tgz (internet 은 .zip 도). 크기와 SHA-256 을 찍는다
       --check               두 판을 두 번씩 만들어 바이트가 같은지와 판별 검사만 보고 쓰지 않는다
재현성: 이름순, mtime 고정, uid/gid 0, USTAR, gzip 머리의 이름·시각 없음, ZIP 시각 고정 -> 같은 입력이면 같은 바이트
판별:  폐쇄망판 — 앱 파일(과정 자료 밖)에 외부 URL 0(P1 pack_probe 규칙), config 의 export 거짓·link_hosts 빔·ai_presets 빔.
       과정 자료 안의 외부 주소는 읽을거리라 호스트별 개수만 찍는다(폐쇄망판은 링크로 만들지 않는다 — P3 인터뷰결과서 3절)
트리거: scripts/verify.sh 의 앱 묶음 단계(--check), 개발 중 화면(--web-data), 반입할 때 손으로(--edition)
문서:  docs/P3_설계서_PC.md 3.1·3.9절
사용:  python3 scripts/pack_app.py --web-data [--courses F ...]
       python3 scripts/pack_app.py --edition closed|internet [--courses F ...] [--out DIR]
       python3 scripts/pack_app.py --check [--courses F ...]
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from mylearner import __version__  # noqa: E402
from scripts.pack_probe import external_urls  # noqa: E402

MTIME = 1794182400          # 2026-11-09T00:00:00Z — 고정(재현성)
BOM = b"\xef\xbb\xbf"
SERVER_FILES = ["__init__.py", "__main__.py", "constants.py", "server.py", "storage.py"]
WEB_TOP = ["index.html", "boot.js", "styles.css"]
WEB_DIRS = ["app", "core", "store"]
EDITIONS = ("closed", "internet")
COURSE_FILE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
URL_HOST = re.compile(r"https?://([^\s/'\"<>),\\]+)")


def edition(name: str) -> dict:
    data = json.loads((ROOT / "config" / "editions" / ("%s.json" % name)).read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


def _json(obj) -> str:
    text = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return text.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def config_js(ed: dict) -> str:
    return ("/* MyLearner web/config.js — 판 설정(%s). 생성물: python3 scripts/pack_app.py — 손으로 고치지 않는다(config/editions/%s.json 을 고친다) */\n"
            "(function (root) { 'use strict'; (root.MyLearner = root.MyLearner || {}).config = %s; })(typeof self !== 'undefined' ? self : this);\n"
            % (ed["edition"], ed["edition"], _json(ed)))


def course_js(course: dict) -> str:
    return ("/* MyLearner 과정 자료 %s — 생성물(scripts/pack_app.py). 손으로 고치지 않는다 */\n"
            "(function (root) { 'use strict'; var ns = root.MyLearner = root.MyLearner || {}; (ns.courseData = ns.courseData || []).push(%s); })"
            "(typeof self !== 'undefined' ? self : this);\n" % (course["id"], _json(course)))


def manifest_js(entries) -> str:
    return ("/* MyLearner web/data/manifest.js — 실을 과정 자료 목록. 생성물(scripts/pack_app.py) */\n"
            "(function (root) { 'use strict'; (root.MyLearner = root.MyLearner || {}).manifest = %s; })(typeof self !== 'undefined' ? self : this);\n"
            % _json({"courses": entries}))


def load_courses(paths):
    out, seen = [], set()
    for p in sorted(Path(x) for x in paths):
        c = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(c, dict) or c.get("format") != "mylearner-course" or not COURSE_FILE.match(str(c.get("id", ""))):
            raise SystemExit("과정 파일이 아니다: %s" % p)
        if c["id"] in seen:
            raise SystemExit("같은 과정 ID 가 둘이다: %s" % c["id"])
        seen.add(c["id"])
        out.append(c)
    return sorted(out, key=lambda c: c["id"])


def data_files(courses):
    """{'courses/<id>.js': bytes, 'manifest.js': bytes}"""
    files, entries = {}, []
    for c in courses:
        data = course_js(c).encode("utf-8")
        name = "%s.js" % c["id"]
        files["courses/" + name] = data
        entries.append({"id": c["id"], "file": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    files["manifest.js"] = manifest_js(entries).encode("utf-8")
    return files


def top_name(ed: str) -> str:
    return "mylearner-%s-v%s" % (ed, __version__)


def bundle_files(ed_name: str, courses) -> dict:
    ed = edition(ed_name)
    files = {}
    for f in SERVER_FILES:
        files["mylearner/" + f] = (ROOT / "mylearner" / f).read_bytes()
    for f in WEB_TOP:
        files["web/" + f] = (ROOT / "web" / f).read_bytes()
    for d in WEB_DIRS:
        for p in sorted((ROOT / "web" / d).glob("*.js")):
            files["web/%s/%s" % (d, p.name)] = p.read_bytes()
    files["web/config.js"] = config_js(ed).encode("utf-8")
    for k, v in data_files(courses).items():
        files["web/data/" + k] = v
    port = str((ed.get("server") or {}).get("port", ""))
    readme = (ROOT / "config" / "bundle" / "README_KO.txt").read_text(encoding="utf-8")
    readme = readme.replace("@EDITION@", ed.get("label", ed_name)).replace("@VERSION@", __version__).replace("@PORT@", port)
    files["README_KO.txt"] = BOM + readme.replace("\n", "\r\n").encode("utf-8")
    files["MyLearner.cmd"] = (ROOT / "config" / "bundle" / "MyLearner.cmd").read_text(encoding="utf-8").replace("\n", "\r\n").encode("utf-8")
    files["config.json"] = (json.dumps(ed, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    return files


def tgz_bytes(top: str, files: dict) -> bytes:
    tar_buf = io.BytesIO()
    dirs = sorted({top} | {"%s/%s" % (top, "/".join(n.split("/")[:i])) for n in files for i in range(1, n.count("/") + 1)})
    with tarfile.open(fileobj=tar_buf, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for d in dirs:
            ti = tarfile.TarInfo(d)
            ti.type, ti.mode, ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = tarfile.DIRTYPE, 0o755, MTIME, 0, 0, "", ""
            tar.addfile(ti)
        for name in sorted(files):
            data = files[name]
            ti = tarfile.TarInfo("%s/%s" % (top, name))
            ti.size, ti.mode, ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = len(data), 0o644, MTIME, 0, 0, "", ""
            tar.addfile(ti, io.BytesIO(data))
    gz_buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=gz_buf, mtime=0, compresslevel=9) as g:
        g.write(tar_buf.getvalue())
    return gz_buf.getvalue()


def zip_bytes(top: str, files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files):
            zi = zipfile.ZipInfo("%s/%s" % (top, name), date_time=(2026, 11, 9, 0, 0, 0))
            zi.compress_type, zi.external_attr, zi.create_system = zipfile.ZIP_DEFLATED, 0o644 << 16, 3
            z.writestr(zi, files[name])
    return buf.getvalue()


def problems_of(ed_name: str, files: dict):
    out, hosts = [], {}
    ed = edition(ed_name)
    for name, data in sorted(files.items()):
        text = data.decode("utf-8", "replace")
        if name.startswith("web/data/courses/"):
            for m in URL_HOST.finditer(text):
                if external_urls(m.group(0)):
                    hosts[m.group(1)] = hosts.get(m.group(1), 0) + 1
            continue
        if ed_name == "closed":
            out += ["외부 URL: %s 안의 %s" % (name, u) for u in external_urls(text)]
    if ed_name == "closed":
        if ed.get("export") is not False:
            out.append("폐쇄망판 export 가 거짓이 아니다")
        if ed.get("link_hosts") != []:
            out.append("폐쇄망판 link_hosts 가 비어 있지 않다")
        if ed.get("ai_presets") != []:
            out.append("폐쇄망판 ai_presets 가 비어 있지 않다(외부 AI 프리셋 없음)")
        cfg = files["web/config.js"].decode("utf-8")
        if '"export":false' not in cfg or '"link_hosts":[]' not in cfg:
            out.append("web/config.js 에 폐쇄망판 설정이 들어가지 않았다")
    missing = [n for n in ("web/index.html", "web/config.js", "web/data/manifest.js", "mylearner/__main__.py", "README_KO.txt", "MyLearner.cmd") if n not in files]
    out += ["묶음에 없다: %s" % n for n in missing]
    if any(n.startswith("mylearner/convert") for n in files):
        out.append("변환기(mylearner/convert)는 싣지 않는다")
    return out, hosts


def write_web_data(courses, out_root: Path = ROOT / "web") -> None:
    files = data_files(courses)
    cdir = out_root / "data" / "courses"
    cdir.mkdir(parents=True, exist_ok=True)
    keep = {"courses/" + p.name for p in cdir.glob("*.js")}
    for k, v in files.items():
        (out_root / "data" / k).write_bytes(v)
        keep.discard(k)
    for stale in keep:               # 지난번에 만든 과정 자료 중 이번에 없는 것
        (out_root / "data" / stale).unlink()
    (out_root / "config.js").write_text(config_js(edition("internet")), encoding="utf-8")


def default_courses():
    return sorted(str(p) for p in (ROOT / "dist" / "courses").glob("*.course.json"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--courses", nargs="*", default=None)
    ap.add_argument("--out", default=str(ROOT / "dist"))
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--web-data", action="store_true")
    g.add_argument("--edition", choices=EDITIONS)
    g.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    paths = args.courses if args.courses is not None else default_courses()
    courses = load_courses(paths)
    if args.web_data:
        write_web_data(courses)
        print("web/data: 과정 %d개(%s) · web/config.js(인터넷판)" % (len(courses), ", ".join(c["id"] for c in courses) or "없음"))
        return 0
    names = EDITIONS if args.check else (args.edition,)
    bad = 0
    for ed in names:
        files = bundle_files(ed, courses)
        top = top_name(ed)
        a, b = tgz_bytes(top, files), tgz_bytes(top, bundle_files(ed, courses))
        problems, hosts = problems_of(ed, files)
        if a != b:
            problems.append("두 번 만든 묶음의 바이트가 다르다")
        z = zip_bytes(top, files) if ed == "internet" else None
        if z is not None and z != zip_bytes(top, bundle_files(ed, courses)):
            problems.append("두 번 만든 ZIP 의 바이트가 다르다")
        for p in problems:
            print("문제(%s): %s" % (ed, p))
        bad += len(problems)
        host_txt = ", ".join("%s %d" % (h, n) for h, n in sorted(hosts.items(), key=lambda x: (-x[1], x[0]))[:8])
        print("%s: 파일 %d개 · 과정 %d개 · .tgz %d 바이트 sha256 %s%s · 과정 자료 안 외부 주소 %d종%s" % (
            top, len(files), len(courses), len(a), hashlib.sha256(a).hexdigest()[:12], " · .zip %d 바이트" % len(z) if z else "",
            len(hosts), " (" + host_txt + ")" if hosts else ""))
        if not args.check and not problems:
            out = Path(args.out)
            out.mkdir(parents=True, exist_ok=True)
            (out / (top + ".tgz")).write_bytes(a)
            print("만듦: %s" % (out / (top + ".tgz")))
            if z is not None:
                (out / (top + ".zip")).write_bytes(z)
                print("만듦: %s" % (out / (top + ".zip")))
    if args.check and not bad:
        print("두 판 모두 두 번 만들어 같음 · 폐쇄망판 앱 파일 외부 URL 0 · 내보내기 꺼짐 · 외부 AI 프리셋 없음")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
