"""ai_probe.py 점검 흐름 — 가짜 AI 서버로 끝까지 (등급 B).

대응: docs/P1_요구사항정의서_Probe.md FR-111~144, NFR-102 / docs/P1_설계서_Probe.md 3.3절
BRIEF 5.8 의 시험 목록: 리다이렉트로 키가 새지 않음, Allow-Headers: *, 게이트웨이 HTML 200, 401, 시간 초과, 길이 초과 400,
요약에 호스트·포트 없음 — 모두 여기 있다.
"""
import contextlib
import io as _io
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from tests.integration.py.fakes import FakeAI
from tests.support import load_ai_probe

P = load_ai_probe()
KEY = "probe-fake-key-7Q2Z9"


@contextlib.contextmanager
def clean_proxy_env(**extra):
    with mock.patch.dict(os.environ, {}, clear=False):
        for name in list(os.environ):
            if name.lower().endswith("_proxy"):
                del os.environ[name]
        os.environ.update(extra)
        yield


class FakeIO(P.IO):
    def __init__(self, answers=(), secret_answers=(), interactive=False, interrupt_on=None):
        self.out = []
        self.answers, self.secret_answers = list(answers), list(secret_answers)
        self.interrupt_on, self.interrupted = interrupt_on, False
        self.asked = []
        super().__init__(ask=self._ask_fn, secret=self._secret_fn, out=self.out.append, interactive=interactive)

    def _ask_fn(self, prompt):
        self.asked.append(prompt)
        if self.answers:
            a = self.answers.pop(0)
            if isinstance(a, BaseException):
                raise a
            return a
        return ""

    def _secret_fn(self, prompt):
        self.asked.append(prompt)
        return self.secret_answers.pop(0) if self.secret_answers else ""

    def say(self, text=""):
        if self.interrupt_on and not self.interrupted and self.interrupt_on in str(text):
            self.interrupted = True
            raise KeyboardInterrupt
        super().say(text)

    def text(self):
        return "\n".join(self.out)


def code_lines(fio):
    for chunk in fio.out:
        if "=== 결과 코드" in chunk:
            tail = chunk.split("=== 결과 코드", 1)[1].splitlines()[1:]
            return [x for x in tail if x.strip() and x.strip() != "(없음)"]
    return []


def by_tag(lines):
    out = {}
    for line in lines:
        d = P.parse_line(line)
        out[d["tag"]] = d
    return out


class ProbeRunMixin:
    def setUp(self):
        self.fakes = []
        self.tmp = tempfile.mkdtemp(prefix="ml-probe-")

    def tearDown(self):
        for f in self.fakes:
            f.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fake(self, *a, **kw):
        f = FakeAI(*a, **kw)
        self.fakes.append(f)
        return f

    def probe(self, servers, extra=(), fio=None, env=None, key=KEY):
        fio = fio or FakeIO()
        argv = []
        for s in servers:
            argv += ["--server", s]
        argv += ["--key-env", "PROBE_TEST_KEY", "--no-pause", "--out-dir", self.tmp] + list(extra)
        with clean_proxy_env(PROBE_TEST_KEY=key, **(env or {})):
            rc = P.run(argv, io=fio, reg=None, env_proxies={})
        return rc, fio, by_tag(code_lines(fio))


class FullRunTest(ProbeRunMixin, unittest.TestCase):
    def test_vllm_and_ollama_end_to_end(self):
        vllm = self.fake("vllm", key=KEY, models=["openai/gpt-oss-120b", "qwen3-coder-30b-a3b"])
        oll = self.fake("ollama", models=["qwen3:8b"], ctx=40960, num_ctx=4096, version="0.12.3", server_header=None)
        rc, fio, t = self.probe([vllm.base, oll.base + "/v1/chat/completions"])
        self.assertEqual(rc, 0)
        self.assertEqual(sorted(t), ["e", "s1", "s1m1", "s1m2", "s2", "s2m1"])
        self.assertTrue(all(d["ok"] for d in t.values()))
        self.assertEqual(t["e"]["fields"]["s"], "2")
        s1 = t["s1"]["fields"]
        self.assertEqual((s1["k"], s1["h"], s1["n"], s1["m"], s1["a"], s1["x"], s1["q"], s1["l"], s1["d"]),
                         ("vllm/0.9.2", "uvicorn", "2", "2", "y", "n", "d", "h", "n"))
        m1 = t["s1m1"]
        self.assertEqual(m1["name"], "gpt-oss-120b")
        f = m1["fields"]
        self.assertEqual((f["c"], f["k"], f["r"], f["f"], f["h"], f["z"], f["j"], f["o"]),
                         ("131072m", "n", "40/900t", "c", "n", "y", "y", "y"))
        self.assertAlmostEqual(float(f["t"]), 1.6, delta=0.05)
        self.assertTrue(f["d"].isdigit() and f["p"].isdigit())
        s2 = t["s2"]["fields"]
        self.assertEqual((s2["k"], s2["h"], s2["a"]), ("ollama/0.12.3", "-", "n"))
        o = t["s2m1"]["fields"]
        self.assertEqual(t["s2m1"]["name"], "qwen3_8b")
        self.assertEqual((o["c"], o["w"], o["k"], o["r"], o["f"], o["z"], o["j"], o["o"]),
                         ("40960o", "4096", "y", "3/3o", "n", "-", "f", "!n"))
        # 풀이에 판정이 나온다
        self.assertIn("반영됨", fio.text())
        self.assertIn("앞부분이 잘림", fio.text())

    def test_no_host_port_or_key_anywhere(self):
        vllm = self.fake("vllm", key=KEY)
        rc, fio, _ = self.probe([vllm.base])
        self.assertEqual(rc, 0)
        files = list(Path(self.tmp).glob("ai_probe_result_*.txt"))
        self.assertEqual(len(files), 1)
        for text in (fio.text(), files[0].read_text(encoding="utf-8")):
            self.assertNotIn(KEY, text)
            self.assertNotIn("127.0.0.1", text)
            self.assertNotIn(":%d" % vllm.port, text)

    def test_key_sent_only_as_authorization_after_401(self):
        vllm = self.fake("vllm", key=KEY)
        self.probe([vllm.base])
        first = vllm.requests[0]
        self.assertEqual((first["method"], first["path"]), ("GET", "/v1/models"))
        self.assertNotIn("Authorization", first["headers"])
        self.assertEqual(vllm.requests[1]["headers"].get("Authorization"), "Bearer " + KEY)
        for r in vllm.requests:
            body = str(r["body"] or "")
            self.assertNotIn(KEY, body)

    def test_context_from_tokenize_then_error_message(self):
        a = self.fake("vllm", list_ctx=False, ctx=65536)
        b = self.fake("vllm", list_ctx=False, tokenize=False, ctx=32768)
        _, _, t = self.probe([a.base, b.base])
        self.assertEqual(t["s1m1"]["fields"]["c"], "65536t")
        self.assertEqual(t["s2m1"]["fields"]["c"], "32768e")


class GatewayCasesTest(ProbeRunMixin, unittest.TestCase):
    def test_redirect_does_not_follow_or_leak_key(self):
        target = self.fake("vllm", key=KEY)
        redir = self.fake("redirect", redirect_to=target.base)
        rc, fio, t = self.probe([redir.base])
        self.assertEqual(rc, 0)
        self.assertEqual(target.requests, [])
        self.assertEqual(t["s1"]["fields"]["d"], "o")
        self.assertEqual(t["s1"]["fields"]["e"], "!r")
        for r in redir.requests:
            self.assertNotIn("Authorization", r["headers"])

    def test_gateway_html_200(self):
        gw = self.fake("html")
        rc, _, t = self.probe([gw.base])
        self.assertEqual(rc, 0)
        self.assertEqual(t["s1"]["fields"]["e"], "!h")
        self.assertNotIn("s1m1", t)

    def test_401_without_key(self):
        srv = self.fake("vllm", key=KEY)
        _, _, t = self.probe([srv.base], key="")
        self.assertEqual((t["s1"]["fields"]["a"], t["s1"]["fields"]["e"]), ("y", "!a"))

    def test_html_block_page_gets_no_key(self):
        proxy_page = self.fake("html403")
        _, _, t = self.probe([proxy_page.base])
        self.assertEqual(t["s1"]["fields"]["e"], "!h")
        self.assertTrue(proxy_page.requests)
        for r in proxy_page.requests:
            self.assertNotIn("Authorization", r["headers"])

    def test_always_401_even_with_key(self):
        srv = self.fake("auth401")
        _, _, t = self.probe([srv.base])
        self.assertEqual(t["s1"]["fields"]["e"], "!a")

    def test_timeout(self):
        slow = self.fake("vllm", delay=1.5)
        _, _, t = self.probe([slow.base], extra=["--timeout", "0.3"])
        self.assertEqual(t["s1"]["fields"]["e"], "!t")

    def test_length_400(self):
        srv = self.fake("length400")
        _, _, t = self.probe([srv.base])
        f = t["s1m1"]["fields"]
        self.assertEqual((f["k"], f["t"]), ("!l", "!l"))
        self.assertEqual(f["r"], "40/900t")   # 짧은 질문은 그대로 된다

    def test_cors_star_and_full(self):
        star = self.fake("vllm", cors="star")
        full = self.fake("vllm", cors="full")
        _, _, t = self.probe([star.base, full.base])
        self.assertEqual(t["s1"]["fields"]["x"], "p")
        self.assertEqual(t["s2"]["fields"]["x"], "y")

    def test_connection_refused(self):
        srv = self.fake("vllm")
        base = srv.base
        srv.close()
        self.fakes.remove(srv)
        _, _, t = self.probe([base])
        self.assertEqual(t["s1"]["fields"]["e"], "!c")

    def test_call_cap(self):
        srv = self.fake("vllm")
        _, fio, t = self.probe([srv.base], extra=["--max-calls", "6"])
        f = t["s1m1"]["fields"]
        self.assertEqual((f["z"], f["j"], f["o"]), ("!q", "!q", "!q"))
        self.assertIn("호출 상한", fio.text())

    def test_proxy_failure_then_direct(self):
        srv = self.fake("vllm")
        _, fio, t = self.probe([srv.base], env={"HTTP_PROXY": "http://127.0.0.1:9", "http_proxy": "http://127.0.0.1:9"})
        self.assertEqual(t["s1"]["fields"]["q"], "f")
        self.assertIn("프록시 없이 다시", fio.text())

    def test_bad_server_address_is_skipped(self):
        srv = self.fake("vllm")
        _, fio, t = self.probe(["ftp://nowhere.example", srv.base])
        self.assertIn("주소를 읽지 못했습니다", fio.text())
        self.assertIn("s1", t)
        self.assertEqual(t["e"]["fields"]["s"], "1")

    def test_select_models_by_name(self):
        srv = self.fake("vllm", models=["a/one", "b/two"])
        _, _, t = self.probe([srv.base], extra=["--models", "two"])
        self.assertEqual(t["s1"]["fields"]["m"], "1")
        self.assertEqual(t["s1m1"]["name"], "two")


class InteractiveTest(ProbeRunMixin, unittest.TestCase):
    def test_interactive_session_with_pause(self):
        srv = self.fake("vllm", key=KEY, models=["a/one", "b/two"])
        hostport = srv.base.split("://", 1)[1]
        fio = FakeIO(answers=["ftp://x", hostport, "2", "", ""], secret_answers=[KEY], interactive=True)
        with clean_proxy_env():
            rc = P.run(["--out-dir", self.tmp, "--max-calls", "40"], io=fio, reg=None, env_proxies={})
        self.assertEqual(rc, 0)
        text = fio.text()
        self.assertIn("주소를 읽지 못했습니다", text)
        self.assertIn("http:// 를 붙여", text)
        t = by_tag(code_lines(fio))
        self.assertEqual(t["s1"]["fields"]["m"], "1")
        self.assertEqual(t["s1m1"]["name"], "two")
        self.assertTrue(any("엔터를 누르면 창을 닫습니다" in a for a in fio.asked))
        self.assertNotIn(KEY, text)

    def test_choose_models_variants(self):
        entries = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
        fio = FakeIO(answers=["0"], interactive=True)
        self.assertEqual(P.choose_models(entries, None, fio, True, "S1"), [])
        fio = FakeIO(answers=["3, 1, 3, 9, x"], interactive=True)
        self.assertEqual(P.choose_models(entries, None, fio, True, "S1"), [{"id": "c"}, {"id": "a"}])
        fio = FakeIO(answers=["9"], interactive=True)
        self.assertEqual(P.choose_models(entries, None, fio, True, "S1"), entries)
        self.assertEqual(P.choose_models([], None, fio, True, "S1"), [])
        self.assertEqual(P.choose_models(entries, "ALL", fio, False, "S1"), entries)

    def test_ctrl_c_still_summarizes(self):
        srv = self.fake("vllm")
        fio = FakeIO(interrupt_on="추론 강도 high")
        rc, fio, t = self.probe([srv.base], fio=fio)
        self.assertEqual(rc, 130)
        self.assertIn("멈췄습니다", fio.text())
        f = t["s1m1"]["fields"]
        self.assertEqual(f["k"], "n")
        self.assertEqual(f["r"], "!s")

    def test_eof_on_input_ends_cleanly(self):
        fio = FakeIO(answers=[EOFError()], interactive=False)
        with clean_proxy_env():
            rc = P.run(["--out-dir", self.tmp, "--no-pause"], io=fio, reg=None, env_proxies={})
        self.assertEqual(rc, 0)
        self.assertEqual(by_tag(code_lines(fio))["e"]["fields"]["s"], "0")

    def test_unexpected_error_prints_type_and_pauses(self):
        fio = FakeIO(interactive=True)
        with mock.patch.object(P, "cmd_probe", side_effect=RuntimeError("secret http://host.example:1")):
            rc = P.run([], io=fio)
        self.assertEqual(rc, 2)
        self.assertIn("RuntimeError", fio.text())
        self.assertNotIn("host.example", fio.text())
        self.assertTrue(any("엔터" in a for a in fio.asked))

    def test_unwritable_out_dir(self):
        fio = FakeIO()
        self.assertIsNone(P.save_result("x", os.path.join(self.tmp, "missing", "deeper"), fio))
        self.assertIn("결과 파일을 쓰지 못했습니다", fio.text())

    def test_pac_and_insecure_notes(self):
        srv = self.fake("vllm")
        fio = FakeIO()
        with clean_proxy_env():
            P.run(["--server", srv.base, "--no-pause", "--out-dir", self.tmp, "--insecure", "--max-calls", "3"],
                  io=fio, reg={"enabled": True, "server": "p.example:8080", "override": "", "pac": "http://pac.example/p"},
                  env_proxies={})
        text = fio.text()
        self.assertIn("PAC", text)
        self.assertIn("--insecure", text)
        self.assertIn("Windows 레지스트리", text)
        self.assertNotIn("p.example", text)
        self.assertNotIn("pac.example", text)


class DecodeTest(unittest.TestCase):
    def test_decode_good_bad_and_stdin(self):
        good = P.env_line({"py": "3.14.0", "os": "w10.0.26100", "proxy": "n", "pac": "n", "servers": 1})
        fio = FakeIO()
        self.assertEqual(P.run(["--decode", good], io=fio), 0)
        self.assertIn("검사합 맞음", fio.text())
        bad = good[:-1] + ("0" if good[-1] != "0" else "1")
        self.assertEqual(P.run(["--decode", good, bad], io=FakeIO()), 1)
        self.assertEqual(P.run(["--decode"], io=FakeIO(), stdin=_io.StringIO(good + "\n\n")), 0)
        self.assertEqual(P.run(["--decode", "not a code"], io=FakeIO()), 1)
        self.assertEqual(P.run(["--decode"], io=FakeIO(), stdin=_io.StringIO("")), 1)

    def test_main_exits_with_run_code(self):
        good = P.env_line({"py": "3.9.21", "os": "l5.14", "proxy": "n", "pac": "n", "servers": 0})
        with mock.patch.object(sys, "argv", ["ai_probe.py", "--decode", good]), \
                mock.patch("builtins.print"):
            with self.assertRaises(SystemExit) as cm:
                P.main()
        self.assertEqual(cm.exception.code, 0)


class EnvironmentTest(unittest.TestCase):
    def test_registry_reading_with_fake_winreg(self):
        values = {"ProxyEnable": 1, "ProxyServer": "proxy.example:8080", "AutoConfigURL": "http://pac.example/x.pac"}

        class Key:
            pass

        def query(key, name):
            if name not in values:
                raise OSError(name)
            return values[name], 1

        fake = types.SimpleNamespace(HKEY_CURRENT_USER=0, OpenKey=lambda root, path: Key(), QueryValueEx=query,
                                     CloseKey=lambda key: None)
        with mock.patch.dict(sys.modules, {"winreg": fake}):
            reg = P.read_registry_proxy()
        self.assertEqual(reg, {"enabled": True, "server": "proxy.example:8080", "override": "",
                               "pac": "http://pac.example/x.pac"})
        self.assertEqual((P.proxy_kind({}, reg), P.pac_flag(reg)), ("r", "y"))

    def test_registry_missing_key_or_module(self):
        def boom(root, path):
            raise OSError("no key")

        fake = types.SimpleNamespace(HKEY_CURRENT_USER=0, OpenKey=boom)
        with mock.patch.dict(sys.modules, {"winreg": fake}):
            self.assertIsNone(P.read_registry_proxy())
        with mock.patch.dict(sys.modules, {"winreg": None}):
            self.assertIsNone(P.read_registry_proxy())

    def test_os_tag_variants(self):
        with mock.patch.object(sys, "platform", "win32"), mock.patch.object(P.platform, "version", return_value="10.0.26100"):
            self.assertEqual(P.os_tag(), "w10.0.26100")
        with mock.patch.object(sys, "platform", "darwin"), mock.patch.object(P.platform, "mac_ver", return_value=("14.5", "", "")):
            self.assertEqual(P.os_tag(), "m14.5")
        with mock.patch.object(sys, "platform", "sunos5"):
            self.assertEqual(P.os_tag(), "x")
        self.assertTrue(P.os_tag().startswith("l") or sys.platform != "linux")

    def test_probe_env_reads_environment(self):
        with clean_proxy_env(HTTPS_PROXY="http://proxy.example:3128"):
            env = P.probe_env(None, None)
        self.assertEqual(env["proxy"], "e")


@unittest.skipUnless(shutil.which("openssl"), "openssl 이 없다")
class TlsTest(ProbeRunMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.cert, self.keyfile = os.path.join(self.tmp, "cert.pem"), os.path.join(self.tmp, "key.pem")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=localhost",
                        "-addext", "subjectAltName=DNS:localhost", "-keyout", self.keyfile, "-out", self.cert],
                       check=True, capture_output=True)

    def tls_fake(self):
        f = self.fake("vllm")
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(self.cert, self.keyfile)
        f.srv.socket = ctx.wrap_socket(f.srv.socket, server_side=True)
        return "https://localhost:%d" % f.port

    def test_verify_fails_then_insecure_then_cafile(self):
        url = self.tls_fake()
        _, _, t = self.probe([url], extra=["--max-calls", "4"])
        self.assertEqual((t["s1"]["fields"]["l"], t["s1"]["fields"]["e"]), ("!x", "!x"))
        _, _, t = self.probe([url], extra=["--insecure", "--max-calls", "4"])
        self.assertEqual(t["s1"]["fields"]["l"], "i")
        self.assertNotIn("e", t["s1"]["fields"])
        _, _, t = self.probe([url], extra=["--cafile", self.cert, "--max-calls", "4"])
        self.assertEqual(t["s1"]["fields"]["l"], "s")
        self.assertNotIn("e", t["s1"]["fields"])


if __name__ == "__main__":
    unittest.main()
