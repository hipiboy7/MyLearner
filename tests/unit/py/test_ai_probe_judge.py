"""판정 함수 — 주소 정리·가리기·리다이렉트·프록시·문맥 길이·서버 종류·CORS·답 읽기·잘림·추론·JSON·누출 (등급 A, 시험 먼저).

대응: docs/P1_요구사항정의서_Probe.md FR-112·114·115·120~136, docs/P1_설계서_Probe.md 3.2절
"""
import json
import unittest

from tests.support import load_ai_probe

P = load_ai_probe()


class NormalizeBaseTest(unittest.TestCase):
    def test_forms(self):
        want = ("http://192.0.2.10:8000", "http://192.0.2.10:8000/v1")
        for text in ("http://192.0.2.10:8000", "http://192.0.2.10:8000/", "http://192.0.2.10:8000/v1",
                     "http://192.0.2.10:8000/v1/", "http://192.0.2.10:8000/v1/chat/completions",
                     "  http://192.0.2.10:8000/v1/responses  ", "http://192.0.2.10:8000/v1/models"):
            self.assertEqual(P.normalize_base(text), want, text)

    def test_path_prefix_kept(self):
        self.assertEqual(P.normalize_base("https://gw.example/llm/v1/"),
                         ("https://gw.example/llm", "https://gw.example/llm/v1"))

    def test_upper_case_scheme_and_v1(self):
        self.assertEqual(P.normalize_base("HTTP://gw.example/V1"), ("http://gw.example", "http://gw.example/v1"))

    def test_missing_scheme_is_http(self):
        self.assertEqual(P.normalize_base("192.0.2.10:8000"), ("http://192.0.2.10:8000", "http://192.0.2.10:8000/v1"))

    def test_query_and_fragment_dropped(self):
        self.assertEqual(P.normalize_base("http://gw.example/v1?x=1#y"), ("http://gw.example", "http://gw.example/v1"))

    def test_rejects(self):
        for text in ("", "ftp://gw.example", "http://", "http:// gw.example", "http://gw example"):
            with self.assertRaises(ValueError, msg=text):
                P.normalize_base(text)


class RedactTest(unittest.TestCase):
    def test_secrets_of(self):
        s = P.secrets_of("http://ai-gw.example:8000/v1", "probe-fake-key-123")
        self.assertIn("ai-gw.example", s)
        self.assertIn("ai-gw.example:8000", s)
        self.assertIn(":8000", s)
        self.assertIn("probe-fake-key-123", s)
        self.assertEqual(s, sorted(s, key=len, reverse=True))

    def test_short_key_not_used_as_secret(self):
        self.assertNotIn("ab", P.secrets_of("http://gw.example/v1", "ab"))

    def test_redact_replaces_all_and_ips(self):
        secrets = P.secrets_of("http://AI-GW.example:8000", "probe-fake-key-123")
        text = "fail http://ai-gw.example:8000/v1 key=probe-fake-key-123 via 198.51.100.7 port :8000"
        out = P.redact(text, secrets)
        for bad in ("ai-gw", "8000", "probe-fake-key-123", "198.51.100.7"):
            self.assertNotIn(bad, out)
        self.assertIn("<가림>", out)

    def test_redact_without_secrets_still_hides_ips(self):
        self.assertNotIn("203.0.113.9", P.redact("connect 203.0.113.9 failed", []))


class RedirectTest(unittest.TestCase):
    def test_kinds(self):
        src = "http://gw.example:8000/v1/models"
        self.assertEqual(P.classify_redirect(src, "/v1/models/"), "s")
        self.assertEqual(P.classify_redirect(src, "https://gw.example:8000/v1/models"), "t")
        self.assertEqual(P.classify_redirect(src, "https://gw.example/v1/models"), "t")
        self.assertEqual(P.classify_redirect(src, "http://other.example:8000/v1/models"), "o")
        self.assertEqual(P.classify_redirect(src, "http://gw.example:9000/v1/models"), "o")
        self.assertEqual(P.classify_redirect(src, ""), "s")


class ProxyTest(unittest.TestCase):
    def test_proxy_kind(self):
        self.assertEqual(P.proxy_kind({}, None), "n")
        self.assertEqual(P.proxy_kind({"https": "http://proxy.example:3128"}, None), "e")
        reg = {"enabled": True, "server": "proxy.example:8080", "override": "", "pac": ""}
        self.assertEqual(P.proxy_kind({}, reg), "r")
        self.assertEqual(P.proxy_kind({"http": "http://p.example:1"}, reg), "b")
        self.assertEqual(P.proxy_kind({}, dict(reg, enabled=False)), "n")

    def test_pac_flag(self):
        self.assertEqual(P.pac_flag(None), "n")
        self.assertEqual(P.pac_flag({"pac": "http://pac.example/x.pac"}), "y")
        self.assertEqual(P.pac_flag({"pac": ""}), "n")

    def test_proxy_applies(self):
        proxies = {"http": "http://proxy.example:3128"}
        self.assertTrue(P.proxy_applies("http://gw.example:8000/v1", proxies, lambda host: False))
        self.assertFalse(P.proxy_applies("http://gw.example:8000/v1", proxies, lambda host: host.startswith("gw.")))
        self.assertFalse(P.proxy_applies("https://gw.example/v1", proxies, lambda host: False))
        # ALL_PROXY 는 urllib 가 쓰지 않는다(독립 점검 F-02) - test_ai_probe_keyleak.ProxyAllIgnoredTest


class ContextLengthTest(unittest.TestCase):
    def test_from_model_entry(self):
        self.assertEqual(P.ctx_from_model_entry({"id": "m", "max_model_len": 131072}), 131072)
        self.assertEqual(P.ctx_from_model_entry({"id": "m", "context_length": 32768}), 32768)
        self.assertEqual(P.ctx_from_model_entry({"id": "m", "meta": {"n_ctx_train": 8192}}), 8192)
        self.assertIsNone(P.ctx_from_model_entry({"id": "m", "max_model_len": "big"}))
        self.assertIsNone(P.ctx_from_model_entry({"id": "m", "max_model_len": True}))
        self.assertIsNone(P.ctx_from_model_entry("nope"))

    def test_from_tokenize(self):
        self.assertEqual(P.ctx_from_tokenize({"count": 3, "max_model_len": 4096, "tokens": [1, 2, 3]}), (3, 4096))
        self.assertEqual(P.ctx_from_tokenize({"tokens": [1, 2]}), (2, None))
        self.assertEqual(P.ctx_from_tokenize(None), (None, None))

    def test_from_error_messages(self):
        cases = {
            "This model's maximum context length is 131072 tokens. However, you requested 10000005 tokens": 131072,
            "'max_tokens' or 'max_completion_tokens' is too large: 10000000. This model's maximum context length "
            "is 32768 tokens and your request has 9 input tokens (10000000 > 32768 - 9)": 32768,
            "Input validation error: `inputs` tokens + `max_new_tokens` must be <= 8192. Given: 5": 8192,
            "max_model_len (40960) exceeded": 40960,
            "something else entirely": None,
            "maximum context length is 12 tokens": None,  # 너무 작은 값은 믿지 않는다
        }
        for text, want in cases.items():
            self.assertEqual(P.ctx_from_error(text), want, text)

    def test_from_ollama_show(self):
        d = {"parameters": "stop \"<|im_end|>\"\nnum_ctx                        4096\n",
             "model_info": {"general.architecture": "qwen3", "qwen3.context_length": 40960}}
        self.assertEqual(P.ctx_from_ollama_show(d), (40960, 4096))
        self.assertEqual(P.ctx_from_ollama_show({"model_info": {}}), (None, None))
        self.assertEqual(P.ctx_from_ollama_show(None), (None, None))


class ServerKindTest(unittest.TestCase):
    def test_vllm(self):
        models = {"data": [{"id": "a", "owned_by": "vllm"}]}
        self.assertEqual(P.server_kind(models, {"version": "0.9.2"}, None, "uvicorn"), ("vllm/0.9.2", "uvicorn"))
        self.assertEqual(P.server_kind(models, None, None, None), ("vllm", "-"))

    def test_ollama(self):
        models = {"data": [{"id": "qwen3:8b", "owned_by": "library"}]}
        self.assertEqual(P.server_kind(models, None, {"version": "0.12.3"}, None), ("ollama/0.12.3", "-"))

    def test_other(self):
        self.assertEqual(P.server_kind({"data": []}, {"version": "2.4 rc"}, None, "nginx/1.24.0 (Ubuntu)"),
                         ("v/2.4", "nginx/1.24.0"))   # 판은 숫자 모양만(독립 점검 F-03)
        self.assertEqual(P.server_kind(None, None, None, ""), ("-", "-"))


class CorsTest(unittest.TestCase):
    def test_full(self):
        pre = {"access-control-allow-origin": "null", "access-control-allow-headers": "Authorization, Content-Type",
               "access-control-allow-methods": "POST, GET"}
        self.assertEqual(P.cors_verdict(pre, 204, {}), "y")

    def test_star_headers_do_not_cover_authorization(self):
        pre = {"access-control-allow-origin": "*", "access-control-allow-headers": "*",
               "access-control-allow-methods": "*"}
        self.assertEqual(P.cors_verdict(pre, 200, {}), "p")

    def test_no_cors(self):
        self.assertEqual(P.cors_verdict({}, 405, {}), "n")
        self.assertEqual(P.cors_verdict({"access-control-allow-origin": "http://other.example"}, 200, {}), "n")

    def test_preflight_failed_but_simple_ok(self):
        self.assertEqual(P.cors_verdict(None, 0, {"access-control-allow-origin": "*"}), "p")
        self.assertEqual(P.cors_verdict({}, 404, {"access-control-allow-origin": "*"}), "p")

    def test_unknown(self):
        self.assertEqual(P.cors_verdict(None, 0, None), "?")

    def test_methods_absent_means_post_ok(self):
        pre = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type"}
        self.assertEqual(P.cors_verdict(pre, 200, {}), "y")
        pre["access-control-allow-methods"] = "GET"
        self.assertEqual(P.cors_verdict(pre, 200, {}), "p")


class LongPromptTest(unittest.TestCase):
    def test_deterministic_and_sized(self):
        a = P.make_long_prompt(9000)
        b = P.make_long_prompt(9000)
        self.assertEqual(a, b)
        prompt, start, end = a
        self.assertGreaterEqual(len(prompt), 9000)
        self.assertLessEqual(len(prompt), 9400)
        self.assertTrue(prompt.startswith("시작 표지: " + start))
        self.assertIn("끝 표지: " + end, prompt[-400:])
        for mark in ("제1장", "1.1", "가."):
            self.assertIn(mark, prompt)
        prompt.encode("cp949")

    def test_small_size_still_has_markers(self):
        prompt, start, end = P.make_long_prompt(100)
        self.assertIn(start, prompt)
        self.assertIn(end, prompt)


def chat(content=None, reasoning_content=None, reasoning=None, finish="stop", usage=None):
    msg = {"role": "assistant", "content": content}
    if reasoning_content is not None:
        msg["reasoning_content"] = reasoning_content
    if reasoning is not None:
        msg["reasoning"] = reasoning
    d = {"choices": [{"index": 0, "finish_reason": finish, "message": msg}]}
    if usage is not None:
        d["usage"] = usage
    return d


class ChatPartsTest(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(P.chat_parts(chat("10")), ("10", "", "stop", "n"))

    def test_reasoning_fields(self):
        self.assertEqual(P.chat_parts(chat("10", reasoning_content="생각"))[1:], ("생각", "stop", "c"))
        self.assertEqual(P.chat_parts(chat("10", reasoning="생각"))[1:], ("생각", "stop", "r"))

    def test_content_parts_and_none(self):
        d = chat([{"type": "text", "text": "a"}, {"type": "text", "text": "b"}])
        self.assertEqual(P.chat_parts(d)[0], "ab")
        self.assertEqual(P.chat_parts(chat(None, finish="length"))[0], "")

    def test_bad_shape(self):
        for bad in ({}, {"choices": []}, {"choices": ["x"]}, [], None):
            with self.assertRaises(ValueError):
                P.chat_parts(bad)

    def test_usage(self):
        self.assertEqual(P.usage_of({"usage": {"prompt_tokens": 5, "completion_tokens": 7,
                                               "completion_tokens_details": {"reasoning_tokens": 3}}}),
                         {"input": 5, "output": 7, "reasoning": 3})
        self.assertEqual(P.usage_of({"usage": {"input_tokens": 5, "output_tokens": 7,
                                               "output_tokens_details": {"reasoning_tokens": 2}}}),
                         {"input": 5, "output": 7, "reasoning": 2})
        self.assertEqual(P.usage_of({}), {"input": None, "output": None, "reasoning": None})
        self.assertEqual(P.usage_of({"usage": {"prompt_tokens": True}})["input"], None)


class StatusCodeTest(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(P.status_code(200, ""), "")
        self.assertEqual(P.status_code(401, ""), "!a")
        self.assertEqual(P.status_code(403, ""), "!a")
        self.assertEqual(P.status_code(404, ""), "!n")
        self.assertEqual(P.status_code(400, "This model's maximum context length is 4096 tokens."), "!l")
        self.assertEqual(P.status_code(400, "bad request"), "!4")
        self.assertEqual(P.status_code(413, ""), "!l")
        self.assertEqual(P.status_code(422, ""), "!4")
        self.assertEqual(P.status_code(503, ""), "!5")
        self.assertEqual(P.status_code(302, ""), "!r")
        self.assertEqual(P.status_code(0, ""), "!c")


class JudgeTest(unittest.TestCase):
    def test_cut(self):
        self.assertEqual(P.judge_cut("시작=KIWI-4817, 끝=PLUM-2931", "KIWI-4817", "PLUM-2931"), "n")
        self.assertEqual(P.judge_cut("시작=?, 끝=plum-2931", "KIWI-4817", "PLUM-2931"), "y")
        self.assertEqual(P.judge_cut("시작=kiwi-4817", "KIWI-4817", "PLUM-2931"), "e")
        self.assertEqual(P.judge_cut("모르겠다", "KIWI-4817", "PLUM-2931"), "b")

    def test_reasoning_pair_sources(self):
        lo = {"rt": 40, "rc": 100, "ct": 60}
        hi = {"rt": 910, "rc": 3000, "ct": 950}
        self.assertEqual(P.reasoning_pair(lo, hi), (40, 910, "t"))
        lo2, hi2 = dict(lo, rt=None), dict(hi, rt=None)
        self.assertEqual(P.reasoning_pair(lo2, hi2), (100, 3000, "c"))
        lo3, hi3 = dict(lo2, rc=0), dict(hi2, rc=0)
        self.assertEqual(P.reasoning_pair(lo3, hi3), (60, 950, "o"))
        self.assertEqual(P.reasoning_pair({"rt": None, "rc": 0, "ct": None}, {"rt": None, "rc": 0, "ct": None}),
                         (None, None, "-"))

    def test_judge_reasoning(self):
        self.assertEqual(P.judge_reasoning(40, 910, "t"), "y")
        self.assertEqual(P.judge_reasoning(40, 80, "t"), "n")   # 1.5배는 넘지만 차이가 50 토큰 미만
        self.assertEqual(P.judge_reasoning(300, 400, "t"), "n")  # 차이는 크지만 1.5배 미만
        self.assertEqual(P.judge_reasoning(100, 280, "c"), "n")  # 글자는 200 이상 차이가 나야
        self.assertEqual(P.judge_reasoning(100, 400, "c"), "y")
        self.assertEqual(P.judge_reasoning(0, 0, "t"), "n")
        self.assertEqual(P.judge_reasoning(None, None, "-"), "?")

    def test_reasoning_text(self):
        self.assertEqual(P.reasoning_text(40, 910, "t"), "40/910t")
        self.assertEqual(P.reasoning_text(None, None, "-"), "-")

    def test_metrics_from_chat(self):
        d = chat("10", reasoning_content="가나다", usage={"prompt_tokens": 9, "completion_tokens": 20,
                                                           "completion_tokens_details": {"reasoning_tokens": 15}})
        self.assertEqual(P.metrics_of(d), {"rt": 15, "rc": 3, "ct": 20})

    def test_leak(self):
        self.assertEqual(P.judge_leak("10"), "n")
        self.assertEqual(P.judge_leak("<think>음</think>10"), "t")
        self.assertEqual(P.judge_leak("<|channel|>analysis<|message|>..."), "g")
        self.assertEqual(P.judge_leak("analysis The user asks... assistant final 10"), "g")
        self.assertEqual(P.judge_leak("<think>x</think><|end|>"), "b")
        self.assertEqual(P.combine_leak(["n", "t", "n"]), "t")
        self.assertEqual(P.combine_leak(["g", "t"]), "b")
        self.assertEqual(P.combine_leak([]), "n")

    def test_combine_field(self):
        self.assertEqual(P.combine_field(["n", "r", "c"]), "c")
        self.assertEqual(P.combine_field(["n", "r"]), "r")
        self.assertEqual(P.combine_field([]), "n")

    def test_think_off(self):
        self.assertEqual(P.judge_think_off(False, {"rt": 0, "rc": 0}), "-")
        self.assertEqual(P.judge_think_off(True, {"rt": 0, "rc": 0}), "y")
        self.assertEqual(P.judge_think_off(True, {"rt": None, "rc": 0}), "y")
        self.assertEqual(P.judge_think_off(True, {"rt": 12, "rc": 0}), "n")
        self.assertEqual(P.judge_think_off(True, {"rt": None, "rc": 5}), "n")

    def test_json(self):
        ok = json.dumps({"answer": 7, "unit": "개"}, ensure_ascii=False)
        self.assertEqual(P.judge_json(ok), "y")
        self.assertEqual(P.judge_json("```json\n" + ok + "\n```"), "f")
        self.assertEqual(P.judge_json("```\n" + ok + "```"), "f")
        self.assertEqual(P.judge_json('{"answer": "7", "unit": "개"}'), "s")
        self.assertEqual(P.judge_json('{"answer": true, "unit": "개"}'), "s")
        self.assertEqual(P.judge_json('{"answer": 7}'), "s")
        self.assertEqual(P.judge_json("답은 7개"), "x")
        self.assertEqual(P.judge_json("```json\n{oops\n```"), "x")
        self.assertEqual(P.judge_json("[1, 2]"), "s")

    def test_responses(self):
        good = {"status": "completed", "output": [{"type": "reasoning"},
                                                  {"type": "message", "content": [{"type": "output_text", "text": "5"}]}]}
        self.assertEqual(P.judge_responses(good), "y")
        self.assertEqual(P.judge_responses({"status": "completed", "output": []}), "x")
        self.assertEqual(P.judge_responses({"choices": []}), "x")
        self.assertEqual(P.judge_responses(None), "x")


class BodyTest(unittest.TestCase):
    def test_chat_body(self):
        b = P.chat_body("m", "질문", 64, reasoning_effort="low")
        self.assertEqual(b["model"], "m")
        self.assertEqual(b["messages"], [{"role": "user", "content": "질문"}])
        self.assertEqual(b["max_tokens"], 64)
        self.assertEqual(b["reasoning_effort"], "low")
        self.assertFalse(b["stream"])
        self.assertNotIn("chat_template_kwargs", b)

    def test_json_schema_body(self):
        b = P.chat_body("m", "질문", 64, response_format=P.JSON_SCHEMA_FORMAT)
        self.assertEqual(b["response_format"]["type"], "json_schema")
        schema = b["response_format"]["json_schema"]["schema"]
        self.assertEqual(sorted(schema["required"]), ["answer", "unit"])


class SafeTextTest(unittest.TestCase):
    def test_replaces_non_cp949(self):
        self.assertEqual(P.safe_text("한글 abc"), "한글 abc")
        out = P.safe_text("ok \U0001F600 ✅")
        out.encode("cp949")
        self.assertTrue(out.startswith("ok "))


if __name__ == "__main__":
    unittest.main()
