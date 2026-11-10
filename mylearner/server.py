"""로컬 서버(서버 모드) — 정적 파일(web/)·기록·사용자 과정·백업 API, 접속 토큰, 보안 헤더. 표준 라이브러리 http.server 만.

MWL mwl/web/server.py(MiddlewareLearner@e55b9c0)의 정적 파일·형식 표·토큰 쿠키를 옮겨 고쳤다. 더한 것: Host 검사(DNS 리바인딩),
쓰기 요청의 Content-Type·Origin 검사, 모든 응답의 CSP·no-referrer·nosniff·no-store, 한도, 소켓 시한, 이번에 켠 동안만 쓰는 쿠키·한 번짜리 여는 주소
(독립 점검 V1~V8 — docs/P3_테스트결과서_PC.md 5.2절). 127.0.0.1 에만 묶는다.
API: GET /api/health · /api/device · /api/log · /api/courses · /api/backups[/<이름>](판 설정 export 일 때만) · /api/backups/<이름>/diff(P4)
     POST /api/log {"lines": [...]} · /api/backups {"reason": "..."} · /api/backups/<이름>/restore {"remove": [...]}(P4)   PUT /api/courses/<id>
입력: AppState(웹 폴더·DataDir·판 설정·토큰) / 출력: ThreadingHTTPServer / 트리거: python -m mylearner serve(mylearner/__main__.py)
문서: docs/P3_요구사항정의서_PC.md FR-330~335, docs/P3_설계서_PC.md 3.3·4절, docs/P4_설계서_Mobile.md 3.6절(되살리기 API)
"""
from __future__ import annotations

import hmac
import html
import json
import logging
import mimetypes
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qsl, unquote, urlencode, urlparse

from mylearner import __version__
from mylearner.storage import DataDir, StorageError, loads

MAX_BODY = 32 * 1024 * 1024
DRAIN_MAX = 64 * 1024        # 거부하는 요청의 본문은 이만큼만 읽어 버린다(큰 본문을 다 읽고 답하지 않게 — 독립 점검 V5)
SOCKET_TIMEOUT = 30          # 멈춘 연결이 스레드를 영구히 잡지 않게(V5)
ONCE_TTL = 120               # 브라우저를 열 때 쓰는 한 번짜리 주소의 수명(초) — 토큰을 브라우저 명령줄에 싣지 않는다(V2)
COOKIE_DAYS = 30
TOKEN_HEADER = "X-MyLearner-Token"
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
# 화면 파일의 형식은 정해 둔다 — Windows 의 mimetypes 는 레지스트리를 읽고, .js·.css 가 text/plain 인 PC 가 있다(MWL T-036)
STATIC_TYPES = {".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json",
                ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain"}
log = logging.getLogger("mylearner.server")
DENY_API = "접속 토큰이 필요합니다 - 서버를 켠 창에 나온 주소(.../?token=...)로 여세요"
LOGIN_PAGE = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>MyLearner - 접속 토큰</title></head>
<body><h1>접속 토큰이 필요합니다</h1>
<p>@REASON@</p>
<p>MyLearner 는 <strong>서버를 켠 계정만</strong> 열 수 있습니다. 서버를 켠 창에 나온 주소(끝에 <code>?token=...</code> 이 붙은 것)로 여세요.
한 번 열면 서버를 끄기 전까지는 토큰 없이 열립니다.</p>
<form method="get" action="@PATH@"><label>또는 토큰을 붙여 넣으세요 - 데이터 폴더의 <code>token</code> 파일
<input name="token" autocomplete="off" autofocus></label> <button type="submit">열기</button></form>
</body></html>
"""


class AppState:
    """핸들러가 공유하는 상태. 시험은 임시 폴더로 만든다.

    token   = 데이터 폴더의 오래가는 접속 토큰(창에 찍는 주소 · 명령줄 도구의 X-MyLearner-Token).
    session = 이번에 켠 동안만 쓰는 쿠키 값 — 쿠키에 토큰을 싣지 않는다. 127.0.0.1 쿠키는 포트를 가리지 않고 같은 PC 의 다른 서버에도
              가므로(RFC 6265) 새어도 서버를 다시 켜면 끝난다(독립 점검 '의심 1').
    once    = 브라우저를 열 때 쓰는 한 번짜리 주소(ONCE_TTL 초, 한 번 쓰면 버린다) — 브라우저 명령줄(ps 로 보인다)에 토큰을 싣지 않는다(V2)"""

    def __init__(self, web_dir: Path, data: DataDir, edition: dict, token: Optional[str]):
        self.web_dir = Path(web_dir).resolve()
        self.data = data
        self.edition = edition or {}
        self.token = token     # None 이면 보호하지 않는다(시험용 — serve 는 늘 준다)
        self.session = secrets.token_hex(32)
        self._once = {}
        self._lock = threading.Lock()

    def new_once(self, now=None) -> str:
        code = secrets.token_hex(16)
        with self._lock:
            self._once[code] = (time.monotonic() if now is None else now) + ONCE_TTL
        return code

    def use_once(self, code: str, now=None) -> bool:
        with self._lock:
            until = self._once.pop(code, None)
        return until is not None and (time.monotonic() if now is None else now) <= until


def make_handler(state: AppState):
    class Handler(BaseHTTPRequestHandler):
        server_version = "mylearner/" + __version__
        sys_version = ""
        timeout = SOCKET_TIMEOUT

        def log_message(self, fmt, *args):   # 조용히 — 주소·토큰을 찍지 않는다
            log.debug("%s " + fmt, self.command, *args)

        # -- 응답
        def _head(self, code: int, ctype: str, length: int, extra=None) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            for k, v in (extra or []):
                self.send_header(k, v)
            self.end_headers()

        def _send(self, code: int, ctype: str, body: bytes, extra=None) -> None:
            self._head(code, ctype, len(body), extra)
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, code: int, payload: Any) -> None:
            self._send(code, "application/json; charset=utf-8", json.dumps(payload, ensure_ascii=False).encode("utf-8"))

        def _text(self, code: int, text: str) -> None:
            self._send(code, "text/plain; charset=utf-8", text.encode("utf-8"))

        def _drain(self) -> None:   # 본문을 안 읽고 닫으면 응답이 TCP RST 로 사라질 수 있다 — 작은 본문만 읽어 버린다(V5)
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                n = 0
            if 0 < n <= DRAIN_MAX:
                self.rfile.read(n)
            else:
                self.close_connection = True

        def _read_json(self) -> Any:
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise StorageError("Content-Length 가 틀렸다")
            if n < 0:
                raise StorageError("Content-Length 가 틀렸다")
            if n > MAX_BODY:
                self.close_connection = True
                raise OverflowError()
            raw = self.rfile.read(n) if n else b""
            try:
                return loads(raw.decode("utf-8") or "null")
            except (ValueError, UnicodeDecodeError):
                raise StorageError("JSON 이 아니다(NaN·Infinity 도 받지 않는다)")
            except RecursionError:
                raise StorageError("JSON 이 너무 깊다")

        # -- 관문
        def _port(self) -> int:
            return self.server.server_address[1]

        def _host_ok(self) -> bool:
            host = (self.headers.get("Host") or "").strip().lower()
            return host in ("127.0.0.1:%d" % self._port(), "localhost:%d" % self._port())

        def _cookie_name(self) -> str:
            return "mylearner_%d" % self._port()   # 포트마다 따로 — 두 앱(MWL 병행)·두 계정이 섞이지 않게

        def _same(self, got: str, want: str) -> bool:
            return hmac.compare_digest((got or "").encode("utf-8"), want.encode("utf-8"))

        def _authorized(self) -> bool:
            got = self.headers.get(TOKEN_HEADER)
            if got is not None:   # 명령줄 도구 — 오래가는 토큰
                return self._same(got, state.token)
            got = ""              # 쿠키 헤더를 직접 나눈다 — 같은 주소의 다른 앱 쿠키가 꼴이 틀려도 내 것을 읽는다
            for part in (self.headers.get("Cookie") or "").split(";"):
                name, _, value = part.strip().partition("=")
                if name == self._cookie_name():
                    got = value.strip().strip('"')
            return self._same(got, state.session)

        def _deny(self, path: str, reason: str) -> None:
            if path.startswith("/api/"):
                return self._json(401, {"error": DENY_API})
            page = (LOGIN_PAGE.replace("@REASON@", html.escape(reason)).replace("@DAYS@", str(COOKIE_DAYS))
                    .replace("@PATH@", html.escape(path or "/", quote=True)))
            self._send(401, "text/html; charset=utf-8", page.encode("utf-8"))

        def _gate(self) -> bool:
            """통과하면 True. 아니면 이미 응답했다(400 · 401 · 쿠키를 주는 302)."""
            if not self._host_ok():
                self._drain()
                self._text(400, "Host 가 맞지 않습니다 - http://127.0.0.1:%d/ 로 여세요" % self._port())
                return False
            if state.token is None:
                return True
            u = urlparse(self.path)
            params = parse_qsl(u.query, keep_blank_values=True)
            given = [v for k, v in params if k == "token"]
            once = [v for k, v in params if k == "once"]
            if self.command == "GET" and (given or once):
                if given and not self._same(given[-1], state.token):
                    self._deny(u.path, "토큰이 맞지 않습니다. 서버를 켠 창의 주소를 다시 확인하세요.")
                    return False
                if not given and not state.use_once(once[-1]):
                    self._deny(u.path, "한 번 쓰는 주소가 이미 쓰였거나 지났습니다. 서버를 켠 창에 찍힌 주소(?token=...)로 여세요.")
                    return False
                rest = urlencode([(k, v) for k, v in params if k not in ("token", "once")])
                cookie = "%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d" % (self._cookie_name(), state.session, COOKIE_DAYS * 86400)
                self._send(302, "text/plain; charset=utf-8", b"", [("Location", (u.path or "/") + ("?" + rest if rest else "")), ("Set-Cookie", cookie)])
                return False
            if self._authorized():
                return True
            self._drain()
            self._deny(u.path, "")
            return False

        def _write_ok(self) -> bool:
            """쓰기 요청 — JSON 본문, 같은 출처만(다른 사이트의 폼·스크립트가 쿠키를 싣고 오는 것을 막는다)."""
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            origin = self.headers.get("Origin")
            site = self.headers.get("Sec-Fetch-Site")
            mine = ("http://127.0.0.1:%d" % self._port(), "http://localhost:%d" % self._port())
            if ctype != "application/json" or (origin is not None and origin not in mine) or (site is not None and site not in ("same-origin", "none")):
                self._drain()
                self._json(403, {"error": "같은 화면에서 보낸 JSON 요청만 받습니다"})
                return False
            return True

        # -- 정적 파일
        def _static(self, path: str) -> None:
            rel = unquote(path).lstrip("/") or "index.html"
            if any(part.startswith(".") for part in rel.split("/")) or "\x00" in rel or "\\" in rel:
                return self._json(404, {"error": "not found"})
            try:   # 아주 긴 이름·예약 이름(OSError)은 없는 파일로(독립 점검 V6)
                target = (state.web_dir / rel).resolve()
                if state.web_dir != target and state.web_dir not in target.parents:
                    return self._json(404, {"error": "not found"})
                if target.is_dir():
                    target = target / "index.html"
                if not target.is_file():
                    return self._json(404, {"error": "not found"})
            except (OSError, ValueError):
                return self._json(404, {"error": "not found"})
            ctype = STATIC_TYPES.get(target.suffix.lower()) or mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
                ctype += "; charset=utf-8"
            self._send(200, ctype, target.read_bytes())

        # -- 라우팅
        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            if not self._gate():
                return
            path = urlparse(self.path).path
            try:
                if path == "/api/health":
                    return self._json(200, {"ok": True, "app": "mylearner", "version": __version__, "edition": state.edition.get("edition", "")})
                if path == "/api/device":
                    return self._json(200, {"dev": state.data.device(), "where": "데이터 폴더의 log.jsonl(서버 모드)"})
                if path == "/api/log":
                    return self._text(200, state.data.log_text())
                if path == "/api/courses":
                    return self._json(200, {"courses": state.data.courses()})
                if path == "/api/backups":
                    return self._json(200, {"backups": state.data.list_backups()})
                if path.startswith("/api/backups/") and path.endswith("/diff"):   # 되살리기 미리보기 — 백업 글은 내주지 않는다(두 판 모두, P4 FR-451)
                    only_current, only_backup = state.data.backup_diff(unquote(path[len("/api/backups/"):-len("/diff")]))
                    return self._json(200, {"only_current": only_current, "only_backup": only_backup})
                if path.startswith("/api/backups/"):
                    if state.edition.get("export") is not True:
                        return self._json(404, {"error": "이 판에서는 백업을 내려받지 않습니다"})
                    return self._text(200, state.data.backup_text(unquote(path[len("/api/backups/"):])))
                if path.startswith("/api/"):
                    return self._json(404, {"error": "unknown api"})
                return self._static(path)
            except FileNotFoundError:
                return self._json(404, {"error": "not found"})
            except StorageError as e:
                return self._json(400, {"error": str(e)})
            except (ValueError, OSError, RecursionError, TypeError):   # 처리하지 못한 입력 — 응답 없이 끊지 않는다(V6). 절대 경로를 싣지 않는다
                log.debug("GET 처리 실패", exc_info=True)
                return self._json(400, {"error": "요청을 처리하지 못했습니다"})

        def _write(self, method: str):
            if not self._gate() or not self._write_ok():
                return
            path = urlparse(self.path).path
            try:
                if method == "POST" and path == "/api/log":
                    body = self._read_json()
                    if not isinstance(body, dict):
                        raise StorageError("본문은 {\"lines\": [...]} 이다")
                    added, total = state.data.append(body.get("lines"))
                    return self._json(200, {"ok": True, "added": added, "total": total})
                if method == "POST" and path == "/api/backups":
                    body = self._read_json()
                    reason = body.get("reason") if isinstance(body, dict) else None
                    return self._json(200, {"ok": True, "name": state.data.backup(reason if isinstance(reason, str) else "")})
                if method == "POST" and path.startswith("/api/backups/") and path.endswith("/restore"):
                    body = self._read_json()
                    if not isinstance(body, dict):
                        raise StorageError("본문은 {\"remove\": [...]} 이다")
                    r = state.data.restore(unquote(path[len("/api/backups/"):-len("/restore")]), body.get("remove"))
                    return self._json(200, dict(r, ok=True))
                if method == "PUT" and path.startswith("/api/courses/"):
                    state.data.save_course(unquote(path[len("/api/courses/"):]), self._read_json())
                    return self._json(200, {"ok": True})
                self._drain()
                return self._json(404, {"error": "unknown api"})
            except OverflowError:
                return self._json(413, {"error": "본문이 %d MB 를 넘습니다" % (MAX_BODY // (1024 * 1024))})
            except StorageError as e:
                return self._json(400, {"error": str(e)})
            except (ValueError, OSError, RecursionError, TypeError):   # V6
                log.debug("%s 처리 실패", method, exc_info=True)
                return self._json(400, {"error": "요청을 처리하지 못했습니다"})

        def do_POST(self):
            self._write("POST")

        def do_PUT(self):
            self._write("PUT")

    return Handler


class _Server(ThreadingHTTPServer):
    # Windows 의 SO_REUSEADDR 는 이미 쓰는 포트에 다른 프로세스가 또 묶이게 한다(MWL 병행·다른 계정) — Windows 에서는 끈다
    allow_reuse_address = os.name != "nt"


def make_server(state: AppState, port: int, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    server = _Server((host, port), make_handler(state))
    server.daemon_threads = True
    return server
