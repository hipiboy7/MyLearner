"""키·주소 유출 막기 — 독립 점검(2026-10-15) 지적을 가짜 서버·프록시로 끝까지 (등급 B).

대응: docs/P1_요구사항정의서_Probe.md FR-112·113·115·120·140·150, NFR-102 / docs/P1_설계서_Probe.md 3.3·3.4·5절 /
      docs/P1_테스트결과서_Probe.md 5.2절(F-01~F-07, O-1~O-4)
"""
import contextlib
import getpass
import io as _io
import os
import warnings
from pathlib import Path
from unittest import mock
import unittest

from tests.integration.py.fakes import CaptureProxy, FakeAI
from tests.integration.py.test_ai_probe_flow import KEY, FakeIO, ProbeRunMixin, by_tag, clean_proxy_env, code_lines
from tests.support import load_ai_probe

P = load_ai_probe()


def keyed(requests):
    return [r for r in requests if "Authorization" in r["headers"]]


class ProxyMixin(ProbeRunMixin):
    def proxy(self, answer="json401"):
        p = CaptureProxy(answer)
        self.fakes.append(p)
        return p

    def via(self, proxy):
        return {"HTTP_PROXY": proxy.url, "http_proxy": proxy.url}


class GatewayPageTest(ProxyMixin, unittest.TestCase):
    """F-01: JSON 이 아닌 401·403 에는 키를 보내지 않는다."""

    def test_text_empty_and_bom_denials_get_no_key(self):
        for mode in ("text403", "empty401", "bompage403", "html403"):
            gw = self.fake(mode)
            _, fio, t = self.probe([gw.base])
            self.assertEqual(t["s1"]["fields"]["e"], "!h", mode)
            self.assertTrue(gw.requests, mode)
            self.assertEqual(keyed(gw.requests), [], mode)

    def test_proxy_text_block_page_gets_no_key(self):
        proxy = self.proxy("text403")
        target = self.fake("vllm", key=KEY)
        _, _, t = self.probe([target.base], env=self.via(proxy))
        self.assertEqual((t["s1"]["fields"]["q"], t["s1"]["fields"]["e"]), ("p", "!h"))
        self.assertTrue(proxy.requests)
        self.assertFalse(proxy.saw_key())
        self.assertEqual(target.requests, [])


class KeyRouteTest(ProxyMixin, unittest.TestCase):
    """F-02·F-04: 키는 필요할 때만, 평문 http 는 프록시를 지나지 않게."""

    def test_no_key_when_server_needs_none(self):
        srv = self.fake("vllm")
        _, _, t = self.probe([srv.base])
        self.assertEqual(t["s1"]["fields"]["a"], "n")
        self.assertIn("s1m1", t)
        self.assertGreater(len(srv.requests), 5)
        self.assertEqual(keyed(srv.requests), [])

    def test_plain_http_via_proxy_switches_to_direct_before_key(self):
        proxy = self.proxy("json401")
        target = self.fake("vllm", key=KEY)
        _, fio, t = self.probe([target.base], env=self.via(proxy))
        s1 = t["s1"]["fields"]
        self.assertEqual((s1["q"], s1["a"]), ("k", "y"))
        self.assertNotIn("e", s1)
        self.assertEqual(t["s1m1"]["fields"]["j"], "y")
        self.assertEqual(len(proxy.requests), 1)          # 키 없는 첫 목록만 프록시로 갔다
        self.assertFalse(proxy.saw_key())
        self.assertTrue(keyed(target.requests))
        self.assertTrue(all(r["headers"]["Authorization"] == "Bearer " + KEY for r in keyed(target.requests)))
        self.assertIn("키는 프록시로 보내지 않습니다", fio.text())

    def test_proxy_only_route_withholds_key(self):
        gone = self.fake("vllm", key=KEY)
        base = gone.base
        gone.close()
        self.fakes.remove(gone)
        proxy = self.proxy("json401")
        _, fio, t = self.probe([base], env=self.via(proxy))
        s1 = t["s1"]["fields"]
        self.assertEqual((s1["a"], s1["e"]), ("y", "!p"))
        self.assertFalse(proxy.saw_key())
        self.assertIn("키를 보내지 않았습니다", fio.text())
        self.assertIn("키를 보내지 않음", fio.text())       # 풀이

    def test_all_proxy_alone_is_direct(self):
        srv = self.fake("vllm", key=KEY)
        proxy = self.proxy("json401")
        _, _, t = self.probe([srv.base], env={"ALL_PROXY": proxy.url, "all_proxy": proxy.url})
        self.assertEqual(t["s1"]["fields"]["q"], "d")
        self.assertEqual(proxy.requests, [])


class InputHardeningTest(ProxyMixin, unittest.TestCase):
    """F-05·F-06·F-07·O-1: 주소·키·인자를 받는 곳."""

    def test_userinfo_address_is_refused_without_echo(self):
        srv = self.fake("vllm")
        _, fio, t = self.probe(["http://svc:Pa55w0rd@127.0.0.1:%d" % srv.port, srv.base])
        self.assertIn("주소를 읽지 못했습니다", fio.text())
        self.assertNotIn("Pa55w0rd", fio.text())
        self.assertNotIn("svc", fio.text())
        self.assertEqual(t["e"]["fields"]["s"], "1")
        self.assertFalse(any("svc" in r["headers"].get("Host", "") for r in srv.requests))

    def test_key_on_command_line_is_refused_without_echo(self):
        err = _io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
            P.run(["--key", "probe-cmdline-secret-123", "--no-pause"], io=FakeIO())
        self.assertEqual(cm.exception.code, 2)
        self.assertIn("인자를 읽지 못했습니다", err.getvalue())
        self.assertNotIn("probe-cmdline-secret-123", err.getvalue())

    def test_key_env_empty_or_unsendable(self):
        srv = self.fake("vllm", key=KEY)
        _, fio, t = self.probe([srv.base], key="")
        self.assertIn("키 환경 변수가 비어 있습니다", fio.text())
        self.assertNotIn("PROBE_TEST_KEY", fio.text())
        self.assertEqual(t["s1"]["fields"]["e"], "!a")
        srv2 = self.fake("vllm", key=KEY)
        _, fio, t = self.probe([srv2.base], key="키\n값")
        self.assertIn("쓸 수 없는 글자", fio.text())
        self.assertEqual(t["s1"]["fields"]["e"], "!a")
        self.assertEqual(keyed(srv2.requests), [])

    def test_interactive_key_is_asked_again(self):
        srv = self.fake("vllm", key=KEY)
        hostport = srv.base.split("://", 1)[1]
        fio = FakeIO(answers=[hostport, "", ""], secret_answers=["키 값", "Bearer " + KEY], interactive=True)
        with clean_proxy_env():
            rc = P.run(["--out-dir", self.tmp, "--max-calls", "12"], io=fio, reg=None, env_proxies={})
        self.assertEqual(rc, 0)
        self.assertIn("다시 적어 주세요", fio.text())
        self.assertTrue(keyed(srv.requests))
        self.assertEqual(keyed(srv.requests)[0]["headers"]["Authorization"], "Bearer " + KEY)
        self.assertNotIn(KEY, fio.text())

    def test_interactive_gives_up_after_three_bad_keys(self):
        srv = self.fake("vllm", key=KEY)
        hostport = srv.base.split("://", 1)[1]
        fio = FakeIO(answers=[hostport, ""], secret_answers=["가", "나", "다"], interactive=True)
        with clean_proxy_env():
            P.run(["--out-dir", self.tmp, "--no-pause"], io=fio, reg=None, env_proxies={})
        self.assertIn("키 없이 잽니다", fio.text())
        self.assertEqual(keyed(srv.requests), [])

    def test_getpass_that_cannot_hide_is_refused(self):
        def echoing_getpass(prompt):
            warnings.warn("Can not control echo on the terminal.", getpass.GetPassWarning)
            return KEY

        out = []
        io = P.IO(ask=lambda p: "", secret=echoing_getpass, out=out.append, interactive=False)
        self.assertEqual(io.secret("키: "), "")
        self.assertIn("키를 가릴 수 없습니다", "\n".join(out))
        io2 = P.IO(ask=lambda p: "", secret=lambda p: KEY, out=out.append, interactive=False)
        self.assertEqual(io2.secret("키: "), KEY)

    def test_missing_cafile(self):
        fio = FakeIO()
        with clean_proxy_env():
            rc = P.run(["--server", "https://localhost:1", "--cafile", os.path.join(self.tmp, "none.pem"),
                        "--no-pause", "--out-dir", self.tmp], io=fio, reg=None, env_proxies={})
        self.assertEqual(rc, 2)
        self.assertIn("인증서 파일(--cafile)을 읽지 못했습니다", fio.text())


class CrashSafetyTest(ProxyMixin, unittest.TestCase):
    """O-1: 이상한 답이나 예상 밖 오류에도 결과 코드는 나온다."""

    def test_bad_location_deep_json_and_huge_numbers(self):
        bad = self.fake("badredirect")
        deep = self.fake("deepjson")
        huge = self.fake("hugeusage")
        rc, fio, t = self.probe([bad.base, deep.base, huge.base])
        self.assertEqual(rc, 0)
        self.assertEqual((t["s1"]["fields"]["d"], t["s1"]["fields"]["e"]), ("o", "!r"))
        self.assertEqual(t["s2"]["fields"]["e"], "!j")
        f = t["s3m1"]["fields"]
        self.assertEqual((f["t"], f["j"]), ("?", "y"))
        self.assertNotIn("예상하지 못한 오류", fio.text())

    def test_unexpected_error_in_server_or_model_keeps_going(self):
        a = self.fake("vllm")
        b = self.fake("vllm")
        real = P.server_kind
        calls = []

        def flaky(*args):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("boom http://host.example:1")
            return real(*args)

        with mock.patch.object(P, "server_kind", side_effect=flaky), \
                mock.patch.object(P, "judge_json", side_effect=RuntimeError("x")):
            rc, fio, t = self.probe([a.base, b.base])
        self.assertEqual(rc, 0)
        self.assertEqual(t["s1"]["fields"]["e"], "!e")
        self.assertNotIn("s1m1", t)
        f = t["s2m1"]["fields"]
        self.assertEqual((f["k"], f["j"], f["o"]), ("n", "!e", "!e"))
        self.assertIn("예상하지 못한 오류(RuntimeError)", fio.text())
        self.assertNotIn("host.example", fio.text())
        self.assertIn("예상하지 못한 오류(화면에 오류 이름만 찍음)", fio.text())   # 풀이


class ReflectionTest(ProxyMixin, unittest.TestCase):
    """F-03·NFR-102: 서버가 주소·키·다른 호스트 이름을 되돌려 줘도 결과 코드·화면·결과 파일에 없다."""

    def test_reflected_names_never_reach_output(self):
        srv = self.fake("vllm", key=KEY, server_header="localhost", version="localhost-1")
        srv.models = ["localhost:%d" % srv.port, "gw-prod-07.corp.example:8443", "198.51.100.40", KEY,
                      "/models/gpt-oss-120b"]
        _, fio, t = self.probe(["http://localhost:%d" % srv.port], extra=["--max-calls", "60"])
        s1 = t["s1"]["fields"]
        self.assertEqual((s1["k"], s1["h"], s1["n"]), ("vllm", "?", "5"))
        names = [t["s1m%d" % i]["name"] for i in range(1, 6) if "s1m%d" % i in t]
        self.assertEqual(names[:4], ["?", "?", "?", "?"])
        self.assertIn("gpt-oss-120b", names)
        files = list(Path(self.tmp).glob("ai_probe_result_*.txt"))
        lines = code_lines(fio)
        for text in (fio.text(), files[0].read_text(encoding="utf-8"), "\n".join(lines)):
            for bad in ("localhost", "corp.example", "198.51.100.40", KEY, KEY[:12].lower(), str(srv.port)):
                self.assertNotIn(bad, text, bad)
        self.assertIn("[S1M1 ?]", fio.text())


class ServeTestHardeningTest(unittest.TestCase):
    """O-2·O-3: 시험 서버는 ASCII 가 아닌 토큰에 멈추지 않고, 콘솔 제어 글자를 찍지 않는다."""

    def setUp(self):
        import http.client
        import threading
        self.http = http.client
        self.token = "tok-ABCdef123"
        self.results, self.fio = [], FakeIO()
        self.srv = P.make_probe_server(0, self.token, b"<html></html>", self.results, self.fio)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()

    def req(self, method, path, body=None, cookie=None):
        c = self.http.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Host": "127.0.0.1:%d" % self.port, "Cookie": cookie or "mlprobe=" + self.token}
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        r.read()
        c.close()
        return r.status

    def test_non_ascii_token_and_cookie(self):
        err = _io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(self.req("GET", "/?t=%C3%A9"), 403)
            self.assertEqual(self.req("GET", "/probe/ping", cookie="mlprobe=é"), 403)
        self.assertEqual(err.getvalue(), "")

    def test_result_with_control_characters(self):
        for body in (b"b v=1 \x1b[2J\x1b[Hfake", b"b v=1 \rfake", "b v=1 한글".encode("utf-8")):
            self.assertEqual(self.req("POST", "/probe/result", body=body), 400, body)
        self.assertEqual(self.results, [])
        line = P.make_line("b", [("v", 1), ("z", 0)])
        self.assertEqual(self.req("POST", "/probe/result", body=line.encode()), 200)
        self.assertEqual(self.results, [line])


if __name__ == "__main__":
    unittest.main()
