#!/usr/bin/env python3
"""공개 전 점검 — 추적·새 파일에서 IP·토큰·메일·커밋 금지 파일을 찾는다 (FR-105, CLAUDE.md 8·11절, Learn 루트 2절).

입력:  git ls-files --cached --others --exclude-standard (커밋 전 새 파일도 본다)
출력:  찾은 것(표준 출력). 하나라도 있으면 종료 코드 1
막는 것: IPv4(루프백 127/8·0.0.0.0·문서용 RFC 5737 세 대역 빼고. 줄에 'ip-ok' 가 있으면 뺀다 — 이유를 같은 줄에 적는다)
        토큰 꼴(gh?_·sk-·AKIA·개인 키 머리·JWT), 메일(예시 도메인·noreply@anthropic.com 빼고), 커밋 금지 파일
트리거: scripts/verify.sh 의 공개 전 점검 단계(push 전 필수)
문서:  docs/P1_설계서_Probe.md 3.6절
MWL scripts/check_publish_safety.py(기준 커밋 e053470)를 본떴다 — MWL 은 사설 IP 를 허용했지만 여기서는 사내 서버 주소가
사설 IP 이므로 막는다.
사용: python3 scripts/check_publish_safety.py
"""
from __future__ import annotations

import fnmatch
import ipaddress
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IPV4_RE = re.compile(r"(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])")
ALLOWED_NETS = [ipaddress.ip_network(n) for n in ("127.0.0.0/8", "0.0.0.0/32", "192.0.2.0/24", "198.51.100.0/24",
                                                  "203.0.113.0/24")]
TOKEN_RES = [
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), "GitHub 토큰"),
    (re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}"), "API 키(sk-)"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS 키"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "개인 키"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"), "JWT"),
]
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
EMAIL_ALLOW_DOMAINS = re.compile(r"@(?:[\w.-]+\.)?(?:example\.(?:com|org|net)|example|localhost|test)$", re.I)
EMAIL_ALLOW = {"noreply@anthropic.com", "git@github.com"}   # 뒤의 것은 SSH 주소(ssh -T git@github.com)다
FORBIDDEN = [".env", "*.key", "*.pem", "*.jks", "*.keystore", "secrets/*", "*/secrets/*", "ai_probe_result*.txt",
             "*/ai_probe_result*.txt"]
BINARY = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".tgz", ".gz", ".jar", ".apk", ".woff", ".woff2"}


def candidate_files(root: Path):
    out = subprocess.run(["git", "-c", "core.quotePath=false", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=root, capture_output=True, text=True, check=True).stdout
    return [x for x in out.splitlines() if x and (root / x).is_file()]


def bad_ip(text: str) -> bool:
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        return False
    return not any(ip in n for n in ALLOWED_NETS)


def scan_text(rel: str, text: str):
    found = []
    for no, line in enumerate(text.splitlines(), 1):
        if "ip-ok" not in line:
            for m in IPV4_RE.finditer(line):
                if bad_ip(m.group(0)):
                    found.append((rel, no, "IP", m.group(0)))
        for rx, label in TOKEN_RES:
            for m in rx.finditer(line):
                found.append((rel, no, label, m.group(0)[:12] + "..."))
        for m in EMAIL_RE.finditer(line):
            mail = m.group(0)
            if mail.lower() not in EMAIL_ALLOW and not EMAIL_ALLOW_DOMAINS.search(mail):
                found.append((rel, no, "메일", mail))
    return found


def scan(root: Path, files):
    found = []
    for rel in files:
        if any(fnmatch.fnmatch(rel, pat) for pat in FORBIDDEN):
            found.append((rel, 0, "커밋 금지 파일", rel))
            continue
        if Path(rel).suffix.lower() in BINARY:
            continue
        try:
            text = (root / rel).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        found += scan_text(rel, text)
    return found


def main(argv=None) -> int:
    files = candidate_files(ROOT)
    found = scan(ROOT, files)
    for rel, no, kind, what in found:
        print("막음: %s:%d %s %s" % (rel, no, kind, what))
    print("검사 파일 %d개, 막은 것 %d건" % (len(files), len(found)))
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
