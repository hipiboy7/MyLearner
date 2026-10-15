#!/usr/bin/env python3
"""tools/browser_probe.html 정적 검사 — 외부 자원 0·classic script·접근성 기초·필수 요소·Python 풀이와 맞음 (FR-160·169, NFR-107, 등급 C).

입력:  tools/browser_probe.html (다른 파일을 주면 그것)
출력:  문제 목록(표준 출력). 하나라도 있으면 종료 코드 1
트리거: scripts/verify.sh 의 정적 검사 단계
문서:  docs/P1_설계서_Probe.md 3.6절
사용: python3 scripts/check_probe_html.py [파일]
"""
from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import ai_probe as P  # noqa: E402

MAX_BYTES = 200 * 1024
REQUIRED_IDS = {"code", "rows", "progress", "selftest", "mwl-gate", "btn-gate", "btn-restart", "btn-copy", "btn-clip",
                "btn-dl", "btn-ai", "btn-cap", "btn-clean", "ai-url", "idb-mb", "errors"}
ALLOWED_HOSTS = re.compile(r"^(127\.\d+\.\d+\.\d+|localhost|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)(:\d+)?$")
URL_RE = re.compile(r"https?://([^\s/'\"<>),\\]+)")


class Scan(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids, self.labels_for, self.inputs, self.buttons, self.problems = set(), set(), [], [], []
        self.html_lang, self.charset, self.viewport = None, False, False
        self._button = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.ids.add(a["id"])
        if tag == "html":
            self.html_lang = a.get("lang")
        if tag == "meta" and (a.get("charset") or "").lower() == "utf-8":
            self.charset = True
        if tag == "meta" and a.get("name") == "viewport":
            self.viewport = True
        if tag == "script" and ("src" in a or a.get("type") == "module"):
            self.problems.append("외부·module script 를 쓴다(classic 인라인만): %s" % a)
        if tag in ("link", "iframe", "img", "embed", "object", "audio", "video", "source"):
            self.problems.append("자원을 불러오는 태그가 있다: <%s>" % tag)
        if tag == "label" and a.get("for"):
            self.labels_for.add(a["for"])
        if tag in ("input", "select", "textarea"):
            self.inputs.append(a)
        if tag == "button":
            self._button = {"attrs": a, "text": ""}

    def handle_data(self, data):
        if self._button is not None:
            self._button["text"] += data

    def handle_endtag(self, tag):
        if tag == "button" and self._button is not None:
            self.buttons.append(self._button)
            self._button = None


def check(path: Path) -> list:
    raw = path.read_bytes()
    problems = []
    if len(raw) > MAX_BYTES:
        problems.append("파일이 %d 바이트 — 상한 %d" % (len(raw), MAX_BYTES))
    text = raw.decode("utf-8")
    s = Scan()
    s.feed(text)
    problems += s.problems
    if s.html_lang != "ko":
        problems.append('<html lang="ko"> 가 아니다')
    if not s.charset:
        problems.append('<meta charset="utf-8"> 이 없다')
    if not s.viewport:
        problems.append("viewport meta 가 없다(휴대폰 폭)")
    for missing in sorted(REQUIRED_IDS - s.ids):
        problems.append("필수 요소가 없다: #%s" % missing)
    for a in s.inputs:
        if not a.get("id") or (a["id"] not in s.labels_for and not a.get("aria-label")):
            problems.append("라벨 없는 입력: %s" % a)
    for b in s.buttons:
        if not b["text"].strip():
            problems.append("글이 없는 단추: %s" % b["attrs"])
        if b["attrs"].get("type") != "button":
            problems.append('type="button" 이 없는 단추: %s' % b["text"].strip())
    for m in URL_RE.finditer(text):
        if not ALLOWED_HOSTS.match(m.group(1)):
            problems.append("외부 URL: %s" % m.group(0))
    for pat, why in ((r"@import", "@import"), (r"url\(\s*['\"]?(https?:)?//", "CSS url() 외부"),
                     (r"\bimport\s*\(", "동적 import"), (r"\beval\s*\(", "eval"), (r"new\s+Function\s*\(", "new Function"),
                     (r"\.innerHTML\b", "innerHTML(글은 textContent 로)"), (r"\bdocument\.write\b", "document.write")):
        if re.search(pat, text):
            problems.append("쓰지 않는 것을 쓴다: %s" % why)
    # Python 풀이(ai_probe.SPECS['b'])·검사합 글자·판과 맞는가
    order = re.search(r"var ORDER = \[([^\]]*)\]", text)
    js_keys = re.findall(r"'([a-z])'", order.group(1)) if order else []
    py_keys = [k for k, _, _ in P.SPECS["b"]]
    if js_keys != py_keys:
        problems.append("브라우저 코드 칸 순서가 ai_probe.SPECS['b'] 와 다르다: JS %s / Py %s" % (js_keys, py_keys))
    alpha = re.search(r"var ALPHA = '([^']+)'", text)
    if not alpha or alpha.group(1) != P.CODE_ALPHABET:
        problems.append("검사합 글자(ALPHA)가 ai_probe.CODE_ALPHABET 과 다르다")
    ver = re.search(r"var VERSION = (\d+);", text)
    if not ver or int(ver.group(1)) != P.CODE_VERSION:
        problems.append("코드 판(VERSION)이 ai_probe.CODE_VERSION 과 다르다")
    return problems


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    path = Path(argv[0]) if argv else ROOT / "tools" / "browser_probe.html"
    problems = check(path)
    for p in problems:
        print("문제: " + p)
    print("%s: 문제 %d건" % (path.name, len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
