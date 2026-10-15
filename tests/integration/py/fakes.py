"""시험용 가짜 AI 서버 — vLLM 꼴·Ollama 꼴·게이트웨이 꼴(HTML 200·401·느림·리다이렉트·길이 초과)과 정방향 프록시 꼴.

실제 AI 를 부르지 않는다. 받은 요청(방법·경로·헤더·본문)을 requests 에 남긴다.
응답 모양은 MWL tests/integration/fake_ai.py(기준 커밋 e053470)와 vLLM·Ollama 의 공개 API 모양을 본떴다 — 사내 서버의
실제 모양은 폐쇄망 점검 결과로만 안다(docs/P1_설계서_Probe.md 3.1절).
대응: docs/P1_요구사항정의서_Probe.md FR-113~136, docs/P1_테스트결과서_Probe.md 5.2절(독립 점검 — 글·빈 본문 차단 화면,
      깨진 Location, 깊은 JSON, 큰 수, 프록시가 키를 보는가)
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LONG_MARK = "시작 표지"


class FakeAI:
    """mode: vllm | ollama | html | auth401 | html403 | redirect | length400 | text403 | empty401 | bompage403
    | badredirect | deepjson | hugeusage.  cors: none | star | full."""

    def __init__(self, mode="vllm", key=None, cors="none", models=("openai/gpt-oss-120b",), ctx=131072,
                 num_ctx=4096, delay=0.0, redirect_to=None, server_header="uvicorn", version="0.9.2",
                 list_ctx=True, tokenize=True):
        self.mode, self.key, self.cors, self.models, self.ctx = mode, key, cors, list(models), ctx
        self.num_ctx, self.delay, self.redirect_to, self.server_header = num_ctx, delay, redirect_to, server_header
        self.version, self.list_ctx, self.tokenize = version, list_ctx, tokenize
        self.requests = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def version_string(self):
                return outer.server_header or ""

            def _send(self, code, body, ctype="application/json", extra=None):
                try:
                    self.send_response(code)
                    if ctype:
                        self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(body)))
                    for k, v in outer._cors_headers(self.headers.get("Origin"), preflight=False).items():
                        self.send_header(k, v)
                    for k, v in (extra or {}).items():
                        self.send_header(k, v)
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def _json(self, code, obj, extra=None):
                self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), extra=extra)

            def _record(self):
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n else b""
                try:
                    body = json.loads(raw.decode("utf-8")) if raw else None
                except ValueError:
                    body = raw
                outer.requests.append({"method": self.command, "path": self.path, "headers": dict(self.headers),
                                       "body": body})
                return body

            def do_OPTIONS(self):
                self._record()
                h = outer._cors_headers(self.headers.get("Origin"), preflight=True)
                if not h:
                    return self._send(405, b"")
                try:
                    self.send_response(204)
                    for k, v in h.items():
                        self.send_header(k, v)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def do_GET(self):
                self._handle(self._record())

            def do_POST(self):
                self._handle(self._record())

            def _handle(self, body):
                outer._dispatch(self, body)

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.srv.daemon_threads = True
        self.port = self.srv.server_address[1]
        self.base = "http://127.0.0.1:%d" % self.port
        threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()

    # ------------------------------------------------------------ 응답
    def _cors_headers(self, origin, preflight):
        if self.cors == "none" or not origin:
            return {}
        if self.cors == "star":
            h = {"Access-Control-Allow-Origin": "*"}
            if preflight:
                h.update({"Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"})
            return h
        h = {"Access-Control-Allow-Origin": "null" if origin == "null" else origin}
        if preflight:
            h.update({"Access-Control-Allow-Headers": "authorization, content-type",
                      "Access-Control-Allow-Methods": "GET, POST"})
        return h

    def _dispatch(self, h, body):
        path = h.path.split("?", 1)[0]
        if self.delay:
            time.sleep(self.delay)
        if self.mode == "html":
            return h._send(200, "<html><body>점검 중입니다</body></html>".encode("utf-8"), "text/html; charset=utf-8")
        if self.mode == "auth401":
            return h._json(401, {"error": {"message": "unauthorized"}})
        if self.mode == "html403":   # 프록시·게이트웨이의 차단 화면
            return h._send(403, "<html><body>접근이 차단되었습니다</body></html>".encode("utf-8"), "text/html; charset=utf-8")
        if self.mode == "redirect":
            return h._send(307, b"", extra={"Location": (self.redirect_to or "") + h.path})
        if self.mode == "text403":       # 글로 된 차단 화면(Envoy 꼴)
            return h._send(403, b"RBAC: access denied", "text/plain")
        if self.mode == "empty401":      # 본문 없는 401(Negotiate 요구)
            return h._send(401, b"", None, extra={"WWW-Authenticate": "Negotiate"})
        if self.mode == "bompage403":    # BOM 이 붙은 HTML 을 글이라고 함
            return h._send(403, "\ufeff<html><body>차단</body></html>".encode("utf-8"), "text/plain")
        if self.mode == "badredirect":   # 읽을 수 없는 Location
            return h._send(302, b"", extra={"Location": "http://[::1"})
        if self.mode == "deepjson" and path == "/v1/models":
            return h._send(200, b"[" * 100000, "application/json")
        if self.key and path.startswith("/v1") and h.headers.get("Authorization") != "Bearer " + self.key:
            return h._json(401, {"error": {"message": "invalid api key"}})
        if self.mode == "ollama":
            return self._ollama(h, path, body)
        return self._vllm(h, path, body)

    def _vllm(self, h, path, body):
        if path == "/v1/models":
            data = []
            for m in self.models:
                d = {"id": m, "object": "model", "owned_by": "vllm", "root": m}
                if self.list_ctx:
                    d["max_model_len"] = self.ctx
                data.append(d)
            return h._json(200, {"object": "list", "data": data})
        if path == "/version":
            return h._json(200, {"version": self.version})
        if path == "/tokenize" and self.tokenize:
            prompt = (body or {}).get("prompt", "")
            return h._json(200, {"count": len(prompt), "max_model_len": self.ctx, "tokens": list(range(len(prompt)))})
        if path == "/v1/chat/completions":
            return self._chat(h, body or {}, vllm=True)
        if path == "/v1/responses":
            return h._json(200, {"id": "resp_1", "status": "completed",
                                 "output": [{"type": "reasoning", "summary": []},
                                            {"type": "message", "role": "assistant",
                                             "content": [{"type": "output_text", "text": "5"}]}],
                                 "usage": {"input_tokens": 20, "output_tokens": 12,
                                           "output_tokens_details": {"reasoning_tokens": 8}}})
        return h._json(404, {"detail": "Not Found"})

    def _ollama(self, h, path, body):
        if path == "/v1/models":
            return h._json(200, {"object": "list", "data": [{"id": m, "object": "model", "owned_by": "library"}
                                                           for m in self.models]})
        if path == "/api/version":
            return h._json(200, {"version": self.version})
        if path == "/api/show":
            return h._json(200, {"parameters": "stop \"<|im_end|>\"\nnum_ctx                        %d" % self.num_ctx,
                                 "model_info": {"general.architecture": "qwen3", "qwen3.context_length": self.ctx}})
        if path == "/v1/chat/completions":
            return self._chat(h, body or {}, vllm=False)
        return h._send(404, b"404 page not found", "text/plain")

    def _chat(self, h, body, vllm):
        messages = body.get("messages") or [{}]
        prompt = str(messages[-1].get("content", ""))
        max_tokens = body.get("max_tokens") or 0
        if vllm and max_tokens > self.ctx:
            return h._json(400, {"object": "error", "type": "BadRequestError", "code": 400,
                                 "message": "This model's maximum context length is %d tokens. However, you requested "
                                            "%d tokens (9 in the messages, %d in the completion)."
                                            % (self.ctx, max_tokens + 9, max_tokens)})
        if self.mode == "length400" and LONG_MARK in prompt:
            return h._json(400, {"object": "error", "message": "This model's maximum context length is 4096 tokens."})
        usage = {"prompt_tokens": max(1, int(len(prompt) / 1.6)), "completion_tokens": 3}
        msg = {"role": "assistant", "content": "10"}
        if LONG_MARK in prompt:
            if not vllm and len(prompt) > self.num_ctx * 1.5:      # Ollama 는 앞을 조용히 잘라 낸다
                msg["content"] = "시작=?, 끝=PLUM-2931"
                usage["prompt_tokens"] = self.num_ctx
            else:
                msg["content"] = "시작=KIWI-4817, 끝=PLUM-2931"
        elif body.get("response_format"):
            ans = json.dumps({"answer": 7, "unit": "개"}, ensure_ascii=False)
            msg["content"] = ans if vllm else "```json\n" + ans + "\n```"
        if vllm:
            effort = body.get("reasoning_effort")
            kwargs = body.get("chat_template_kwargs") or {}
            if kwargs.get("enable_thinking") is False:
                rt = 0
            elif effort == "high":
                rt = 900
            else:
                rt = 40
            if rt:
                msg["reasoning_content"] = "생각" * rt
            usage["completion_tokens"] = rt + 3
            usage["completion_tokens_details"] = {"reasoning_tokens": rt}
        if self.mode == "hugeusage":     # 터무니없이 큰 수
            usage = {"prompt_tokens": 10 ** 400, "completion_tokens": 10 ** 400,
                     "completion_tokens_details": {"reasoning_tokens": 10 ** 400}}
        return h._json(200, {"id": "chatcmpl-1", "object": "chat.completion", "model": body.get("model"),
                             "choices": [{"index": 0, "finish_reason": "stop", "message": msg}], "usage": usage})


class CaptureProxy:
    """정방향 프록시 꼴 — 받은 요청(절대 주소, 헤더)을 requests 에 남기고 대상에 넘기지 않고 스스로 답한다.
    answer: json401(대상의 401 을 넘겨준 것처럼) | text403(프록시의 글 차단 화면)."""

    def __init__(self, answer="json401"):
        self.answer, self.requests = answer, []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _any(self):
                outer.requests.append({"method": self.command, "path": self.path, "headers": dict(self.headers)})
                n = int(self.headers.get("Content-Length") or 0)
                if n:
                    self.rfile.read(n)
                if outer.answer == "json401":
                    code, ctype, body = 401, "application/json", b'{"error": "Unauthorized"}'
                else:
                    code, ctype, body = 403, "text/plain", b"Access Denied"
                try:
                    self.send_response(code)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            do_GET = do_POST = do_OPTIONS = _any

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.srv.daemon_threads = True
        self.url = "http://127.0.0.1:%d" % self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()

    def saw_key(self):
        return any("Authorization" in r["headers"] for r in self.requests)
