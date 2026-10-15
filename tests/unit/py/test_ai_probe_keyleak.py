"""키·주소 유출 막기 — 독립 점검(2026-10-15) 지적 F-01~F-07·O-1~O-4 의 판정 함수 (등급 A, 시험 먼저).

대응: docs/P1_요구사항정의서_Probe.md FR-112·115·120·140·142, docs/P1_설계서_Probe.md 3.1·3.2절,
      docs/P1_테스트결과서_Probe.md 5.2절(독립 점검)
"""
import json
import unittest

from tests.support import load_ai_probe

P = load_ai_probe()
KEY = "probe-live-AbCdEfGhIjKlMnOpQrStUvWx"
HOST = "gpu-cluster-prod-01.llm-internal.corp.example"


class AuthChallengeTest(unittest.TestCase):
    """F-01: 키는 API 가 JSON 으로 401·403 을 줄 때만 보낸다."""

    def test_json_object_is_api(self):
        body = json.dumps({"error": "Unauthorized"}).encode()
        self.assertEqual(P.auth_challenge(401, {"content-type": "application/json"}, body), "json")
        self.assertEqual(P.auth_challenge(403, {}, b'  {"detail": "Not authenticated"}\n'), "json")
        self.assertEqual(P.auth_challenge(401, {}, b"\xef\xbb\xbf" + body), "json")   # UTF-8 BOM

    def test_everything_else_is_a_page(self):
        cases = [
            ({"content-type": "text/plain"}, b"RBAC: access denied"),
            ({}, b""),
            ({"www-authenticate": "Negotiate"}, b""),
            ({"content-type": "text/plain"}, b"\xef\xbb\xbf<html><body>blocked</body></html>"),
            ({}, b"\xff\xfe<\x00h\x00t\x00m\x00l\x00>\x00"),                       # UTF-16 BOM
            ({"content-type": "text/html"}, b'{"error": "x"}'),                    # 모양은 JSON 이어도 HTML 이라 한다
            ({"content-type": "application/xml"}, b"<?xml version='1.0'?><e/>"),
            ({"content-type": "text/plain"}, b" " * 64 + b"<html>"),
            ({"content-type": "application/json"}, b'["unauthorized"]'),            # 객체가 아니다
            ({"content-type": "application/json"}, b'"unauthorized"'),
            ({}, b"[" * 100000),                                                    # 깊은 중첩
        ]
        for headers, body in cases:
            self.assertEqual(P.auth_challenge(401, headers, body), "page", (headers, body[:40]))
            self.assertEqual(P.auth_challenge(403, headers, body), "page", (headers, body[:40]))

    def test_other_status_is_not_a_challenge(self):
        for status in (200, 204, 302, 404, 407, 500, 0):
            self.assertEqual(P.auth_challenge(status, {}, b'{"error": "x"}'), "")


class CleanKeyTest(unittest.TestCase):
    """O-1·F-07: 헤더에 실을 수 없는 키는 받지 않는다."""

    def test_trims_and_drops_bearer(self):
        self.assertEqual(P.clean_key("  " + KEY + "\t"), KEY)
        self.assertEqual(P.clean_key("Bearer " + KEY), KEY)
        self.assertEqual(P.clean_key("bearer   " + KEY), KEY)
        self.assertEqual(P.clean_key(""), "")
        self.assertEqual(P.clean_key(None), "")
        self.assertEqual(P.clean_key("   "), "")

    def test_rejects_unsendable(self):
        for bad in ("키값입니다", "abc\ndef", "abc def", "abc\x00def", "x" * 5000, "Bearer 키"):
            self.assertIsNone(P.clean_key(bad), repr(bad))


class NormalizeBaseHardeningTest(unittest.TestCase):
    """F-05·F-06·O-1: 주소에 계정 정보·한글 호스트·너무 긴 칸을 받지 않고, 오류 글에 입력을 되풀이하지 않는다."""

    def test_rejects_userinfo(self):
        for text in ("http://svc:pw@192.0.2.10:8000", "http://user@gw.example/v1", "svc:pw@gw.example:8000"):
            with self.assertRaises(ValueError) as cm:
                P.normalize_base(text)
            self.assertNotIn("pw", str(cm.exception))
            self.assertNotIn("gw.example", str(cm.exception))

    def test_messages_never_echo_input(self):
        for text in ("http://svc:SECRETPW@gpu-host℀.corp.example:8000", "http://[fd00::10",
                     "http://gw.example:99999", "http://gw.example:80a", "http://서버01.example:8000",
                     "http://" + "a" * 64 + ".example"):
            with self.assertRaises(ValueError, msg=text) as cm:
                P.normalize_base(text)
            msg = str(cm.exception)
            for bad in ("SECRETPW", "gpu-host", "fd00", "99999", "80a", "example", "aaaa"):
                self.assertNotIn(bad, msg, (text, msg))

    def test_still_accepts_normal_forms(self):
        self.assertEqual(P.normalize_base("http://[2001:db8::10]:8000/v1"),
                         ("http://[2001:db8::10]:8000", "http://[2001:db8::10]:8000/v1"))
        self.assertEqual(P.normalize_base("https://" + "a" * 63 + ".example/v1")[0], "https://" + "a" * 63 + ".example")


class LeakCheckTest(unittest.TestCase):
    """F-03: 결과 코드로 나가는 자유 글은 잘리거나 글자가 바뀌어도 주소·키를 싣지 않는다."""

    def setUp(self):
        self.sec = P.secrets_of("http://%s:8443" % HOST, KEY)

    def test_truncated_and_normalized_reflections(self):
        # 비밀값의 영문·숫자 8글자가 이어져 보이면 가린다(그보다 짧은 조각은 뜻이 없다고 본다)
        for value in (HOST[:16], HOST[:24], P.model_short(HOST), KEY[:16].lower(), KEY[:24], "bearer_" + KEY[:12],
                      "p_ss_w0rd_key!9"):
            sec = self.sec + P.secrets_of("http://gw.example", "p@ss=w0rd#Key!9")
            self.assertEqual(P.scrub(value, sec), "?", value)

    def test_addresses_without_secrets(self):
        for value in ("198.51.100.40", "0:0:0:0:0:0:0:1", "fd00:1234::10", "::1", "gw-prod-07.corp.example",
                      "gw-prod-07.corp.example_8443", "gpu07.internal", "llm01.localhost"):
            self.assertEqual(P.scrub(value, []), "?", value)

    def test_normal_values_pass(self):
        for value in ("uvicorn", "nginx/1.24.0", "vllm/0.9.2", "gpt-oss-120b", "qwen3_8b", "llama-3.1-8b-instruct",
                      "qwen2.5-coder-32b-instruct", "ollama/0.12.3", "-", None):
            self.assertEqual(P.scrub(value, self.sec), value, value)

    def test_short_or_port_secrets_do_not_wipe_versions(self):
        sec = P.secrets_of("http://gw.example:80", "ab")
        self.assertEqual(P.scrub("vllm/0.8.0", sec), "vllm/0.8.0")


class ModelLabelTest(unittest.TestCase):
    def test_last_segment_and_scrub(self):
        sec = P.secrets_of("http://llm01.example:43497", KEY)
        self.assertEqual(P.model_label("/models/GPT-OSS-120B", sec), "gpt-oss-120b")
        self.assertEqual(P.model_label("qwen3:8b", sec), "qwen3_8b")
        self.assertEqual(P.model_label("http://203.0.113.3:8000/models/x", sec), "x")
        for bad in ("198.51.100.40", "gw-prod-07.corp.example:8443", "fd00:1234::10", KEY, "llm01.example:43497",
                    "LLM01.EXAMPLE"):
            self.assertEqual(P.model_label(bad, sec), "?", bad)

    def test_make_line_keeps_withheld_name(self):
        line = P.make_line("s1m1", [("c", "?")], name="?")
        self.assertTrue(line.startswith("s1m1 ? c=? /"), line)
        self.assertEqual(P.parse_line(line)["name"], "?")


class StrictServerFieldsTest(unittest.TestCase):
    """F-03: Server 헤더와 판은 정해진 모양만 싣는다."""

    def test_server_header(self):
        cases = {"uvicorn": "uvicorn", "nginx/1.24.0 (Ubuntu)": "nginx/1.24.0", "Microsoft-IIS/10.0": "microsoft-iis/10.0",
                 "istio-envoy": "istio-envoy", "Werkzeug/3.0.1 Python/3.12.3": "werkzeug/3.0.1", "": "-", None: "-",
                 "llm01": "?", "lb-01": "?", "gw-prod-07.corp.example": "?", "0:0:0:0:0:0:0:1": "?",
                 "nginx/203.0.113.3": "?", "p@ss=w0rd#Key!9": "?", "x" * 30: "?"}
        for header, want in cases.items():
            self.assertEqual(P.server_kind(None, None, None, header)[1], want, header)

    def test_versions(self):
        models = {"data": [{"id": "a", "owned_by": "vllm"}]}
        cases = {"0.9.2": "vllm/0.9.2", "v0.9.2": "vllm/0.9.2", "0.10.2rc2.dev36+g7a5ce0e": "vllm/0.10.2rc2",
                 "0.6.3.post1": "vllm/0.6.3.post1", "gpu-cluster-prod-01": "vllm", "203.0.113.3": "vllm",
                 "probe-live-AbCdEf": "vllm", "2.4 rc": "vllm/2.4"}
        for ver, want in cases.items():
            self.assertEqual(P.server_kind(models, {"version": ver}, None, None)[0], want, ver)
        self.assertEqual(P.server_kind(None, None, {"version": "0.12.3"}, None)[0], "ollama/0.12.3")
        self.assertEqual(P.server_kind(None, None, {"version": "ollama.corp.example"}, None)[0], "-")


class RobustParsingTest(unittest.TestCase):
    """O-1·O-4: 이상한 답과 줄이 흐름을 깨지 않는다."""

    def test_bad_location_is_other_host(self):
        self.assertEqual(P.classify_redirect("http://gw.example:8000/v1/models", "http://[::1"), "o")

    def test_huge_numbers_are_ignored(self):
        self.assertEqual(P.usage_of({"usage": {"prompt_tokens": 10 ** 400, "completion_tokens": 10 ** 12}}),
                         {"input": None, "output": None, "reasoning": None})
        self.assertIsNone(P.ctx_from_model_entry({"max_model_len": 10 ** 30}))
        self.assertIsNone(P.ctx_from_error("maximum context length is " + "9" * 5000 + " tokens"))
        self.assertEqual(P.ctx_from_ollama_show({"parameters": "num_ctx " + "9" * 5000}), (None, None))

    def test_parse_line_limits(self):
        with self.assertRaises(ValueError):
            P.parse_line("s1m1 m r=" + "9" * 5000 + "/1t /aa")
        with self.assertRaises(ValueError):
            P.parse_line("b " + " ".join("x=y" for _ in range(300)) + " /aa")
        # 풀이가 큰 숫자에서 멈추지 않는다(줄 길이 안의 큰 숫자)
        line = P.make_line("s1m1", [("r", "9" * 30 + "/" + "9" * 30 + "t")], name="m")
        self.assertIn("[S1M1] m", P.render_summary([line]))


class ProxyAllIgnoredTest(unittest.TestCase):
    def test_all_proxy_is_not_used_by_urllib(self):
        self.assertFalse(P.proxy_applies("https://gw.example/v1", {"all": "http://p.example:1"}, lambda h: False))
        self.assertTrue(P.proxy_applies("http://gw.example/v1", {"http": "http://p.example:1", "all": "x"},
                                        lambda h: False))


if __name__ == "__main__":
    unittest.main()
