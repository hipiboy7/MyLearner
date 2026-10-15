#!/usr/bin/env python3
"""MyLearner 폐쇄망 AI 점검 도구 - 사내 AI 서버와 모델을 재고 짧은 결과 코드를 낸다.

입력:   서버 주소와 키(대화형, 키는 화면에 보이지 않게). 시험용으로 --server / --key-env
출력:   화면의 한국어 결과 풀이 + 결과 코드(줄마다 검사합) + 실행한 폴더의 ai_probe_result_<시각>.txt
        주소, IP, 포트, 키는 결과 코드와 결과 파일 어디에도 남기지 않는다.
트리거: 사용자가 폐쇄망 PC 에서 `py -3 ai_probe.py` 로 실행한다.
        --serve-test : 127.0.0.1 시험 서버로 같은 폴더의 browser_probe.html 을 연다(서버 모드 리허설)
        --decode     : 결과 코드 줄의 검사합을 확인하고 뜻을 풀어 보인다(개발 쪽)
문서:   docs/P1_요구사항정의서_Probe.md (FR-110~150), docs/P1_설계서_Probe.md (3절, 결과 코드 v1)
조건:   Python 3.9 이상 표준 라이브러리만(3.9 문법). Windows, Linux.
등급:   판정과 결과 코드 함수는 A, 호출과 흐름은 B (scripts/coverage_grades.json)
"""
from __future__ import annotations

import argparse
import datetime
import getpass
import hmac
import http.client
import http.cookies
import http.server
import json
import os
import platform
import re
import secrets
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings
import webbrowser
from pathlib import Path

# ---------------------------------------------------------------- 상수 (단독 도구라 여기에 둔다 - 설계서_Architecture 6절)
CODE_VERSION = 1
CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"   # Crockford base32 소문자
LONG_CHARS = 9000                                     # 긴 한국어 질문 길이(약 6k 토큰). 바꾸면 CODE_VERSION 을 올린다
START_MARK = "KIWI-4817"
END_MARK = "PLUM-2931"
DEFAULT_MAX_CALLS = 80
DEFAULT_TIMEOUT = 300.0                                # 공유 GPU 의 추론 high 는 180초를 넘을 수 있다
MAX_BODY = 8 * 1024 * 1024
HUGE_MAX_TOKENS = 10000000
SERVE_PORT = 8770                                     # MWL 서버(8765)와 다르게
SERVE_BODY_LIMIT = 8 * 1024 * 1024
RESULT_LIMIT = 2048
MAX_LINE, MAX_TOKEN = 600, 64                          # 결과 코드 한 줄·한 칸의 최대 길이(--decode 가 큰 입력에 멈추지 않게)
MAX_COUNT = 10 ** 9                                   # 토큰 수·문맥 길이로 믿는 최대값
SECRET_WINDOW = 8                                     # 비밀값의 영문·숫자가 이만큼 이어져 보이면 가린다
SMALL_Q = "1부터 40까지의 정수 가운데 3의 배수이면서 4의 배수가 아닌 수는 모두 몇 개인가? 숫자만 답하라."
JSON_Q = "사과 3개와 배 4개가 있다. 과일은 모두 몇 개인가? answer 에 정수, unit 에 단위를 넣은 JSON 으로만 답하라."
RESP_Q = "2 더하기 3 은? 숫자만 답하라."
CTX_Q = "'네' 라고만 답하라."
JSON_SCHEMA_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "probe_answer",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"answer": {"type": "integer"}, "unit": {"type": "string"}},
            "required": ["answer", "unit"],
            "additionalProperties": False,
        },
    },
}
CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; "
       "connect-src 'self' http: https:; base-uri 'none'; form-action 'none'")
FORBIDDEN_HTML = ("<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><title>MyLearner 점검</title>"
                  "<p>토큰이 맞지 않습니다. 콘솔에 찍힌 주소를 그대로 여세요.</p></html>")

ERR = {
    "!t": "시간 초과", "!c": "연결 안 됨", "!x": "TLS(인증서) 오류", "!r": "리다이렉트(따르지 않음)",
    "!a": "인증 필요 또는 거부(401, 403)", "!n": "없음(404)", "!l": "길이 초과(400, 413)", "!4": "요청 거부(4xx)",
    "!5": "서버 오류(5xx)", "!h": "HTML 답(게이트웨이 화면)", "!j": "JSON 아님 또는 모양이 다름",
    "!q": "호출 상한에 걸려 하지 않음", "!s": "멈춤 또는 앞 단계 실패로 건너뜀", "-": "해당 없음 또는 하지 않음",
    "!p": "키를 보내지 않음(http 주소가 프록시를 거치고, 프록시 없이는 닿지 않음)",
    "!e": "예상하지 못한 오류(화면에 오류 이름만 찍음)", "?": "판정 못 함 또는 가림",
}


# ================================================================ A 등급: 결과 코드
def crc16(data: bytes) -> int:
    """CRC-16/CCITT-FALSE (다항식 0x1021, 초기값 0xFFFF). 검산 값: b"123456789" -> 0x29B1."""
    c = 0xFFFF
    for b in data:
        c ^= b << 8
        for _ in range(8):
            c = ((c << 1) ^ 0x1021) & 0xFFFF if c & 0x8000 else (c << 1) & 0xFFFF
    return c


def canonical(text: str) -> str:
    return " ".join(str(text).lower().split())


def checksum(text: str) -> str:
    v = crc16(canonical(text).encode("utf-8")) & 0x3FF
    return CODE_ALPHABET[v >> 5] + CODE_ALPHABET[v & 31]


_VALUE_BAD = re.compile(r"[^a-z0-9._/!:+?-]")
_NAME_BAD = re.compile(r"[^a-z0-9._-]")
_TAG_RE = re.compile(r"^(e|b|s\d+|s\d+m\d+)$")
_FIELD_RE = re.compile(r"^([a-z])=(\S+)$")


def _value(v) -> str:
    if v is None:
        return "-"
    if isinstance(v, bool):
        return "y" if v else "n"
    if isinstance(v, float):
        return "%.2f" % v
    s = re.sub(r"\s+", "_", str(v).strip().lower())
    return _VALUE_BAD.sub("_", s)[:40] or "-"


def model_short(model_id) -> str:
    s = str(model_id or "").strip().rstrip("/").rsplit("/", 1)[-1].lower()
    return _NAME_BAD.sub("_", s)[:32] or "-"


def make_line(tag, fields, name=None) -> str:
    parts = [str(tag).lower()]
    if name is not None:
        parts.append("?" if name == "?" else model_short(name))   # '?' = 주소·키처럼 보여 가린 이름
    parts += ["%s=%s" % (k, _value(v)) for k, v in fields]
    content = " ".join(parts)
    return content + " /" + checksum(content)


def parse_line(text) -> dict:
    """결과 코드 한 줄을 읽는다. 모양이 틀리면 ValueError, 검사합이 틀리면 ok=False."""
    s = canonical(text)
    if len(s) > MAX_LINE:
        raise ValueError("줄이 너무 깁니다")
    if " /" not in s:
        raise ValueError("끝의 검사합(/두 글자)이 없습니다")
    content, got = s.rsplit(" /", 1)
    got = got.strip().translate(str.maketrans("ilo", "110"))
    if not re.fullmatch(r"[0-9a-z]{2}", got):
        raise ValueError("검사합은 두 글자입니다")
    tokens = content.split()
    if any(len(t) > MAX_TOKEN for t in tokens):
        raise ValueError("칸이 너무 깁니다")
    if not tokens or not _TAG_RE.match(tokens[0]):
        raise ValueError("줄 머리(e, s1, s1m1, b)를 알 수 없습니다")
    tag, rest, name = tokens[0], tokens[1:], None
    if re.fullmatch(r"s\d+m\d+", tag):
        if not rest:
            raise ValueError("모델 이름이 없습니다")
        name, rest = rest[0], rest[1:]
    fields = {}
    for t in rest:
        m = _FIELD_RE.match(t)
        if not m:
            raise ValueError("칸 모양(글자=값)이 아닙니다: " + t)
        fields[m.group(1)] = m.group(2)
    expected = checksum(content)
    return {"tag": tag, "name": name, "fields": fields, "ok": expected == got, "expected": expected, "got": got,
            "line": content + " /" + got}


def env_line(env) -> str:
    return make_line("e", [("v", CODE_VERSION), ("p", env.get("py")), ("o", env.get("os")), ("q", env.get("proxy")),
                           ("a", env.get("pac")), ("s", env.get("servers"))])


def server_line(idx, s) -> str:
    f = [("k", s.get("kind")), ("h", s.get("server")), ("n", s.get("n")), ("m", s.get("m")), ("a", s.get("auth")),
         ("x", s.get("cors")), ("q", s.get("route")), ("l", s.get("tls")), ("d", s.get("redir"))]
    if s.get("error"):
        f.append(("e", s["error"]))
    return make_line("s%d" % idx, f)


def model_line(sidx, midx, m) -> str:
    ctx = m.get("ctx")
    c = "%d%s" % (ctx, m.get("ctx_src") or "") if isinstance(ctx, int) and not isinstance(ctx, bool) else "?"
    f = [("c", c)]
    if m.get("win"):
        f.append(("w", m["win"]))
    f += [("t", m.get("cpt")), ("p", m.get("prefill")), ("d", m.get("decode")), ("k", m.get("cut")),
          ("r", m.get("r")), ("f", m.get("rfield")), ("h", m.get("leak")), ("z", m.get("think_off")),
          ("j", m.get("json")), ("o", m.get("resp"))]
    return make_line("s%dm%d" % (sidx, midx), f, name=m.get("name"))


# ---------------------------------------------------------------- A 등급: 풀이
def _common(v):
    return ERR.get(v)


def _pick(v, table):
    return table.get(v) or _common(v) or v


def _reasoning_meaning(v):
    m = re.fullmatch(r"(\d+)/(\d+)([tco])", v)
    if not m:
        return "추론 정보 없음" if v == "-" else (_common(v) or v)
    lo, hi, src = int(m.group(1)), int(m.group(2)), m.group(3)
    src_name = {"t": "추론 토큰", "c": "추론 글자 수", "o": "답 토큰"}[src]
    verdict = "반영됨" if judge_reasoning(lo, hi, src) == "y" else "반영 안 됨"
    return "low %d -> high %d (%s) = %s" % (lo, hi, src_name, verdict)


def _os_meaning(v):
    if v.startswith("w"):
        return "Windows " + v[1:]
    if v.startswith("l"):
        return "Linux " + v[1:]
    if v.startswith("m"):
        return "macOS " + v[1:]
    return v


def _kind_meaning(v):
    if v.startswith("vllm"):
        return "vLLM " + v[5:] if "/" in v else "vLLM(판 모름)"
    if v.startswith("ollama/"):
        return "Ollama " + v[7:]
    if v.startswith("v/"):
        return "/version 이 있는 서버 " + v[2:]
    return _common(v) or v


def _ctx_meaning(v):
    m = re.fullmatch(r"(\d+)([mteo]?)", v)
    if not m:
        return _common(v) or v
    src = {"m": "/v1/models 의 max_model_len", "t": "/tokenize", "e": "길이 초과 400 메시지",
           "o": "Ollama /api/show", "": "출처 모름"}[m.group(2)]
    return "%s (%s)" % (m.group(1), src)


def _pair_meaning(v, first, second, yes="됨", no="안 됨"):
    if len(v) == 2 and set(v) <= {"y", "n"}:
        return "%s %s, %s %s" % (first, yes if v[0] == "y" else no, second, yes if v[1] == "y" else no)
    return _common(v) or v


def _browser_meaning(v):
    names = {"c": "Chrome", "e": "Edge", "h": "HeadlessChrome"}
    if v[:1] in names and v[1:].isdigit():
        return "%s %s" % (names[v[0]], v[1:])
    return "그 밖의 브라우저" if v == "x" else v


def _ls_meaning(v):
    m = re.fullmatch(r"(\d+)/(\d+)", v)
    if m:
        return "영문 약 %sK 글자, 한글 약 %sK 글자" % (m.group(1), m.group(2))
    return "localStorage 를 쓸 수 없음" if v == "!u" else (_common(v) or v)


def _idb_meaning(v):
    m = re.fullmatch(r"(\d+)/(\d+|\?)", v)
    if m:
        return "%s MB 써짐, 할당량 %s MB" % (m.group(1), m.group(2))
    return "IndexedDB 를 쓸 수 없음" if v == "!u" else (_common(v) or v)


def _mwl_meaning(v):
    if v == "n":
        return "없음"
    m = re.fullmatch(r"y(\d+)", v)
    return "있음(약 %s KB) - 내용은 읽지 않았다" % m.group(1) if m else (_common(v) or v)


YN = {"y": "됨", "n": "안 됨"}
SPECS = {
    "e": [("v", "코드 판", None), ("p", "Python", None), ("o", "OS", _os_meaning),
          ("q", "프록시 설정", {"n": "없음", "e": "환경 변수", "r": "Windows 레지스트리", "b": "환경 변수와 레지스트리"}),
          ("a", "PAC(자동 구성 스크립트)", {"y": "있음 - Python 은 PAC 를 읽지 못한다(크롬과 경로가 다를 수 있다)", "n": "없음"}),
          ("s", "점검한 서버 수", None)],
    "s": [("k", "서버 종류", _kind_meaning),
          ("h", "Server 헤더", {"-": "없음", "?": "제품 이름 모양이 아니라 뺐다(호스트, 주소 등)"}), ("n", "목록의 모델 수", None),
          ("m", "시험한 모델 수", None),
          ("a", "키 필요", {"y": "필요(키 없이 401, 403)", "n": "필요 없음(키 없이 200)"}),
          ("x", "CORS(file:// 에서 직접, 추정)", {"y": "됨", "p": "출처는 되나 Authorization 헤더가 허용 목록에 없음",
                                              "n": "안 됨"}),
          ("q", "경로", {"d": "프록시 없이", "p": "프록시를 거쳐", "f": "프록시로 안 돼 직접 연결해서 됨",
                       "k": "http 주소에 프록시가 걸려, 키를 보내기 전에 직접 연결로 바꿈"}),
          ("l", "전송", {"h": "http(암호화 없음)", "s": "https(인증서 검증됨)", "i": "https(검증 없이, --insecure)"}),
          ("d", "리다이렉트", {"n": "없음", "s": "같은 호스트", "o": "다른 호스트(키를 보내지 않았다)",
                          "t": "https 로(주소를 https 로 바꿔 다시)"}),
          ("e", "서버 단계 오류", {})],
    "m": [("c", "문맥 길이", _ctx_meaning), ("w", "Ollama 실제 창(num_ctx)", None), ("t", "글자/토큰(한국어)", None),
          ("p", "입력 처리 속도(토큰/초, 대략)", None), ("d", "생성 속도(토큰/초)", None),
          ("k", "조용한 잘림(약 6k 토큰)", {"n": "없음(앞, 끝 표지 모두)", "y": "있음 - 앞부분이 잘림",
                                     "e": "끝 표지가 없음(끝 잘림 또는 답 실패)", "b": "두 표지 모두 없음"}),
          ("r", "추론 강도 low/high", _reasoning_meaning),
          ("f", "추론이 오는 칸", {"c": "reasoning_content", "r": "reasoning", "n": "없음"}),
          ("h", "본문에 생각 누출", {"n": "없음", "t": "<think> 태그", "g": "harmony 표지", "b": "둘 다"}),
          ("z", "생각 끄기(enable_thinking=false)", {"y": "꺼짐", "n": "안 꺼짐", "-": "원래 추론이 없음"}),
          ("j", "JSON 스키마 응답", {"y": "됨", "f": "코드 울타리(```)로 감싸 옴", "s": "JSON 이지만 스키마와 다름",
                                 "x": "JSON 아님"}),
          ("o", "Responses API", {"y": "됨", "x": "200 이지만 모양이 다름"})],
    "b": [("v", "코드 판", None), ("c", "브라우저", _browser_meaning),
          ("g", "연 방식", {"f": "file://", "h": "http://127.0.0.1", "o": "그 밖"}),
          ("l", "localStorage 용량", _ls_meaning), ("o", "시험 전 localStorage 사용량(K 글자)", None),
          ("i", "IndexedDB", _idb_meaning), ("e", "isSecureContext", YN), ("u", "crypto.randomUUID", YN),
          ("p", "storage.persisted(지워지지 않게 보호)", YN),
          ("s", "file:// 사본끼리 저장소 공유", {"y": "함께 씀", "n": "따로 씀", "?": "한 경로만 봄"}),
          ("m", "mwl.progress", _mwl_meaning), ("f", "자기 파일 fetch", {"y": "됨", "n": "막힘"}),
          ("w", "파일 저장 창(showSaveFilePicker)", {"y": "있음", "n": "없음"}),
          ("k", "클립보드 쓰기", {"y": "됨", "e": "execCommand 로만 됨", "n": "안 됨"}),
          ("d", "파일 내려받기", {"y": "받아짐", "n": "안 받아짐"}),
          ("r", "다시 연 뒤 남음", lambda v: _pair_meaning(v, "localStorage", "IndexedDB", "남음", "없음")),
          ("t", "서버 모드", lambda v: _pair_meaning(v, "쿠키", "큰 POST")),
          ("a", "AI 서버에 브라우저가 직접(CORS)", {"c": "사전 요청까지 됨", "p": "단순 요청만(Authorization 막힘)",
                                           "b": "닿지만 CORS 막힘", "n": "닿지 않음"}),
          ("z", "스크립트 오류 수", None)],
}


def _spec_key(tag):
    if tag in ("e", "b"):
        return tag
    return "m" if "m" in tag else "s"


def explain(parsed) -> list:
    tag = parsed["tag"]
    kind = _spec_key(tag)
    head = {"e": "[환경]", "b": "[브라우저]"}.get(kind) or "[%s]" % tag.upper()
    if parsed.get("name"):
        head += " " + parsed["name"]
    out = [head]
    if parsed["ok"]:
        out.append("  검사합 맞음")
    else:
        out.append("  !! 검사합이 맞지 않습니다(적은 것 %s, 계산 %s) - 옮겨 적은 줄을 다시 확인하세요"
                   % (parsed["got"], parsed["expected"]))
    fields = dict(parsed["fields"])
    for key, label, how in SPECS[kind]:
        if key not in fields:
            continue
        v = fields.pop(key)
        if callable(how):
            meaning = how(v)
        elif isinstance(how, dict):
            meaning = _pick(v, how)
        else:
            meaning = _common(v) or v
        out.append("  %s: %s" % (label, meaning))
    for k, v in fields.items():
        out.append("  (모르는 칸) %s=%s" % (k, v))
    return out


def render_summary(lines) -> str:
    out = ["", "=== 결과 풀이 ==="]
    good = []
    for line in lines:
        try:
            parsed = parse_line(line)
        except ValueError as e:
            out.append("읽지 못한 줄: %s (%s)" % (line, e))
            continue
        out += explain(parsed)
        good.append(line)
    out += ["", "=== 결과 코드 - 이 줄들을 그대로 옮겨 적어 전해 주세요 ==="]
    out += good or ["(없음)"]
    return "\n".join(out)


def safe_text(text, encoding="cp949") -> str:
    return str(text).encode(encoding, errors="replace").decode(encoding)


# ================================================================ A 등급: 판정
def normalize_base(text):
    """입력 주소 -> (root, v1). '/v1', '/v1/chat/completions' 같은 꼬리를 정리한다."""
    s = (text or "").strip()
    if not s:
        raise ValueError("주소가 비었습니다")
    if "://" not in s:
        s = "http://" + s
    if any(ch.isspace() for ch in s):
        raise ValueError("주소에 빈칸이 있습니다")
    # 오류 글에 입력한 주소를 되풀이하지 않는다 - urllib 의 ValueError 는 주소를 그대로 싣는다(독립 점검 F-06)
    try:
        u = urllib.parse.urlsplit(s)
        host = u.hostname
    except ValueError:
        raise ValueError("주소 모양이 올바르지 않습니다(대괄호, 쓸 수 없는 글자)") from None
    scheme = u.scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError("주소는 http:// 또는 https:// 로 시작해야 합니다")
    try:
        u.port
    except ValueError:
        raise ValueError("포트가 올바르지 않습니다(0~65535 의 숫자)") from None
    if "@" in u.netloc:   # 사용자:비밀번호@ 는 프록시로 가는 요청 줄과 Host 에 실린다(독립 점검 F-05)
        raise ValueError("주소에 사용자 이름이나 비밀번호(@ 앞)를 넣지 않습니다 - 키는 따로 묻습니다")
    if not u.netloc or not host:
        raise ValueError("호스트가 없습니다")
    if not host.isascii():
        raise ValueError("호스트 이름은 영문, 숫자, 점, 하이픈으로 적습니다")
    if any(len(part) > 63 for part in host.split(".")):
        raise ValueError("호스트 이름의 한 칸(점 사이)이 63자를 넘습니다")
    path = u.path.rstrip("/")
    for suffix in ("/chat/completions", "/completions", "/responses", "/models"):
        if path.lower().endswith(suffix):
            path = path[:-len(suffix)]
            break
    path = path.rstrip("/")
    if path.lower().endswith("/v1"):
        path = path[:-3]
    root = scheme + "://" + u.netloc + path
    return root, root + "/v1"


def secrets_of(url, key=""):
    """가릴 값 - 호스트, 호스트:포트, :포트, 키(4글자 이상). 긴 것부터."""
    out = set()
    try:
        u = urllib.parse.urlsplit(url if "://" in url else "http://" + url)
        if u.hostname:
            out.add(u.hostname)
        if u.netloc:
            out.add(u.netloc.rsplit("@", 1)[-1])
        if u.port:
            out.add(":%d" % u.port)
    except ValueError:
        pass
    if key and len(key) >= 4:
        out.add(key)
    return sorted(out, key=len, reverse=True)


_IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
_IPV6 = re.compile(r"(?i)(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}")
_HOSTLIKE = re.compile(r"(?i)[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z]"
                       r"|[a-z0-9]\.(?:local|localdomain|localhost|internal|intranet|intra|corp|lan|home|private)(?![a-z0-9])")


def redact(text, secret_values) -> str:
    s = str(text)
    for sec in secret_values:
        if sec:
            s = re.sub(re.escape(sec), "<가림>", s, flags=re.IGNORECASE)
    return _IPV4.sub("<IP>", s)


def _skeleton(text) -> str:
    return re.sub(r"[^0-9a-z]", "", str(text).lower())


def leaks(text, secret_values) -> bool:
    """글에 주소(IPv4, IPv6, 호스트 이름 꼴)나 비밀값이 보이는가. 잘리거나 글자가 바뀐 것도 본다 -
    비밀값의 영문·숫자가 SECRET_WINDOW 글자 이어져 보이면 참(독립 점검 F-03)."""
    s = str(text)
    if _IPV4.search(s) or _IPV6.search(s) or _HOSTLIKE.search(s):
        return True
    low, sk = s.lower(), _skeleton(s)
    for sec in secret_values or ():
        if not sec:
            continue
        if sec.lower() in low:
            return True
        ss = _skeleton(sec)
        if len(ss) < 4:            # ':80' 같은 짧은 조각은 판 숫자와 겹친다
            continue
        w = min(len(ss), SECRET_WINDOW)
        if any(ss[i:i + w] in sk for i in range(len(ss) - w + 1)):
            return True
    return False


def scrub(value, secret_values):
    """결과 코드와 화면에 쓰는 자유 글(서버 헤더, 판, 모델 이름)이 주소·키처럼 보이면 '?' 로 바꾼다."""
    if value is None:
        return None
    return "?" if leaks(value, secret_values) else value


def model_label(model_id, secret_values=()) -> str:
    """모델 이름 - 마지막 경로 조각. 조각이 주소·키처럼 보이면 '?'(줄이기 전 글자로도 본다)."""
    raw = str(model_id or "").strip().rstrip("/").rsplit("/", 1)[-1]
    if leaks(raw, secret_values):
        return "?"
    return scrub(model_short(raw), secret_values)


def clean_key(text):
    """입력한 키 -> 보낼 키. 앞뒤 빈칸과 앞의 'Bearer ' 를 뗀다. 비면 '', 헤더에 실을 수 없는 글자
    (한글, 빈칸, 줄바꿈 등)가 있으면 None."""
    s = str(text or "").strip()
    if s[:7].lower() == "bearer ":
        s = s[7:].strip()
    if not s:
        return ""
    return s if re.fullmatch(r"[\x21-\x7e]{1,4096}", s) else None


def auth_challenge(status, headers, body) -> str:
    """401·403 이 API 의 JSON 답인가('json'), 프록시·게이트웨이 화면 같은 그 밖의 것인가('page'). 다른 상태는 ''.
    키는 'json' 일 때만 보낸다 - HTML, 글, 빈 본문, BOM 붙은 화면은 API 답이 아니라고 본다(독립 점검 F-01)."""
    if status not in (401, 403):
        return ""
    ctype = str((headers or {}).get("content-type", "")).lower()
    if "html" in ctype or "xml" in ctype:
        return "page"
    try:
        data = json.loads(bytes(body or b"").decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        return "page"
    return "json" if isinstance(data, dict) else "page"


def classify_redirect(src, location) -> str:
    try:
        old = urllib.parse.urlsplit(src)
        new = urllib.parse.urlsplit(urllib.parse.urljoin(src, location or ""))
        new_host = new.hostname or ""
    except ValueError:   # 읽을 수 없는 Location(닫히지 않은 IPv6 대괄호 등)은 다른 곳으로 본다(독립 점검 O-1)
        return "o"
    if new_host != (old.hostname or ""):
        return "o"
    if old.scheme == "http" and new.scheme == "https":
        return "t"

    def port(u):
        try:
            p = u.port
        except ValueError:
            p = None
        return p or (443 if u.scheme == "https" else 80)

    if port(new) != port(old) or new.scheme != old.scheme:
        return "o"
    return "s"


def proxy_kind(env_proxies, reg) -> str:
    env = bool(env_proxies and (env_proxies.get("http") or env_proxies.get("https") or env_proxies.get("all")))
    win = bool(reg and reg.get("enabled") and reg.get("server"))
    return "b" if env and win else "e" if env else "r" if win else "n"


def pac_flag(reg) -> str:
    return "y" if reg and reg.get("pac") else "n"


def proxy_applies(url, proxies, bypass) -> bool:
    """urllib 가 이 주소에 프록시를 쓰는가. urllib 는 ALL_PROXY('all')를 쓰지 않는다(독립 점검 F-02)."""
    u = urllib.parse.urlsplit(url)
    proxy = (proxies or {}).get(u.scheme)
    if not proxy:
        return False
    return not bypass(u.netloc)


def _posint(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 < v < MAX_COUNT else None


def ctx_from_model_entry(d):
    if not isinstance(d, dict):
        return None
    for k in ("max_model_len", "context_length", "max_context_length", "context_window"):
        v = _posint(d.get(k))
        if v:
            return v
    meta = d.get("meta")
    return _posint(meta.get("n_ctx_train")) if isinstance(meta, dict) else None


def ctx_from_tokenize(d):
    if not isinstance(d, dict):
        return (None, None)
    count = _posint(d.get("count"))
    if count is None and isinstance(d.get("tokens"), list):
        count = len(d["tokens"])
    return (count, _posint(d.get("max_model_len")))


_NUM = r"(\d{1,10})(?!\d)"    # 숫자는 10자리까지만 읽는다(아주 긴 숫자에서 int() 가 멈추지 않게)
_CTX_PATTERNS = [
    re.compile(r"maximum context length is " + _NUM, re.I),
    re.compile(r"max(?:imum)?[_ ]model[_ ]len(?:gth)?\D{0,20}?" + _NUM, re.I),
    re.compile(r"must be <= " + _NUM, re.I),
    re.compile(r"context (?:length|window|size) (?:of|is) " + _NUM, re.I),
]


def ctx_from_error(text):
    for pat in _CTX_PATTERNS:
        m = pat.search(text or "")
        if m and int(m.group(1)) >= 256:
            return int(m.group(1))
    return None


def ctx_from_ollama_show(d):
    if not isinstance(d, dict):
        return (None, None)
    ctx = None
    info = d.get("model_info")
    if isinstance(info, dict):
        for k, v in info.items():
            if str(k).endswith(".context_length") and _posint(v):
                ctx = v
                break
    win = None
    params = d.get("parameters")
    if isinstance(params, str):
        m = re.search(r"(?m)^\s*num_ctx\s+" + _NUM, params)
        if m:
            win = _posint(int(m.group(1)))
    return (ctx, win)


_VERSION = re.compile(r"v?(\d{1,4}(?:\.\d{1,4}){1,2}(?:\.?(?:dev|rc|post|a|b)\d{0,6})?)")
_SERVER_TOKEN = re.compile(r"[a-z][a-z_-]{1,23}(?:/[0-9][0-9a-z.+_-]{0,15})?")


def _ver(d):
    """판 글 -> 숫자 모양의 앞부분('0.10.2rc2')만. 그 밖의 글은 싣지 않는다(독립 점검 F-03)."""
    if not (isinstance(d, dict) and isinstance(d.get("version"), str)):
        return None
    raw = d["version"].strip().lower()
    if _IPV4.search(raw):
        return None
    m = _VERSION.match(raw)
    return m.group(1) if m else None


def _server_token(header) -> str:
    """Server 헤더의 첫 낱말이 '제품/판' 모양(nginx/1.24.0, uvicorn)일 때만 싣는다. 숫자·점이 든 이름
    (호스트 이름, IP)이나 이상한 글자는 '?'."""
    if header is None or not str(header).strip():
        return "-"
    first = str(header).split()[0].lower()
    if _IPV4.search(first) or not _SERVER_TOKEN.fullmatch(first):
        return "?"
    return first


def server_kind(models, version, api_version, server_header):
    owned = set()
    if isinstance(models, dict) and isinstance(models.get("data"), list):
        owned = {str(m.get("owned_by", "")).lower() for m in models["data"] if isinstance(m, dict)}
    v, av = _ver(version), _ver(api_version)
    if "vllm" in owned:
        kind = "vllm/" + v if v else "vllm"
    elif av:
        kind = "ollama/" + av
    elif v:
        kind = "v/" + v
    else:
        kind = "-"
    return kind, _server_token(server_header)


def _acao_ok(h) -> bool:
    return isinstance(h, dict) and str(h.get("access-control-allow-origin", "")).strip().lower() in ("*", "null")


def _tokens(v):
    return {t.strip().lower() for t in str(v or "").split(",") if t.strip()}


def cors_verdict(pre, pre_status, actual) -> str:
    """사전 요청과 실제 응답의 헤더로 file://(Origin: null) 에서 Authorization 을 단 POST 가 될지 추정한다."""
    if pre is None and actual is None:
        return "?"
    if isinstance(pre, dict) and 200 <= (pre_status or 0) < 300 and _acao_ok(pre):
        hdrs = _tokens(pre.get("access-control-allow-headers"))
        methods = _tokens(pre.get("access-control-allow-methods"))
        auth = "authorization" in hdrs                        # '*' 는 Authorization 을 덮지 못한다(Fetch 표준)
        ctype = "content-type" in hdrs or "*" in hdrs
        post = not methods or "post" in methods or "*" in methods
        return "y" if auth and ctype and post else "p"
    if _acao_ok(actual) or _acao_ok(pre):
        return "p"
    return "n"


_TOPICS = ["점검", "백업", "배포", "설정", "로그", "장애 대응", "권한", "모니터링", "용량 관리", "보안"]
_SENTS = [
    "{t} 작업은 담당자가 정해진 순서대로 진행하고 단계마다 결과를 기록부에 남긴다.",
    "{t} 전에는 대상 시스템의 상태를 확인하고 이상이 보이면 바로 멈춘 뒤 책임자에게 알린다.",
    "{t} 결과는 다음 근무자에게 넘기며 끝내지 못한 항목은 따로 표시해 둔다.",
    "{t} 기준 값은 월말마다 다시 검토하고 바뀐 값은 변경 기록에 날짜와 함께 적는다.",
    "{t} 도중에 오류가 나면 화면의 메시지를 그대로 옮겨 적고 같은 일을 두 번 되풀이하지 않는다.",
    "{t} 대상 목록은 운영 대장과 맞춰 보고 빠진 장비가 있으면 먼저 대장을 고친다.",
]


def _chapter_lines(ch, topic):
    yield "제%d장 %s" % (ch, topic)
    for sec in range(1, 4):
        yield "%d.%d %s %d단계" % (ch, sec, topic, sec)
        for i, item in enumerate("가나다"):
            yield "%s. %s" % (item, _SENTS[(ch + sec + i) % len(_SENTS)].format(t=topic))


def make_long_prompt(n_chars=LONG_CHARS):
    """결정적인 한국어 가상 매뉴얼(앞, 끝 표지) + 표지를 되묻는 질문 -> (prompt, start, end)."""
    head = "시작 표지: %s\n가상 운영 매뉴얼(점검 도구가 만든 시험용 글이며 실제 내용이 아니다)\n\n" % START_MARK
    tail = "\n끝 표지: %s\n" % END_MARK
    q = ("\n질문: 위 글 맨 앞의 '시작 표지'와 맨 끝의 '끝 표지'에 적힌 두 낱말을 "
         "'시작=..., 끝=...' 꼴로 한 줄로만 답하라.")
    lines, size, ch = [], len(head) + len(tail) + len(q) + 1, 0
    while size < n_chars:
        ch += 1
        for line in _chapter_lines(ch, _TOPICS[(ch - 1) % len(_TOPICS)]):
            lines.append(line)
            size += len(line) + 1
            if size >= n_chars:
                break
    return head + "\n".join(lines) + "\n" + tail + q, START_MARK, END_MARK


def _text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return "".join(x if isinstance(x, str) else str(x.get("text", "")) for x in v if isinstance(x, (str, dict)))
    return ""


def chat_parts(data):
    """Chat Completions 답 -> (본문, 추론 글, finish_reason, 추론 칸 c/r/n). 모양이 다르면 ValueError."""
    choices = data.get("choices") if isinstance(data, dict) else None
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError("choices 가 없습니다")
    c0 = choices[0]
    msg = c0.get("message") if isinstance(c0.get("message"), dict) else {}
    content = _text(msg.get("content"))
    if not content and isinstance(c0.get("text"), str):
        content = c0["text"]
    finish = c0.get("finish_reason")
    rc, rr = msg.get("reasoning_content"), msg.get("reasoning")
    if isinstance(rc, str) and rc:
        return content, rc, finish, "c"
    if isinstance(rr, str) and rr:
        return content, rr, finish, "r"
    return content, "", finish, "n"


def usage_of(data):
    """사용량 {input, output, reasoning}. Chat(prompt_/completion_tokens), Responses(input_/output_tokens) 모두.
    MWL mwl/agent/aiserver.py usage_of 를 옮겼다(기준 커밋 e053470)."""
    u = data.get("usage") if isinstance(data, dict) and isinstance(data.get("usage"), dict) else {}

    def num(v):   # 터무니없이 큰 수(10**400 등)는 버린다 - 나눗셈에서 OverflowError 가 난다(독립 점검 O-1)
        return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < MAX_COUNT else None

    det = u.get("output_tokens_details") if isinstance(u.get("output_tokens_details"), dict) else (
        u.get("completion_tokens_details") if isinstance(u.get("completion_tokens_details"), dict) else None)
    return {"input": num(u["input_tokens"] if "input_tokens" in u else u.get("prompt_tokens")),
            "output": num(u["output_tokens"] if "output_tokens" in u else u.get("completion_tokens")),
            "reasoning": num(det.get("reasoning_tokens")) if det is not None else None}


def status_code(status, text="") -> str:
    if 200 <= status < 300:
        return ""
    if 300 <= status < 400:
        return "!r"
    if status in (401, 403):
        return "!a"
    if status == 404:
        return "!n"
    if status == 413:
        return "!l"
    if status == 400 and (ctx_from_error(text) or re.search(r"context length|too long|max_model_len", text or "", re.I)):
        return "!l"
    if 400 <= status < 500:
        return "!4"
    if 500 <= status < 600:
        return "!5"
    return "!c"


def judge_cut(text, start, end) -> str:
    low = (text or "").lower()
    s, e = start.lower() in low, end.lower() in low
    return "n" if s and e else "y" if e else "e" if s else "b"


def metrics_of(data):
    u = usage_of(data)
    try:
        rtext = chat_parts(data)[1]
    except ValueError:
        rtext = ""
    return {"rt": u["reasoning"], "rc": len(rtext), "ct": u["output"]}


def reasoning_pair(lo, hi):
    if lo.get("rt") is not None and hi.get("rt") is not None:
        return lo["rt"], hi["rt"], "t"
    if lo.get("rc") or hi.get("rc"):
        return lo.get("rc") or 0, hi.get("rc") or 0, "c"
    if lo.get("ct") is not None and hi.get("ct") is not None:
        return lo["ct"], hi["ct"], "o"
    return None, None, "-"


def judge_reasoning(lo, hi, src) -> str:
    if src == "-" or lo is None or hi is None:
        return "?"
    min_diff = 200 if src == "c" else 50
    return "y" if hi >= lo * 1.5 and hi - lo >= min_diff else "n"


def reasoning_text(lo, hi, src) -> str:
    return "-" if src == "-" else "%d/%d%s" % (lo, hi, src)


def judge_leak(content) -> str:
    low = (content or "").lower()
    think = "<think>" in low or "</think>" in low
    harmony = "<|" in low or "assistantfinal" in re.sub(r"\s+", "", low)
    return "b" if think and harmony else "t" if think else "g" if harmony else "n"


def combine_leak(values) -> str:
    vs = set(values)
    t = "t" in vs or "b" in vs
    g = "g" in vs or "b" in vs
    return "b" if t and g else "t" if t else "g" if g else "n"


def combine_field(values) -> str:
    return "c" if "c" in values else "r" if "r" in values else "n"


def judge_think_off(baseline_had, off) -> str:
    if not baseline_had:
        return "-"
    return "n" if (off.get("rt") or 0) > 0 or (off.get("rc") or 0) > 0 else "y"


def _schema_ok(v) -> bool:
    a = v.get("answer") if isinstance(v, dict) else None
    return isinstance(a, int) and not isinstance(a, bool) and isinstance(v.get("unit"), str)


def judge_json(content) -> str:
    s = (content or "").strip()
    fenced = s.startswith("```")
    if fenced:
        s = s.split("\n", 1)[1] if "\n" in s else ""
        s = s.strip()
        if s.endswith("```"):
            s = s[:-3].strip()
    try:
        v = json.loads(s)
    except ValueError:
        return "x"
    if not _schema_ok(v):
        return "s"
    return "f" if fenced else "y"


def judge_responses(data) -> str:
    if not isinstance(data, dict) or not isinstance(data.get("output"), list):
        return "x"
    for item in data["output"]:
        if isinstance(item, dict) and item.get("type") == "message" and isinstance(item.get("content"), list):
            for p in item["content"]:
                if isinstance(p, dict) and p.get("type") == "output_text" and str(p.get("text") or "").strip():
                    return "y"
    return "x"


def chat_body(model, content, max_tokens, **extra):
    body = {"model": model, "messages": [{"role": "user", "content": content}], "max_tokens": max_tokens,
            "stream": False}
    for k, v in extra.items():
        if v is not None:
            body[k] = v
    return body


# ================================================================ B 등급: HTTP 호출
class Resp:
    def __init__(self, status=0, headers=None, body=b"", data=None, seconds=0.0, error="", redirect=""):
        self.status, self.headers, self.body, self.data = status, headers or {}, body, data
        self.seconds, self.error, self.redirect = seconds, error, redirect

    @property
    def ok(self) -> bool:
        return not self.error and 200 <= self.status < 300

    def text(self) -> str:
        return self.body.decode("utf-8", "replace")


class Budget:
    def __init__(self, max_calls):
        self.max_calls, self.used = max_calls, 0

    def take(self) -> bool:
        if self.used >= self.max_calls:
            return False
        self.used += 1
        return True


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """리다이렉트를 따르지 않는다 - Python urllib 는 따를 때 Authorization 을 다른 호스트로 넘긴다(BRIEF 5.8).
    redirect_request 만 막으면 그 앞에서 Location 을 읽다가 ValueError 가 난다(닫히지 않은 IPv6 대괄호) - 3xx 처리 자체를
    하지 않고 HTTPError 로 돌려받는다(독립 점검 O-1, 트러블슈팅 T-003)."""

    def http_error_302(self, req, fp, code, msg, headers):
        return None

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def make_ssl_context(cafile=None, insecure=False):
    ctx = ssl.create_default_context(cafile=cafile)
    if insecure:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _reason_code(reason) -> str:
    if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason).lower():
        return "!t"
    if isinstance(reason, ssl.SSLError) or "certificate" in str(reason).lower():
        return "!x"
    return "!c"


def _read_limited(f) -> bytes:
    return f.read(MAX_BODY + 1)[:MAX_BODY]


class Client:
    """서버 하나에 대한 호출. 예외를 밖으로 내지 않고 Resp.error(!...)로 돌려준다.
    키는 key_on 일 때만 싣는다 - probe_server 가 'JSON 401·403 을 받았고 평문 프록시를 지나지 않는다'를 확인한 뒤
    켠다(독립 점검 F-01·F-02·F-04)."""

    def __init__(self, root, v1, key="", timeout=DEFAULT_TIMEOUT, ssl_ctx=None, budget=None, direct=False):
        self.root, self.v1, self.key, self.timeout = root, v1, key, timeout
        self.ssl_ctx = ssl_ctx or make_ssl_context()
        self.budget = budget or Budget(DEFAULT_MAX_CALLS)
        self.direct = direct
        self.key_on = False
        self.secrets = secrets_of(root, key)

    def _opener(self):
        handlers = [_NoRedirect(), urllib.request.HTTPSHandler(context=self.ssl_ctx)]
        if self.direct:
            handlers.append(urllib.request.ProxyHandler({}))
        return urllib.request.build_opener(*handlers)

    def call(self, method, url, body=None, use_key=True, headers=None, want_json=True, timeout=None) -> Resp:
        if not self.budget.take():
            return Resp(error="!q")
        hdrs = {"Accept": "application/json", "User-Agent": "mylearner-ai-probe/%d" % CODE_VERSION}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        hdrs.update(headers or {})
        if use_key and self.key and self.key_on:
            hdrs["Authorization"] = "Bearer " + self.key
        r = Resp()
        t0 = time.monotonic()
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
            with self._opener().open(req, timeout=timeout or self.timeout) as f:
                r.status = f.getcode()
                r.headers = {k.lower(): v for k, v in f.headers.items()}
                r.body = _read_limited(f)
        except urllib.error.HTTPError as e:
            r.status = e.code
            r.headers = {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}
            try:
                r.body = _read_limited(e)
            except (OSError, http.client.HTTPException):
                r.body = b""
            finally:
                e.close()
            r.error = status_code(e.code, r.text())
            if 300 <= e.code < 400:
                r.redirect = classify_redirect(url, r.headers.get("location", ""))
        except urllib.error.URLError as e:
            r.error = _reason_code(e.reason)
        except (socket.timeout, TimeoutError):
            r.error = "!t"
        except ssl.SSLError:
            r.error = "!x"
        except (http.client.HTTPException, OSError, ValueError):   # ValueError 에는 UnicodeError(IDNA)도 든다
            r.error = "!c"
        r.seconds = time.monotonic() - t0
        if r.status and 200 <= r.status < 300 and want_json and not r.error:
            ctype = r.headers.get("content-type", "").lower()
            if "html" in ctype or r.body.lstrip()[:1] == b"<":
                r.error = "!h"
            else:
                try:
                    r.data = json.loads(r.body.decode("utf-8"))
                except (UnicodeDecodeError, ValueError, RecursionError):
                    r.error = "!j"
        return r


# ================================================================ B 등급: 입출력과 환경
class IO:
    """시험이 바꿔 끼우는 입출력. 화면 글은 모두 safe_text(cp949)를 지나고, 서버 주소와 키를 받은 뒤에는
    redact 도 지난다(마지막 그물 - 설계서 5절)."""

    def __init__(self, ask=None, secret=None, out=None, interactive=None):
        self._ask = ask or input
        self._secret = secret or getpass.getpass
        self._out = out or print
        self.interactive = sys.stdin.isatty() if interactive is None else interactive
        self.secrets = []

    def add_secrets(self, values):
        self.secrets = sorted(set(self.secrets) | {v for v in values if v}, key=len, reverse=True)

    def ask(self, prompt):
        return self._ask(safe_text(prompt))

    def secret(self, prompt):
        """키 입력. 글자를 가릴 수 없는 창(IDLE 등)이면 getpass 가 경고와 함께 화면에 보이게 받는다 - 그 경우
        키를 받지 않고 '' 를 돌려준다."""
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            try:
                return self._secret(safe_text(prompt))
            except getpass.GetPassWarning:
                self.say("이 창에서는 키를 가릴 수 없습니다(IDLE 등). 명령 프롬프트(cmd)에서 다시 실행하세요. "
                         "이 서버는 키 없이 잽니다.")
                return ""

    def say(self, text=""):
        self._out(safe_text(redact(text, self.secrets) if self.secrets else text))

    def pause(self):
        if self.interactive:
            try:
                self._ask("엔터를 누르면 창을 닫습니다.")
            except (EOFError, KeyboardInterrupt):
                pass


def read_registry_proxy():
    """Windows 사용자 프록시 설정. 값은 화면에 찍지 않는다(종류만 쓴다)."""
    try:
        import winreg
    except ImportError:
        return None
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
    except OSError:
        return None

    def val(name):
        try:
            return winreg.QueryValueEx(key, name)[0]
        except OSError:
            return None

    try:
        return {"enabled": bool(val("ProxyEnable")), "server": str(val("ProxyServer") or ""),
                "override": str(val("ProxyOverride") or ""), "pac": str(val("AutoConfigURL") or "")}
    finally:
        winreg.CloseKey(key)


def os_tag() -> str:
    if sys.platform.startswith("win"):
        return "w" + platform.version()
    if sys.platform.startswith("linux"):
        return "l" + ".".join(platform.release().split(".")[:2])
    if sys.platform == "darwin":
        return "m" + platform.mac_ver()[0]
    return "x"


def probe_env(env_proxies=None, reg=None):
    if env_proxies is None:
        env_proxies = urllib.request.getproxies_environment()
    return {"py": platform.python_version(), "os": os_tag(), "proxy": proxy_kind(env_proxies, reg),
            "pac": pac_flag(reg)}


# ================================================================ B 등급: 점검 흐름
def _done(io, label, what, r, note=""):
    state = "됨" if r.ok else ERR.get(r.error, r.error or "HTTP %d" % r.status)
    io.say("  [%s] %s: %s (%.1f초)%s" % (label, what, state, r.seconds, (" " + note) if note else ""))


def new_server_result():
    return {"kind": "-", "server": "-", "n": 0, "m": 0, "auth": "?", "cors": "?", "route": "d", "tls": "h",
            "redir": "n", "error": None}


def probe_server(client, io, label, insecure=False, s=None):
    """서버 점검 -> (서버 결과 dict, 모델 목록). 설계서 3.3절 순서. s 를 주면 거기에 차례로 채운다(도중에 멈춰도 남는다).
    키는 키 없이 부른 목록이 JSON 401·403 일 때만, http 주소면 프록시를 지나지 않을 때만 보낸다."""
    s = new_server_result() if s is None else s
    plain = urllib.parse.urlsplit(client.v1).scheme == "http"
    if not plain:
        s["tls"] = "i" if insecure else "s"
    proxied = proxy_applies(client.v1, urllib.request.getproxies(), urllib.request.proxy_bypass)
    s["route"] = "p" if proxied else "d"
    if proxied and plain:
        io.say("  [%s] 이 http 주소는 프록시를 거칩니다 - 키는 프록시로 보내지 않습니다" % label)
    models_url = client.v1 + "/models"
    r1 = client.call("GET", models_url, use_key=False, headers={"Origin": "null"})
    _done(io, label, "모델 목록(키 없이)", r1)
    if r1.error == "!c" and proxied:
        io.say("  [%s] 프록시로 연결되지 않아 프록시 없이 다시 해 봅니다" % label)
        client.direct = True
        r1 = client.call("GET", models_url, use_key=False, headers={"Origin": "null"})
        _done(io, label, "모델 목록(프록시 없이)", r1)
        if r1.error == "!c":
            client.direct = False
        else:
            s["route"] = "f"
    if r1.redirect:
        s["redir"] = r1.redirect
    if r1.error == "!x":
        s["tls"] = "!x"
    listing = r1
    challenge = auth_challenge(r1.status, r1.headers, r1.body)
    if challenge == "page":
        # 프록시·게이트웨이의 차단 화면(HTML, 글, 빈 본문)이다 - API 는 JSON 으로 답한다. 키를 실어 다시 보내지 않는다
        s["error"] = "!h"
        return s, []
    if challenge == "json":
        s["auth"] = "y"
        if client.key and plain and proxied and not client.direct:
            # 평문 http 의 키는 프록시가 읽는다 - 키를 보내기 전에 프록시 없이 닿는지 본다(독립 점검 F-02)
            client.direct = True
            rd = client.call("GET", models_url, use_key=False, headers={"Origin": "null"})
            _done(io, label, "모델 목록(키 없이, 프록시 없이)", rd)
            if not rd.ok and auth_challenge(rd.status, rd.headers, rd.body) != "json":
                client.direct = False
                s["error"] = "!p"
                io.say("  [%s] 프록시 없이는 닿지 않아 키를 보내지 않았습니다 - 이 서버는 여기까지 잽니다" % label)
                return s, []
            s["route"] = "k"
            listing = rd
        if client.key and not listing.ok:
            client.key_on = True
            listing = client.call("GET", models_url, headers={"Origin": "null"})
            _done(io, label, "모델 목록(키로)", listing)
            if listing.redirect:
                s["redir"] = listing.redirect
    elif r1.ok:
        s["auth"] = "n"
    data = listing.data
    if not listing.ok or not isinstance(data, dict) or not isinstance(data.get("data"), list):
        s["error"] = listing.error or "!j"
        return s, []
    entries = [m for m in data["data"] if isinstance(m, dict) and isinstance(m.get("id"), str) and m["id"]]
    s["n"] = len(entries)
    rv = client.call("GET", client.root + "/version")
    version = rv.data if rv.ok else None
    api_version = None
    if not _ver(version):
        ra = client.call("GET", client.root + "/api/version")
        api_version = ra.data if ra.ok else None
    pre = client.call("OPTIONS", client.v1 + "/chat/completions", use_key=False, want_json=False,
                      headers={"Origin": "null", "Access-Control-Request-Method": "POST",
                               "Access-Control-Request-Headers": "authorization, content-type"})
    s["cors"] = cors_verdict(pre.headers if pre.status else None, pre.status, r1.headers if r1.status else None)
    kind, server = server_kind(data, version, api_version, r1.headers.get("server") or listing.headers.get("server"))
    s["kind"], s["server"] = scrub(kind, client.secrets), scrub(server, client.secrets)   # 화면에도 가린 값
    io.say("  [%s] 서버 종류 %s, 모델 %d개, CORS 추정 %s" % (label, s["kind"], s["n"], s["cors"]))
    return s, entries


def new_model_result(model_id):
    return {"name": model_id, "ctx": None, "ctx_src": None, "win": None, "cpt": "!s", "prefill": None,
            "decode": None, "cut": "!s", "r": "!s", "rfield": "n", "leak": "n", "think_off": "!s", "json": "!s",
            "resp": "!s"}


def _chat_ok(r, fields, leaks):
    """성공한 채팅 답에서 추론 칸과 누출을 모은다. 모양이 다르면 None."""
    try:
        content, rtext, _, rf = chat_parts(r.data)
    except ValueError:
        return None
    fields.append(rf)
    leaks.append(judge_leak(content))
    return content, rtext


def probe_model(client, entry, kind, io, label, m):
    """모델 점검(설계서 3.3절 표). 결과를 m 에 차례로 채운다 - 도중에 멈춰도 채운 데까지 남는다."""
    mid = entry["id"]
    chat_url = client.v1 + "/chat/completions"
    fields, leaks = [], []
    is_ollama = str(kind).startswith("ollama")

    ctx = ctx_from_model_entry(entry)
    if ctx:
        m["ctx"], m["ctx_src"] = ctx, "m"
    if not m["ctx"] and not is_ollama:
        r = client.call("POST", client.root + "/tokenize", {"model": mid, "prompt": "가"})
        _done(io, label, "문맥 길이(/tokenize)", r)
        ml = ctx_from_tokenize(r.data)[1] if r.ok else None
        if ml:
            m["ctx"], m["ctx_src"] = ml, "t"
    if not m["ctx"] and not is_ollama:
        r = client.call("POST", chat_url, chat_body(mid, CTX_Q, HUGE_MAX_TOKENS),
                        timeout=min(60.0, client.timeout))   # 받아들이면 생성이 길어질 수 있다
        v = ctx_from_error(r.text()) if r.status in (400, 413, 422) else None
        _done(io, label, "문맥 길이(400 메시지)", r, "-> %s" % v if v else "")
        if v:
            m["ctx"], m["ctx_src"] = v, "e"
    if not m["ctx"] or is_ollama:
        r = client.call("POST", client.root + "/api/show", {"model": mid})
        _done(io, label, "문맥 길이(/api/show)", r)
        if r.ok:
            c, w = ctx_from_ollama_show(r.data)
            if c and not m["ctx"]:
                m["ctx"], m["ctx_src"] = c, "o"
            m["win"] = w

    prompt, start, end = make_long_prompt(LONG_CHARS)
    io.say("  [%s] 긴 한국어 질문(%d자, 약 6k 토큰) ..." % (label, len(prompt)))
    r = client.call("POST", chat_url, chat_body(mid, prompt, 4096))
    long_secs, long_ct, ptoks = r.seconds, None, None
    got = _chat_ok(r, fields, leaks) if r.ok else None
    if got is None:
        m["cut"] = m["cpt"] = r.error or "!j"
    else:
        u = usage_of(r.data)
        ptoks, long_ct = u["input"], u["output"]
        m["cut"] = judge_cut(got[0] + "\n" + got[1], start, end)
        m["cpt"] = round(len(prompt) / ptoks, 2) if ptoks else "?"
    _done(io, label, "긴 한국어 질문", r, "입력 %s 토큰" % ptoks if ptoks else "")

    lo = client.call("POST", chat_url, chat_body(mid, SMALL_Q, 2048, reasoning_effort="low"))
    _done(io, label, "추론 강도 low", lo)
    hi = client.call("POST", chat_url, chat_body(mid, SMALL_Q, 8192, reasoning_effort="high"))
    _done(io, label, "추론 강도 high", hi)
    mlo = metrics_of(lo.data) if lo.ok and _chat_ok(lo, fields, leaks) is not None else None
    mhi = metrics_of(hi.data) if hi.ok and _chat_ok(hi, fields, leaks) is not None else None
    if mlo and mhi:
        m["r"] = reasoning_text(*reasoning_pair(mlo, mhi))
    else:
        m["r"] = (lo.error if mlo is None else hi.error) or "!j"
    for mm, rr in ((mhi, hi), (mlo, lo)):
        if mm and mm["ct"] and rr.seconds > 0:
            m["decode"] = round(mm["ct"] / rr.seconds)
            break

    off = client.call("POST", chat_url, chat_body(mid, SMALL_Q, 2048, chat_template_kwargs={"enable_thinking": False}))
    _done(io, label, "생각 끄기", off)
    if off.ok and _chat_ok(off, fields, leaks) is not None:
        had = any(x and ((x["rt"] or 0) > 0 or x["rc"] > 0) for x in (mlo, mhi))
        m["think_off"] = judge_think_off(had, metrics_of(off.data))
    else:
        m["think_off"] = off.error or "!j"

    rj = client.call("POST", chat_url, chat_body(mid, JSON_Q, 1024, response_format=JSON_SCHEMA_FORMAT))
    _done(io, label, "JSON 스키마", rj)
    got = _chat_ok(rj, fields, leaks) if rj.ok else None
    m["json"] = judge_json(got[0]) if got is not None else (rj.error or "!j")

    rr = client.call("POST", client.v1 + "/responses",
                     {"model": mid, "input": RESP_Q, "max_output_tokens": 1024, "reasoning": {"effort": "low"}})
    _done(io, label, "Responses API", rr)
    m["resp"] = judge_responses(rr.data) if rr.ok else (rr.error or "!j")

    m["rfield"], m["leak"] = combine_field(fields), combine_leak(leaks)
    if ptoks and long_secs > 0:
        gen = long_ct / m["decode"] if long_ct and m["decode"] else 0.0
        m["prefill"] = round(ptoks / max(long_secs - gen, long_secs * 0.1))
    return m


def choose_models(entries, models_arg, io, interactive, label, secret_values=()):
    if not entries:
        return []
    if models_arg:
        if models_arg.strip().lower() == "all":
            return entries
        want = {w.strip().lower() for w in models_arg.split(",") if w.strip()}
        return [e for e in entries if e["id"].lower() in want or model_short(e["id"]) in want]
    if not interactive:
        return entries
    io.say("  [%s] 모델 %d개:" % (label, len(entries)))
    for i, e in enumerate(entries, 1):
        io.say("    %d) %s" % (i, model_label(e["id"], secret_values)))
    text = io.ask("  시험할 모델 번호를 쉼표로 적으세요(빈칸 = 전부, 0 = 건너뜀): ").strip()
    if not text:
        return entries
    if text == "0":
        return []
    picked = []
    for t in text.replace(" ", "").split(","):
        if t.isdigit() and 1 <= int(t) <= len(entries) and entries[int(t) - 1] not in picked:
            picked.append(entries[int(t) - 1])
    return picked or entries


def save_result(summary, out_dir, io):
    name = "ai_probe_result_%s.txt" % datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    path = Path(out_dir) / name
    text = redact(summary, io.secrets) if io.secrets else summary   # 화면과 같은 글
    try:
        path.write_text(text + "\n", encoding="utf-8")
        io.say("결과를 남겼습니다: %s (주소와 키는 들어 있지 않습니다)" % path.name)
        return path
    except OSError:
        io.say("결과 파일을 쓰지 못했습니다(폴더 권한). 화면의 결과 코드를 옮겨 적으세요.")
        return None


_UNSET = object()


def read_key(args, io, interactive):
    """키를 받아 clean_key 로 정리한다. 대화형이면 쓸 수 없는 글자일 때 세 번까지 다시 묻는다.
    --key-env 의 이름은 화면에 찍지 않는다(키를 이름 자리에 잘못 줄 수 있다 - 독립 점검 F-07)."""
    if interactive:
        for _ in range(3):
            got = clean_key(io.secret("키(화면에 보이지 않습니다, 없으면 엔터): "))
            if got is not None:
                return got
            io.say("키에 쓸 수 없는 글자(한글, 빈칸, 줄바꿈 등)가 있습니다. 다시 적어 주세요.")
        io.say("키 없이 잽니다.")
        return ""
    if not args.key_env:
        return ""
    got = clean_key(os.environ.get(args.key_env, ""))
    if got is None:
        io.say("키 환경 변수에 쓸 수 없는 글자가 있습니다 - 키 없이 잽니다.")
        return ""
    if not got:
        io.say("키 환경 변수가 비어 있습니다 - 키 없이 잽니다.")
    return got


def cmd_probe(args, io, reg=_UNSET, env_proxies=None):
    io.say("MyLearner AI 점검 도구 (결과 코드 판 %d)" % CODE_VERSION)
    reg = read_registry_proxy() if reg is _UNSET else reg
    env = probe_env(env_proxies, reg)
    io.say("Python %s, OS %s" % (env["py"], _os_meaning(_value(env["os"]))))
    io.say("프록시 설정: %s" % SPECS["e"][3][2][env["proxy"]])
    if env["pac"] == "y":
        io.say("PAC(자동 구성 스크립트)가 있습니다 - Python 은 PAC 를 읽지 못합니다. 크롬과 경로가 다를 수 있습니다.")
    if args.insecure:
        io.say("주의: --insecure - 인증서를 검증하지 않습니다(결과 코드에 표시됩니다).")
    io.say("호출은 하나씩 하고 한 번 실행에 %d번까지 합니다. 모델마다 6~9번, 큰 모델은 몇 분 걸릴 수 있습니다." % args.max_calls)
    io.say("Ctrl+C 로 멈추면 그때까지의 결과를 냅니다.")
    budget = Budget(args.max_calls)
    try:
        ssl_ctx = make_ssl_context(args.cafile, args.insecure)
    except (OSError, ssl.SSLError, ValueError):
        io.say("인증서 파일(--cafile)을 읽지 못했습니다. 경로와 PEM 형식을 확인하세요.")
        return 2
    interactive = not args.server
    queue = list(args.server)
    servers, all_secrets, interrupted = [], [], False
    try:
        while True:
            if interactive:
                text = io.ask("\n서버 주소(예: http://192.0.2.10:8000, 끝내려면 빈 줄): ").strip()
            elif queue:
                text = queue.pop(0).strip()
            else:
                break
            if not text:
                break
            try:
                root, v1 = normalize_base(text)
            except ValueError as e:
                io.say("주소를 읽지 못했습니다: %s" % e)
                continue
            if "://" not in text:
                io.say("주소 앞에 http:// 를 붙여 보았습니다.")
            label = "S%d" % (len(servers) + 1)
            client = Client(root, v1, read_key(args, io, interactive), args.timeout, ssl_ctx, budget)
            all_secrets.extend(client.secrets)
            io.add_secrets(client.secrets)
            s, models = new_server_result(), []
            servers.append((s, models))
            try:
                s, entries = probe_server(client, io, label, args.insecure, s)
            except Exception as e:   # 한 서버의 예상 밖 오류로 결과 전체를 잃지 않는다(독립 점검 O-1)
                io.say("  [%s] 예상하지 못한 오류(%s) - 이 서버는 여기까지 잽니다" % (label, type(e).__name__))
                s["error"] = s["error"] or "!e"
                continue
            if s["error"]:
                io.say("  [%s] 서버 점검을 마치지 못했습니다: %s" % (label, ERR.get(s["error"], s["error"])))
                continue
            chosen = choose_models(entries, args.models, io, interactive, label, client.secrets)
            s["m"] = len(chosen)
            for j, entry in enumerate(chosen, 1):
                m = new_model_result(model_label(entry["id"], client.secrets))
                models.append(m)
                try:
                    probe_model(client, entry, s["kind"], io, "%sM%d %s" % (label, j, m["name"]), m)
                except Exception as e:   # 같은 까닭 - 남은 단계는 !e
                    io.say("  [%sM%d] 예상하지 못한 오류(%s) - 다음 모델로 갑니다" % (label, j, type(e).__name__))
                    for k, v in list(m.items()):
                        if v == "!s":
                            m[k] = "!e"
    except KeyboardInterrupt:
        interrupted = True
        io.say("\n멈췄습니다 - 그때까지의 결과를 냅니다.")
    except EOFError:
        pass
    env["servers"] = len(servers)
    lines = [env_line(env)]
    for i, (s, models) in enumerate(servers, 1):
        s["kind"], s["server"] = scrub(s["kind"], all_secrets), scrub(s["server"], all_secrets)
        lines.append(server_line(i, s))
        for j, m in enumerate(models, 1):
            m["name"] = scrub(m["name"], all_secrets)   # 다른 서버의 주소·키도 본다
            lines.append(model_line(i, j, m))
    summary = render_summary(lines)
    io.say(summary)
    save_result(summary, args.out_dir, io)
    return 130 if interrupted else 0


def cmd_decode(lines, io, stdin=None):
    if not lines:
        lines = (stdin or sys.stdin).read().splitlines()
    lines = [x for chunk in lines for x in str(chunk).splitlines() if x.strip()]
    io.say(render_summary(lines))
    bad = 0
    for x in lines:
        try:
            bad += 0 if parse_line(x)["ok"] else 1
        except ValueError:
            bad += 1
    return 1 if bad or not lines else 0


# ================================================================ B 등급: --serve-test
class _ProbeServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = not sys.platform.startswith("win")   # Windows 의 SO_REUSEADDR 는 쓰는 포트를 빼앗는다
    daemon_threads = True


def make_probe_server(port, token, html, results, io, host="127.0.0.1"):
    """127.0.0.1 시험 서버(설계서 3.4절). 포트가 쓰이면 다음 10개를 본다(0 이면 빈 포트)."""
    allowed = set()

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "mylearner-probe"
        sys_version = ""

        def log_message(self, fmt, *a):
            pass

        def _host_ok(self):
            return self.headers.get("Host", "") in allowed

        def _cookie_ok(self):
            c = http.cookies.SimpleCookie()
            try:
                c.load(self.headers.get("Cookie", ""))
            except http.cookies.CookieError:
                return False
            v = c.get("mlprobe")
            return v is not None and hmac.compare_digest(v.value.encode("utf-8"), token.encode("ascii"))

        def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code, obj):
            self._send(code, json.dumps(obj).encode("utf-8"))

        def do_GET(self):
            if not self._host_ok():
                return self._json(403, {"ok": False, "why": "host"})
            u = urllib.parse.urlsplit(self.path)
            if u.path == "/":
                t = (urllib.parse.parse_qs(u.query).get("t") or [""])[0]
                # 바이트로 비교한다 - str 은 ASCII 가 아니면 TypeError 를 낸다(독립 점검 O-2)
                if t and hmac.compare_digest(t.encode("utf-8"), token.encode("ascii")):
                    self.send_response(303)
                    self.send_header("Location", "/probe")
                    self.send_header("Set-Cookie", "mlprobe=%s; HttpOnly; SameSite=Strict; Path=/" % token)
                    self.send_header("Content-Length", "0")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return None
                return self._send(403, FORBIDDEN_HTML.encode("utf-8"), "text/html; charset=utf-8")
            if u.path == "/probe":
                return self._send(200, html, "text/html; charset=utf-8", {"Content-Security-Policy": CSP})
            if u.path == "/probe/ping":
                if not self._cookie_ok():
                    return self._json(403, {"ok": False})
                return self._json(200, {"ok": True, "py": platform.python_version()})
            return self._json(404, {"ok": False})

        def do_POST(self):
            if not self._host_ok():
                return self._json(403, {"ok": False, "why": "host"})
            path = urllib.parse.urlsplit(self.path).path
            if path not in ("/probe/echo", "/probe/result"):
                return self._json(404, {"ok": False})
            if not self._cookie_ok():
                return self._json(403, {"ok": False})
            n = self.headers.get("Content-Length")
            if n is None:
                return self._json(411, {"ok": False})
            try:
                n = int(n)
            except ValueError:
                return self._json(400, {"ok": False})
            if n < 0 or n > (SERVE_BODY_LIMIT if path == "/probe/echo" else RESULT_LIMIT):
                self.close_connection = True
                return self._json(413, {"ok": False})
            left, chunks = n, []
            while left > 0:
                chunk = self.rfile.read(min(left, 65536))
                if not chunk:
                    break
                chunks.append(chunk)
                left -= len(chunk)
            body = b"".join(chunks)
            if path == "/probe/echo":
                return self._json(200, {"bytes": len(body)})
            text = body.decode("utf-8", "replace").strip()
            if not re.fullmatch(r"b [\x20-\x7e]{1,%d}" % RESULT_LIMIT, text):   # 콘솔 제어 글자를 받지 않는다(O-3)
                return self._json(400, {"ok": False})
            results.append(text)
            io.say("브라우저 결과 코드: " + text)
            return self._json(200, {"ok": True})

    srv, last = None, None
    for p in ([port] if port == 0 else range(port, port + 11)):
        try:
            srv = _ProbeServer((host, p), Handler)
            break
        except OSError as e:
            last = e
    if srv is None:
        raise last
    actual = srv.server_address[1]
    allowed.update({"127.0.0.1:%d" % actual, "localhost:%d" % actual})
    return srv


def serve_test(port, io, open_browser=True, seconds=None, html_path=None):
    html_path = Path(html_path) if html_path else Path(__file__).resolve().with_name("browser_probe.html")
    try:
        html = html_path.read_bytes()
    except OSError:
        io.say("browser_probe.html 이 ai_probe.py 와 같은 폴더에 없습니다. 묶음을 푼 폴더에서 실행하세요.")
        return 2
    token = secrets.token_urlsafe(16)
    results = []
    try:
        srv = make_probe_server(port, token, html, results, io)
    except OSError:
        io.say("시험 서버를 띄우지 못했습니다(포트를 쓸 수 없음). --port 로 다른 번호를 주세요.")
        return 2
    url = "http://127.0.0.1:%d/?t=%s" % (srv.server_address[1], token)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    io.say("시험 서버를 띄웠습니다(이 PC 안에서만 열립니다).")
    io.say("크롬에서 이 주소를 여세요: " + url)
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:   # 브라우저를 못 열어도 주소로 열 수 있다
            io.say("브라우저를 열지 못했습니다 - 주소를 복사해 크롬에 붙여 넣으세요.")
    try:
        if seconds is not None:
            time.sleep(seconds)
        else:
            io.ask("페이지의 점검이 끝나면 엔터를 누르세요(서버를 닫습니다): ")
    except (KeyboardInterrupt, EOFError):
        pass
    finally:
        srv.shutdown()
        srv.server_close()
    if results:
        io.say("받은 브라우저 결과 코드:")
        for line in results:
            io.say("  " + line)
    else:
        io.say("브라우저 결과 코드를 받지 못했습니다 - 페이지 화면의 코드를 옮겨 적으세요.")
    return 0


# ================================================================ 진입점
class _Parser(argparse.ArgumentParser):
    def error(self, message):   # argparse 는 받은 인자를 오류 글에 되풀이한다 - 명령줄에 키를 잘못 줬을 수 있다
        self.exit(2, "인자를 읽지 못했습니다. 키는 명령줄에 쓰지 않고 물을 때 적습니다(도움말: ai_probe.py --help).\n")


def build_parser():
    # allow_abbrev=False: '--key <키>' 가 --key-env 의 줄임으로 받아들여져 키가 이름 자리로 가지 않게(독립 점검 F-07)
    ap = _Parser(prog="ai_probe.py", description="MyLearner 폐쇄망 AI 점검 도구 (결과 코드 판 %d)" % CODE_VERSION,
                 allow_abbrev=False)
    ap.add_argument("--server", action="append", default=[], help="(시험용) 서버 주소. 여러 번 줄 수 있다")
    ap.add_argument("--key-env", default=None, help="(시험용) 키를 읽을 환경 변수 이름")
    ap.add_argument("--models", default=None, help="all 또는 쉼표로 모델 이름")
    ap.add_argument("--max-calls", type=int, default=DEFAULT_MAX_CALLS, help="한 번 실행의 호출 상한(기본 80)")
    ap.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="호출마다 시간 제한 초(기본 300)")
    ap.add_argument("--cafile", default=None, help="사내 인증서(PEM) 파일")
    ap.add_argument("--insecure", action="store_true", help="https 인증서를 검증하지 않는다(결과 코드에 표시)")
    ap.add_argument("--no-pause", action="store_true", help="끝나도 엔터를 기다리지 않는다")
    ap.add_argument("--out-dir", default=".", help="결과 파일을 둘 폴더(기본: 지금 폴더)")
    ap.add_argument("--serve-test", action="store_true", help="127.0.0.1 시험 서버로 browser_probe.html 을 연다")
    ap.add_argument("--port", type=int, default=SERVE_PORT, help="시험 서버 포트(기본 8770, 0 = 빈 포트)")
    ap.add_argument("--no-browser", action="store_true", help="시험 서버를 띄우고 브라우저는 열지 않는다")
    ap.add_argument("--serve-seconds", type=float, default=None, help="(시험용) 시험 서버를 이 초만큼 띄운다")
    ap.add_argument("--decode", nargs="*", default=None, metavar="LINE", help="결과 코드 줄 풀이(줄이 없으면 표준 입력)")
    return ap


def run(argv=None, io=None, reg=_UNSET, env_proxies=None, stdin=None):
    args = build_parser().parse_args(argv)
    io = io or IO()
    if args.decode is not None:
        return cmd_decode(args.decode, io, stdin)
    try:
        if args.serve_test:
            return serve_test(args.port, io, open_browser=not args.no_browser, seconds=args.serve_seconds)
        return cmd_probe(args, io, reg, env_proxies)
    except Exception as e:   # 창이 바로 닫히지 않게 - 이름만 찍는다(메시지에 주소가 있을 수 있다)
        io.say("예상하지 못한 오류로 멈췄습니다: %s" % type(e).__name__)
        return 2
    finally:
        if not args.no_pause:
            io.pause()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(errors="replace")
        except (ValueError, OSError):
            pass
    sys.exit(run(sys.argv[1:]))


if __name__ == "__main__":
    main()
