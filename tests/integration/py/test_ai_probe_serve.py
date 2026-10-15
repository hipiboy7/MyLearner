"""ai_probe.py --serve-test — 127.0.0.1 시험 서버 (등급 B).

대응: docs/P1_요구사항정의서_Probe.md FR-150 / docs/P1_설계서_Probe.md 3.4절
"""
import http.client
import json
import os
import shutil
import socket
import tempfile
import threading
import time
import unittest
from unittest import mock

from tests.integration.py.test_ai_probe_flow import FakeIO
from tests.support import load_ai_probe

P = load_ai_probe()
HTML = "<!doctype html><html lang=\"ko\"><title>점검</title></html>".encode("utf-8")


class ProbeServerTest(unittest.TestCase):
    def setUp(self):
        self.token = "tok-ABCdef123"
        self.results = []
        self.fio = FakeIO()
        self.srv = P.make_probe_server(0, self.token, HTML, self.results, self.fio)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()

    def req(self, method, path, body=None, headers=None, host=None, cookie=True):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Host": host or "127.0.0.1:%d" % self.port}
        if cookie:
            h["Cookie"] = "mlprobe=" + self.token
        h.update(headers or {})
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        out = (r.status, {k.lower(): v for k, v in r.getheaders()}, data)
        c.close()
        return out

    def test_token_sets_cookie_and_redirects(self):
        status, headers, _ = self.req("GET", "/?t=" + self.token, cookie=False)
        self.assertEqual(status, 303)
        self.assertEqual(headers["location"], "/probe")
        cookie = headers["set-cookie"]
        for part in ("mlprobe=" + self.token, "HttpOnly", "SameSite=Strict", "Path=/"):
            self.assertIn(part, cookie)

    def test_bad_or_missing_token(self):
        for path in ("/?t=wrong", "/"):
            status, headers, body = self.req("GET", path, cookie=False)
            self.assertEqual(status, 403)
            self.assertIn("토큰이 맞지 않습니다", body.decode("utf-8"))

    def test_page_has_csp_and_no_store(self):
        status, headers, body = self.req("GET", "/probe", cookie=False)
        self.assertEqual((status, body), (200, HTML))
        self.assertIn("default-src 'none'", headers["content-security-policy"])
        self.assertEqual(headers["cache-control"], "no-store")
        self.assertEqual(headers["x-content-type-options"], "nosniff")

    def test_ping_needs_cookie(self):
        self.assertEqual(self.req("GET", "/probe/ping", cookie=False)[0], 403)
        self.assertEqual(self.req("GET", "/probe/ping", headers={"Cookie": "mlprobe=wrong"}, cookie=False)[0], 403)
        self.assertEqual(self.req("GET", "/probe/ping", headers={"Cookie": "bad\x7fcookie=\"x"}, cookie=False)[0], 403)
        status, _, body = self.req("GET", "/probe/ping")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])

    def test_host_header_checked(self):
        self.assertEqual(self.req("GET", "/probe", host="evil.example:%d" % self.port)[0], 403)
        self.assertEqual(self.req("POST", "/probe/echo", body=b"x", host="evil.example")[0], 403)
        self.assertEqual(self.req("GET", "/probe", host="localhost:%d" % self.port)[0], 200)

    def test_echo_sizes_and_limits(self):
        status, _, body = self.req("POST", "/probe/echo", body=b"\0" * (1024 * 1024))
        self.assertEqual((status, json.loads(body)["bytes"]), (200, 1024 * 1024))
        self.assertEqual(self.req("POST", "/probe/echo", body=b"x", cookie=False)[0], 403)
        # 길이가 상한을 넘으면 본문을 읽지 않고 413
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.putrequest("POST", "/probe/echo", skip_host=True)
        c.putheader("Host", "127.0.0.1:%d" % self.port)
        c.putheader("Cookie", "mlprobe=" + self.token)
        c.putheader("Content-Length", str(P.SERVE_BODY_LIMIT + 1))
        c.endheaders()
        self.assertEqual(c.getresponse().status, 413)
        c.close()
        # 길이가 없으면 411, 숫자가 아니면 400
        for value, want in ((None, 411), ("abc", 400)):
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            c.putrequest("POST", "/probe/echo", skip_host=True)
            c.putheader("Host", "127.0.0.1:%d" % self.port)
            c.putheader("Cookie", "mlprobe=" + self.token)
            if value is not None:
                c.putheader("Content-Length", value)
            c.endheaders()
            self.assertEqual(c.getresponse().status, want)
            c.close()

    def test_result_line_printed_and_kept(self):
        line = P.make_line("b", [("v", 1), ("g", "h"), ("z", 0)])
        status, _, _ = self.req("POST", "/probe/result", body=line.encode("utf-8"), headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 200)
        self.assertEqual(self.results, [line])
        self.assertIn("브라우저 결과 코드: " + line, self.fio.text())
        self.assertEqual(self.req("POST", "/probe/result", body=b"not a code")[0], 400)
        self.assertEqual(self.req("POST", "/probe/result", body=b"b x\nb y")[0], 400)
        self.assertEqual(self.req("POST", "/probe/result", body=b"b " + b"x" * P.RESULT_LIMIT)[0], 413)

    def test_unknown_paths(self):
        self.assertEqual(self.req("GET", "/nope")[0], 404)
        self.assertEqual(self.req("POST", "/nope", body=b"x")[0], 404)


class ServePortTest(unittest.TestCase):
    def test_port_in_use_moves_to_next(self):
        busy = socket.socket()
        busy.bind(("127.0.0.1", 0))
        busy.listen(1)
        port = busy.getsockname()[1]
        try:
            srv = P.make_probe_server(port, "t", HTML, [], FakeIO())
            try:
                self.assertNotEqual(srv.server_address[1], port)
                self.assertLessEqual(srv.server_address[1], port + 10)
            finally:
                srv.server_close()
        finally:
            busy.close()


class ServeTestCommandTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="ml-serve-")
        self.html = os.path.join(self.tmp, "browser_probe.html")
        with open(self.html, "wb") as f:
            f.write(HTML)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_serve_test_end_to_end(self):
        fio = FakeIO()
        opened = []

        def visit():
            for _ in range(100):
                urls = [x for x in fio.out if "크롬에서 이 주소를 여세요: " in x]
                if urls:
                    break
                time.sleep(0.02)
            url = urls[0].split(": ", 1)[1]
            hostport, query = url.split("://", 1)[1].split("/", 1)
            host, port = hostport.split(":")
            c = http.client.HTTPConnection(host, int(port), timeout=5)
            c.request("GET", "/" + query)
            r = c.getresponse()
            r.read()
            cookie = r.getheader("Set-Cookie").split(";", 1)[0]
            line = P.make_line("b", [("v", 1), ("z", 0)])
            c.request("POST", "/probe/result", body=line, headers={"Cookie": cookie})
            c.getresponse().read()
            c.close()

        th = threading.Thread(target=visit, daemon=True)
        th.start()
        with mock.patch.object(P.webbrowser, "open", side_effect=lambda url: opened.append(url)):
            rc = P.serve_test(0, fio, open_browser=True, seconds=1.0, html_path=self.html)
        th.join(5)
        self.assertEqual(rc, 0)
        self.assertEqual(len(opened), 1)
        self.assertIn("받은 브라우저 결과 코드:", fio.text())

    def test_no_result_and_browser_failure(self):
        fio = FakeIO()
        with mock.patch.object(P.webbrowser, "open", side_effect=RuntimeError("no browser")):
            rc = P.serve_test(0, fio, open_browser=True, seconds=0.1, html_path=self.html)
        self.assertEqual(rc, 0)
        self.assertIn("브라우저를 열지 못했습니다", fio.text())
        self.assertIn("받지 못했습니다", fio.text())

    def test_wait_for_enter(self):
        fio = FakeIO(answers=[""])
        rc = P.serve_test(0, fio, open_browser=False, seconds=None, html_path=self.html)
        self.assertEqual(rc, 0)
        self.assertTrue(any("엔터" in a for a in fio.asked))

    def test_missing_html(self):
        fio = FakeIO()
        self.assertEqual(P.serve_test(0, fio, open_browser=False, seconds=0.1,
                                      html_path=os.path.join(self.tmp, "none.html")), 2)
        self.assertIn("같은 폴더에 없습니다", fio.text())

    def test_bind_failure(self):
        fio = FakeIO()
        with mock.patch.object(P, "make_probe_server", side_effect=OSError("in use")):
            self.assertEqual(P.serve_test(0, fio, open_browser=False, seconds=0.1, html_path=self.html), 2)
        self.assertIn("띄우지 못했습니다", fio.text())

    def test_run_dispatches_serve_test(self):
        fio = FakeIO()
        with mock.patch.object(P, "serve_test", return_value=0) as st:
            self.assertEqual(P.run(["--serve-test", "--no-browser", "--port", "0", "--serve-seconds", "0.1",
                                    "--no-pause"], io=fio), 0)
        st.assert_called_once()
        self.assertEqual(st.call_args.kwargs["open_browser"], False)


if __name__ == "__main__":
    unittest.main()
