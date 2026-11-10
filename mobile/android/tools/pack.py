#!/usr/bin/env python3
"""안드로이드 APK 조립 도우미 — 표준 라이브러리만. scripts/build_android.sh 가 부른다(등급 B).

  pack.py version                         -> "0.4.0 400"  (mylearner/__init__.py 의 __version__ -> versionName · versionCode)
  pack.py stage <web 사본 폴더> <출력 폴더> -> <출력>/assets/web/ 에 사본 + 셸 스크립트. index.html 사본에만 한 줄을 넣는다
  pack.py add-dex <base.apk> <classes.dex> <out.apk>
                                          -> aapt2 가 만든 APK 에 classes.dex 를 붙인다(기존 항목의 바이트는 건드리지 않는다)
  pack.py check <badging> <permissions> <xmltree> <버전> <코드> <디버그 0|1>
                                          -> 패키지·판·SDK·권한 0·exported 1·디버그 표시 점검. 문제를 찍고 종료 코드 1

versionCode = 주x10000 + 부x100 + 수(0.4.0 -> 400). 판을 올릴 때마다 커지고, 같은 판을 다시 빌드하면 같다(같은 입력 -> 같은 APK).
web 사본은 scripts/pack_app.py --edition mobile --web-out 이 만든다(모바일판 config.js + 과정 자료).
MWL mobile/android/tools/pack.py(MiddlewareLearner@e55b9c0)를 옮겨 고쳤다. 문서: docs/P4_설계서_Mobile.md 3.8절
"""
from __future__ import annotations

import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SHELL = ROOT / "mobile" / "android" / "shell" / "android-shell.js"
TAG = '<script src="android-shell.js"></script>'
LINK = '<link rel="stylesheet" href="styles.css">'
FIXED_TIME = (1981, 1, 1, 1, 1, 2)     # zip 항목 시각을 고정한다(재현 가능한 빌드)
PACKAGE = "io.github.hipiboy7.mylearningplatform"
MIN_SDK, TARGET_SDK = 26, 36


def version() -> tuple:
    text = (ROOT / "mylearner" / "__init__.py").read_text(encoding="utf-8")
    m = re.search(r'__version__\s*=\s*"(\d+)\.(\d+)\.(\d+)"', text)
    if not m:
        raise SystemExit('mylearner/__init__.py 에서 __version__ = "주.부.수" 를 찾지 못했다')
    major, minor, patch = (int(x) for x in m.groups())
    if minor > 99 or patch > 99:
        raise SystemExit("versionCode 규칙(주x10000+부x100+수)은 부·수가 99 까지다")
    return "%d.%d.%d" % (major, minor, patch), major * 10000 + minor * 100 + patch


def stage(web: Path, out: Path) -> int:
    dst = out / "assets" / "web"
    if dst.exists():
        shutil.rmtree(dst)
    if not (web / "index.html").is_file() or not (web / "data" / "manifest.js").is_file():
        raise SystemExit("web 사본이 아니다(index.html·data/manifest.js 없음): %s" % web)
    files = sorted(p for p in web.rglob("*") if p.is_file() and not p.name.endswith(".tmp"))
    for p in files:
        q = dst / p.relative_to(web)
        q.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, q)
    shutil.copyfile(SHELL, dst / SHELL.name)
    index = dst / "index.html"
    html = index.read_text(encoding="utf-8")
    # 스타일시트 바로 뒤 — boot.js·config.js·화면 스크립트보다 먼저 MyLearner.platform 을 둔다
    if html.count(LINK) != 1 or TAG in html or html.find("<script") < html.find(LINK):
        raise SystemExit("index.html 의 스타일시트 줄이 하나가 아니거나, 그 앞에 스크립트가 있거나, 셸 스크립트가 이미 있다")
    index.write_text(html.replace(LINK, LINK + "\n" + TAG), encoding="utf-8")
    cfg = (dst / "config.js").read_text(encoding="utf-8")
    if '"edition":"mobile"' not in cfg:
        raise SystemExit("web 사본의 config.js 가 모바일판이 아니다 — scripts/pack_app.py --edition mobile --web-out 으로 만든다")
    total = sum(p.stat().st_size for p in dst.rglob("*") if p.is_file())
    print("사본: %s - 파일 %d개, %dKB (index.html 사본에 셸 스크립트 한 줄)" % (dst, len(files) + 1, total // 1024))
    return 0


def add_dex(base: Path, dex: Path, out: Path) -> int:
    shutil.copyfile(base, out)
    with zipfile.ZipFile(out, "a") as z:
        if "classes.dex" in z.namelist():
            raise SystemExit("base.apk 에 이미 classes.dex 가 있다")
        info = zipfile.ZipInfo("classes.dex", date_time=FIXED_TIME)
        info.compress_type = zipfile.ZIP_STORED    # 압축하지 않는다 — 기기가 바로 읽고, zlib 판에 따라 바이트가 달라질 일도 없다
        info.create_system = 0
        info.external_attr = 0
        z.writestr(info, dex.read_bytes())
    return 0


def check(badging: str, permissions: str, xmltree: str, ver: str, code: int, debug: bool) -> list:
    """빌드한 APK 의 aapt2 dump 결과를 본다 — NFR-401(권한 0)을 명령 단위로"""
    out = []
    head = "package: name='%s' versionCode='%d' versionName='%s'" % (PACKAGE, code, ver)
    if not badging.startswith(head):
        out.append("패키지·판이 다르다: %s" % badging.splitlines()[0][:160] if badging else "badging 이 비었다")
    if "minSdkVersion:'%d'" % MIN_SDK not in badging and "sdkVersion:'%d'" % MIN_SDK not in badging:
        out.append("minSdk %d 이 아니다" % MIN_SDK)
    if "targetSdkVersion:'%d'" % TARGET_SDK not in badging:
        out.append("targetSdk %d 이 아니다" % TARGET_SDK)
    perms = [ln.strip() for ln in permissions.splitlines() if "uses-permission" in ln or "permission:" in ln]
    if perms:
        out.append("권한이 있다: %s" % "; ".join(perms))
    exported = len(re.findall(r":exported\([^)]*\)=(?:true|\(type 0x12\)0xffffffff)", xmltree))
    if exported != 1:
        out.append("exported 구성요소가 %d개다(런처 액티비티 하나여야 한다)" % exported)
    dbg = re.search(r":debuggable\([^)]*\)=(?:true|\(type 0x12\)0xffffffff)", xmltree) is not None or "application-debuggable" in badging
    if dbg != debug:
        out.append("디버그 표시가 %s 다(기대 %s)" % ("있" if dbg else "없", "있음" if debug else "없음"))
    if "allowBackup" in xmltree and re.search(r":allowBackup\([^)]*\)=(?:true|\(type 0x12\)0xffffffff)", xmltree):
        out.append("allowBackup 이 켜져 있다")
    return out


def main(argv: list) -> int:
    if argv[:1] == ["version"]:
        name, code = version()
        print(name, code)
        return 0
    if argv[:1] == ["stage"] and len(argv) == 3:
        return stage(Path(argv[1]), Path(argv[2]))
    if argv[:1] == ["add-dex"] and len(argv) == 4:
        return add_dex(Path(argv[1]), Path(argv[2]), Path(argv[3]))
    if argv[:1] == ["check"] and len(argv) == 7:
        rd = lambda p: Path(p).read_text(encoding="utf-8", errors="replace")  # noqa: E731
        probs = check(rd(argv[1]), rd(argv[2]), rd(argv[3]), argv[4], int(argv[5]), argv[6] == "1")
        for p in probs:
            print("문제: %s" % p)
        return 1 if probs else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
