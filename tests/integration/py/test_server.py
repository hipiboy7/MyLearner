"""mylearner/server.py·__main__.py — 실제 서버(127.0.0.1, 빈 포트)에 HTTP 로 (등급 B, FR-330~335). 문서: docs/P3_설계서_PC.md 3.3절."""
from __future__ import annotations

import contextlib
import http.client
import io
import json
import shutil
import socket
import tempfile
import threading
import unittest
from pathlib import Path

from mylearner import __main__ as CLI
from mylearner import server as SV
from mylearner.storage import LOG_HEADER, DataDir


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ServerTest(unittest.TestCase):
    edition = {"edition": "closed", "label": "폐쇄망판", "export": False}

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ml-srv-"))
        web = self.tmp / "web"
        (web / "core").mkdir(parents=True)
        (web / "index.html").write_text("<!doctype html><title>t</title>", encoding="utf-8")
        (web / "core" / "a.js").write_text("var a = 1;", encoding="utf-8")
        (web / ".secret").write_text("no", encoding="utf-8")
        self.data = DataDir(self.tmp / "data")
        self.token = self.data.token()
        self.state = SV.AppState(web, self.data, dict(self.edition), self.token)
        self.port = free_port()
        self.srv = SV.make_server(self.state, self.port)
        self.th = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.th.start()
        self.cookie = "mylearner_%d=%s" % (self.port, self.state.session)

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def req(self, method, path, body=None, headers=None, cookie=True, host=None):
        h = {"Host": host or "127.0.0.1:%d" % self.port}
        if cookie:
            h["Cookie"] = "other=1; " + self.cookie
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode("utf-8")
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, dict(r.getheaders()), data

    def test_host_check_blocks_rebinding(self):
        st, _, body = self.req("GET", "/api/health", host="evil.example:%d" % self.port)
        self.assertEqual(st, 400)
        self.assertIn("Host", body.decode("utf-8"))
        self.assertEqual(self.req("GET", "/api/health", host="localhost:%d" % self.port)[0], 200)

    def test_token_gate_and_cookie(self):
        st, h, body = self.req("GET", "/", cookie=False)
        self.assertEqual(st, 401)
        self.assertIn("접속 토큰", body.decode("utf-8"))
        self.assertEqual(self.req("GET", "/api/log", cookie=False)[0], 401)
        self.assertEqual(self.req("GET", "/?token=wrong", cookie=False)[0], 401)
        st, h, _ = self.req("GET", "/?token=%s&x=1" % self.token, cookie=False)
        self.assertEqual(st, 302)
        self.assertEqual(h["Location"], "/?x=1")
        self.assertIn("HttpOnly", h["Set-Cookie"])
        self.assertIn("SameSite=Strict", h["Set-Cookie"])
        self.assertTrue(h["Set-Cookie"].startswith("mylearner_%d=%s;" % (self.port, self.state.session)), "쿠키에는 이번에 켠 동안의 세션 값")
        self.assertNotIn(self.token, h["Set-Cookie"], "쿠키에 오래가는 토큰을 싣지 않는다(독립 점검 의심 1)")
        self.assertEqual(self.req("GET", "/api/health", cookie=False, headers={SV.TOKEN_HEADER: self.token})[0], 200)
        st, _, body = self.req("POST", "/api/log", {"lines": ["a"]}, cookie=False)
        self.assertEqual(st, 401)
        self.assertEqual(self.data.log_text(), LOG_HEADER + "\n")

    def test_security_headers_on_every_response(self):
        for path in ("/", "/api/health", "/nope", "/api/nope"):
            _, h, _ = self.req("GET", path)
            self.assertEqual(h["Content-Security-Policy"], SV.CSP)
            self.assertEqual(h["Referrer-Policy"], "no-referrer")
            self.assertEqual(h["X-Content-Type-Options"], "nosniff")
            self.assertEqual(h["Cache-Control"], "no-store")
            self.assertNotIn("Python", h.get("Server", ""))

    def test_static_files_and_traversal(self):
        st, h, body = self.req("GET", "/")
        self.assertEqual((st, h["Content-Type"]), (200, "text/html; charset=utf-8"))
        st, h, body = self.req("GET", "/core/a.js")
        self.assertEqual((st, h["Content-Type"], body), (200, "application/javascript; charset=utf-8", b"var a = 1;"))
        st, h, body = self.req("HEAD", "/core/a.js")
        self.assertEqual((st, body, h["Content-Length"]), (200, b"", "10"))
        for bad in ("/../data/token", "/%2e%2e/data/token", "/.secret", "/core/../../data/token", "/core/missing.js"):
            self.assertEqual(self.req("GET", bad)[0], 404, bad)
        self.assertEqual(self.req("GET", "/core")[0], 404, "폴더에 index.html 이 없으면 404")

    def test_log_api(self):
        st, _, body = self.req("GET", "/api/health")
        self.assertEqual(json.loads(body)["app"], "mylearner")
        dev = json.loads(self.req("GET", "/api/device")[2])
        self.assertRegex(dev["dev"], r"^[0-9a-f]{16}$")
        self.assertNotIn(str(self.tmp), dev["where"], "절대 경로를 보내지 않는다")
        st, _, body = self.req("POST", "/api/log", {"lines": ["x1", "x2", "x1"]})
        self.assertEqual((st, json.loads(body)), (200, {"ok": True, "added": 2, "total": 2}))
        st, h, body = self.req("GET", "/api/log")
        self.assertEqual(h["Content-Type"], "text/plain; charset=utf-8")
        self.assertEqual(body.decode("utf-8"), LOG_HEADER + "\nx1\nx2\n")
        self.assertEqual(self.req("POST", "/api/log", {"lines": ["a\nb"]})[0], 400)
        self.assertEqual(self.req("POST", "/api/log", {"nolines": 1})[0], 400)
        self.assertEqual(self.req("POST", "/api/log", [1])[0], 400)
        self.assertEqual(self.req("POST", "/api/log", b"{bad", headers={"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.req("POST", "/api/nope", {"a": 1})[0], 404)

    def test_write_requires_json_and_same_origin(self):
        st, _, _ = self.req("POST", "/api/log", b'{"lines":["a"]}', headers={"Content-Type": "text/plain"})
        self.assertEqual(st, 403)
        st, _, _ = self.req("POST", "/api/log", {"lines": ["a"]}, headers={"Origin": "http://evil.example"})
        self.assertEqual(st, 403)
        st, _, _ = self.req("POST", "/api/log", {"lines": ["a"]}, headers={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(st, 403)
        st, _, _ = self.req("POST", "/api/log", {"lines": ["a"]}, headers={"Origin": "http://127.0.0.1:%d" % self.port, "Sec-Fetch-Site": "same-origin"})
        self.assertEqual(st, 200)
        self.assertEqual(self.data.log_text(), LOG_HEADER + "\na\n")

    def test_body_limit(self):
        old = SV.MAX_BODY
        SV.MAX_BODY = 100
        try:
            st, _, body = self.req("POST", "/api/log", {"lines": ["x" * 200]})
            self.assertEqual(st, 413)
        finally:
            SV.MAX_BODY = old

    def test_courses_and_backups(self):
        c = {"format": "mylearner-course", "id": "mwl-notes", "title": "메모"}
        self.assertEqual(self.req("PUT", "/api/courses/mwl-notes", c)[0], 200)
        self.assertEqual(json.loads(self.req("GET", "/api/courses")[2]), {"courses": [c]})
        self.assertEqual(self.req("PUT", "/api/courses/other", c)[0], 400)
        self.req("POST", "/api/log", {"lines": ["a"]})
        st, _, body = self.req("POST", "/api/backups", {"reason": "import-mwl"})
        self.assertEqual(st, 200)
        name = json.loads(body)["name"]
        self.assertEqual(json.loads(self.req("GET", "/api/backups")[2])["backups"][0]["name"], name)
        self.assertEqual(self.req("POST", "/api/backups", {"reason": "../x"})[0], 400)
        self.assertEqual(self.req("GET", "/api/backups/" + name)[0], 404, "폐쇄망판은 내려받기 없음")
        self.state.edition["export"] = True
        st, _, body = self.req("GET", "/api/backups/" + name)
        self.assertEqual((st, body.decode("utf-8")), (200, LOG_HEADER + "\na\n"))
        self.assertEqual(self.req("GET", "/api/backups/20200101T000000000Z-daily")[0], 404)
        self.assertEqual(self.req("GET", "/api/backups/..%2ftoken")[0], 400)

    def test_backup_diff_and_restore_api(self):   # P4 FR-440~443·451 — 폐쇄망판도 되살리기를 쓰고, 백업 글은 내주지 않는다
        self.req("POST", "/api/log", {"lines": ["a"]})
        name = json.loads(self.req("POST", "/api/backups", {"reason": "import-merge"})[2])["name"]
        self.req("POST", "/api/log", {"lines": ["b", "c"]})
        st, _, body = self.req("GET", "/api/backups/%s/diff" % name)
        self.assertEqual((st, json.loads(body)), (200, {"only_current": ["b", "c"], "only_backup": 0}))
        st, _, body = self.req("POST", "/api/backups/%s/restore" % name, {"remove": ["b"]})
        r = json.loads(body)
        self.assertEqual((st, r["removed"], r["added"], r["total"]), (200, 1, 0, 2))
        self.assertEqual(self.req("GET", "/api/log")[2].decode("utf-8"), LOG_HEADER + "\na\nc\n")
        self.assertEqual(self.req("GET", "/api/backups/" + r["backup"])[0], 404, "폐쇄망판은 백업 글을 내주지 않는다")
        self.assertEqual(self.req("GET", "/api/backups/20200101T000000000Z-daily/diff")[0], 404)
        self.assertEqual(self.req("POST", "/api/backups/%s/restore" % name, {"remove": "x"})[0], 400)
        self.assertEqual(self.req("POST", "/api/backups/%s/restore" % name, {"remove": []}, headers={"Origin": "http://evil.example"})[0], 403)
        self.assertEqual(self.req("GET", "/api/backups/..%2ftoken/diff")[0], 400)

    def test_once_code_and_session_cookie(self):
        code = self.state.new_once()
        st, h, _ = self.req("GET", "/?once=%s" % code, cookie=False)
        self.assertEqual((st, h["Location"]), (302, "/"))
        self.assertIn("mylearner_%d=%s" % (self.port, self.state.session), h["Set-Cookie"])
        self.assertEqual(self.req("GET", "/?once=%s" % code, cookie=False)[0], 401, "한 번 쓰면 버린다")
        late = self.state.new_once(now=0)
        self.assertFalse(self.state.use_once(late, now=SV.ONCE_TTL + 1), "수명이 지나면 못 쓴다")
        self.assertEqual(self.req("GET", "/?once=nope", cookie=False)[0], 401)
        old = "mylearner_%d=%s" % (self.port, self.token)   # 앞 판 꼴(토큰 쿠키)
        self.assertEqual(self.req("GET", "/api/health", cookie=False, headers={"Cookie": old})[0], 401)
        other = SV.AppState(self.tmp / "web", self.data, {}, self.token)
        self.assertNotEqual(other.session, self.state.session, "서버를 다시 켜면 세션이 바뀐다")

    def test_bad_inputs_answer_instead_of_dropping(self):   # 독립 점검 V6·V7
        for path in ("/index.html%00.txt", "/%00", "/" + "a/" * 3000, "/" + "x" * 300, "/core%5ca.js"):
            st, h, body = self.req("GET", path)
            self.assertEqual(st, 404, path[:40])
            self.assertNotIn(str(self.tmp), body.decode("utf-8"))
        h = {"Host": "127.0.0.1:%d" % self.port, "Cookie": self.cookie, "Content-Type": "application/json", "Content-Length": "-5"}
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.putrequest("POST", "/api/log", skip_host=True)
        for k, v in h.items():
            c.putheader(k, v)
        c.endheaders()
        self.assertEqual(c.getresponse().status, 400)
        c.close()
        self.assertEqual(self.req("PUT", "/api/courses/abc", b"[" * 100000, headers={"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.req("POST", "/api/backups", {"reason": ["x"]})[0], 400)
        self.assertEqual(self.req("POST", "/api/backups", {"reason": "abc\n"})[0], 400, "끝 줄바꿈을 받지 않는다(fullmatch)")
        self.assertEqual(self.req("PUT", "/api/courses/abc%0A", {"format": "mylearner-course", "id": "abc\n"})[0], 400)
        nan = b'{"format":"mylearner-course","id":"nan","x":NaN}'
        self.assertEqual(self.req("PUT", "/api/courses/nan", nan, headers={"Content-Type": "application/json"})[0], 400)
        self.assertEqual(json.loads(self.req("GET", "/api/courses")[2]), {"courses": []})
        self.assertEqual(self.req("GET", "/api/health")[0], 200, "서버는 산다")

    def test_socket_timeout_and_small_drain(self):   # 독립 점검 V5
        self.assertEqual(SV.make_handler(self.state).timeout, SV.SOCKET_TIMEOUT)
        st, _, _ = self.req("POST", "/api/log", b"x" * 10, cookie=False, host="evil.example:1",
                            headers={"Content-Type": "application/json", "Content-Length": str(10)})
        self.assertEqual(st, 400)
        s = socket.create_connection(("127.0.0.1", self.port), timeout=10)
        s.sendall(("POST /api/log HTTP/1.1\r\nHost: evil.example\r\nContent-Length: 33000000\r\n\r\nabc").encode())
        s.settimeout(5)
        self.assertTrue(s.recv(100).startswith(b"HTTP/1.0 400"), "큰 본문을 다 읽지 않고 바로 답한다")
        s.close()

    def test_concurrent_posts_union(self):
        def post(k):
            for i in range(10):
                self.req("POST", "/api/log", {"lines": ["t%d-%d" % (k, i), "same"]})
        ts = [threading.Thread(target=post, args=(k,)) for k in range(4)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        lines = self.data.log_text().splitlines()[1:]
        self.assertEqual(len(lines), 41)
        self.assertEqual(len(set(lines)), 41)


class CliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ml-cli-"))
        (self.tmp / "web").mkdir()
        (self.tmp / "web" / "index.html").write_text("x", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_main(self, argv, run=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = CLI.main(argv, run=run)
        return code, out.getvalue()

    def test_version_and_help(self):
        self.assertEqual(self.run_main(["version"])[0], 0)
        self.assertEqual(self.run_main([])[0], 2)

    def test_serve_prints_url_and_answers(self):
        port = free_port()
        seen = {}

        def run(srv):
            th = threading.Thread(target=srv.serve_forever, daemon=True)
            th.start()
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            c.request("GET", "/api/health", headers={"Host": "127.0.0.1:%d" % port})
            seen["status"] = c.getresponse().status
            c.close()
            srv.shutdown()

        cfg = self.tmp / "ed.json"
        cfg.write_text(json.dumps({"edition": "closed", "label": "폐쇄망판", "server": {"port": port}}), encoding="utf-8")
        code, out = self.run_main(["serve", "--no-browser", "--web", str(self.tmp / "web"), "--data", str(self.tmp / "data"), "--config", str(cfg)], run=run)
        self.assertEqual(code, 0)
        self.assertEqual(seen["status"], 401, "토큰 없이는 401")
        tok = (self.tmp / "data" / "token").read_text(encoding="utf-8").strip()
        self.assertIn("http://127.0.0.1:%d/?token=%s" % (port, tok), out)
        out.encode("cp949")   # 한국어 Windows 콘솔에서 깨지지 않는다(NFR-304)

    def test_serve_errors(self):
        self.assertEqual(self.run_main(["serve", "--no-browser", "--port", "0", "--web", str(self.tmp / "web"), "--data", str(self.tmp / "d")])[0], 2)
        self.assertEqual(self.run_main(["serve", "--no-browser", "--web", str(self.tmp / "nope"), "--data", str(self.tmp / "d")])[0], 2)
        with self.assertRaises(SystemExit):
            self.run_main(["serve", "--config", str(self.tmp / "missing.json")])
        bad = self.tmp / "bad.json"
        bad.write_text("[1]", encoding="utf-8")
        with self.assertRaises(SystemExit):
            self.run_main(["serve", "--config", str(bad)])
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            busy = s.getsockname()[1]
            s.listen(1)
            code, out = self.run_main(["serve", "--no-browser", "--port", str(busy), "--web", str(self.tmp / "web"), "--data", str(self.tmp / "d")])
            self.assertEqual(code, 1)
            self.assertIn("포트", out)

    def test_browser_gets_once_url_not_token(self):   # 독립 점검 V2
        port = free_port()
        opened = []
        real = CLI.webbrowser.open
        CLI.webbrowser.open = lambda u: opened.append(u)
        try:
            self.run_main(["serve", "--web", str(self.tmp / "web"), "--data", str(self.tmp / "data"), "--port", str(port)], run=lambda srv: None)
        finally:
            CLI.webbrowser.open = real
        tok = (self.tmp / "data" / "token").read_text(encoding="utf-8").strip()
        self.assertEqual(len(opened), 1)
        self.assertIn("/?once=", opened[0])
        self.assertNotIn(tok, opened[0])

    def test_missing_edition_is_closed(self):   # 독립 점검 V1 — fail-closed
        self.assertIs(CLI.DEFAULT_EDITION["export"], False)
        self.assertEqual(CLI.DEFAULT_EDITION["link_hosts"], [])
        old = CLI.HERE
        CLI.HERE = self.tmp / "pkg" / "mylearner"
        try:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                ed = CLI.load_edition(None)
        finally:
            CLI.HERE = old
        self.assertIs(ed["export"], False)
        self.assertIn("내보내기 없는 판", out.getvalue())

    def test_default_edition_from_repo(self):
        ed = CLI.load_edition(None)
        self.assertIn(ed["edition"], ("internet", "closed", "dev"))


if __name__ == "__main__":
    unittest.main()
