"""결과 코드 v1 — 검사합·줄 만들기·줄 읽기·풀이 (등급 A, 시험 먼저).

대응: docs/P1_요구사항정의서_Probe.md FR-140·141·142, docs/P1_설계서_Probe.md 3.1절
"""
import unittest

from tests.support import load_ai_probe

P = load_ai_probe()


class ChecksumTest(unittest.TestCase):
    def test_crc16_ccitt_false_check_value(self):
        self.assertEqual(P.crc16(b"123456789"), 0x29B1)

    def test_checksum_of_check_value(self):
        # 0x29b1 & 0x3ff = 433 -> 13, 17 -> 'd', 'h'
        self.assertEqual(P.checksum("123456789"), "dh")

    def test_checksum_ignores_case_and_spacing(self):
        a = P.checksum("s1 k=vllm/0.9.2  n=2")
        self.assertEqual(a, P.checksum("S1 K=VLLM/0.9.2 N=2"))
        self.assertEqual(a, P.checksum("  s1   k=vllm/0.9.2 n=2 "))

    def test_checksum_changes_with_one_character(self):
        self.assertNotEqual(P.checksum("e v=1 p=3.14.0"), P.checksum("e v=1 p=3.14.1"))

    def test_checksum_alphabet_is_crockford_lowercase(self):
        for text in ("a", "b", "가나다", "e v=1", "s2m3 qwen3-coder c=262144m"):
            cs = P.checksum(text)
            self.assertEqual(len(cs), 2)
            for ch in cs:
                self.assertIn(ch, P.CODE_ALPHABET)
        self.assertEqual(P.CODE_ALPHABET, "0123456789abcdefghjkmnpqrstvwxyz")


class MakeParseLineTest(unittest.TestCase):
    def test_make_line_appends_checksum(self):
        line = P.make_line("e", [("v", 1), ("p", "3.14.0")])
        self.assertTrue(line.startswith("e v=1 p=3.14.0 /"))
        content, cs = line.rsplit(" /", 1)
        self.assertEqual(cs, P.checksum(content))

    def test_make_line_with_name_and_float(self):
        line = P.make_line("s1m2", [("t", 1.625), ("c", "131072m")], name="openai/GPT-OSS-120B")
        self.assertTrue(line.startswith("s1m2 gpt-oss-120b t=1.62 c=131072m /") or
                        line.startswith("s1m2 gpt-oss-120b t=1.63 c=131072m /"))

    def test_make_line_sanitizes_values(self):
        line = P.make_line("s1", [("h", "Apache Coyote/1.1"), ("k", "V/0.1 beta")])
        content = line.rsplit(" /", 1)[0]
        self.assertNotIn(" coyote", content)  # 공백은 값 안에 남지 않는다
        self.assertIn("h=apache_coyote/1.1", content)
        self.assertIn("k=v/0.1_beta", content)

    def test_none_value_becomes_dash(self):
        line = P.make_line("s1", [("k", None)])
        self.assertTrue(line.startswith("s1 k=- /"))

    def test_parse_roundtrip(self):
        line = P.make_line("s1m1", [("c", "131072m"), ("t", 1.5), ("r", "40/910t")], name="gpt-oss-120b")
        d = P.parse_line(line)
        self.assertTrue(d["ok"])
        self.assertEqual(d["tag"], "s1m1")
        self.assertEqual(d["name"], "gpt-oss-120b")
        self.assertEqual(d["fields"]["c"], "131072m")
        self.assertEqual(d["fields"]["t"], "1.50")
        self.assertEqual(d["fields"]["r"], "40/910t")

    def test_parse_accepts_upper_case_and_confusable_checksum_letters(self):
        line = P.make_line("e", [("v", 1), ("s", 2)])
        content, cs = line.rsplit(" /", 1)
        typed = content.upper() + " /" + cs.upper().replace("1", "I").replace("0", "O")
        self.assertTrue(P.parse_line(typed)["ok"])

    def test_parse_detects_typo(self):
        line = P.make_line("e", [("v", 1), ("p", "3.14.0"), ("s", 2)])
        typo = line.replace("p=3.14.0", "p=3.14.6")
        d = P.parse_line(typo)
        self.assertFalse(d["ok"])
        self.assertNotEqual(d["expected"], d["got"])

    def test_parse_rejects_line_without_checksum(self):
        with self.assertRaises(ValueError):
            P.parse_line("e v=1 p=3.14.0")

    def test_parse_rejects_bad_field(self):
        with self.assertRaises(ValueError):
            P.parse_line("e v=1 nonsense /00")

    def test_model_short_name(self):
        self.assertEqual(P.model_short("/models/GPT-OSS-120B"), "gpt-oss-120b")
        self.assertEqual(P.model_short("google/gemma-4-31b"), "gemma-4-31b")
        self.assertEqual(P.model_short("qwen3:8b"), "qwen3_8b")
        self.assertEqual(len(P.model_short("x" * 80)), 32)
        self.assertEqual(P.model_short(""), "-")


class LineBuildersTest(unittest.TestCase):
    def test_env_line(self):
        line = P.env_line({"py": "3.14.0", "os": "w10.0.26100", "proxy": "r", "pac": "n", "servers": 2})
        d = P.parse_line(line)
        self.assertTrue(d["ok"])
        self.assertEqual(list(d["fields"]), ["v", "p", "o", "q", "a", "s"])
        self.assertEqual(d["fields"]["v"], str(P.CODE_VERSION))
        self.assertEqual(d["fields"]["o"], "w10.0.26100")

    def test_server_line_with_and_without_error(self):
        s = {"kind": "vllm/0.9.2", "server": "uvicorn", "n": 2, "m": 2, "auth": "y", "cors": "n",
             "route": "d", "tls": "h", "redir": "n", "error": None}
        d = P.parse_line(P.server_line(1, s))
        self.assertEqual(d["tag"], "s1")
        self.assertEqual(list(d["fields"]), ["k", "h", "n", "m", "a", "x", "q", "l", "d"])
        s["error"] = "!c"
        d = P.parse_line(P.server_line(1, s))
        self.assertEqual(d["fields"]["e"], "!c")

    def test_model_line_optional_window(self):
        m = {"name": "qwen3:8b", "ctx": 40960, "ctx_src": "o", "win": 4096, "cpt": 1.31, "prefill": 900,
             "decode": 22, "cut": "y", "r": "-", "rfield": "n", "leak": "n", "think_off": "-",
             "json": "f", "resp": "!n"}
        d = P.parse_line(P.model_line(2, 1, m))
        self.assertEqual(d["tag"], "s2m1")
        self.assertEqual(d["name"], "qwen3_8b")
        self.assertEqual(d["fields"]["c"], "40960o")
        self.assertEqual(d["fields"]["w"], "4096")
        self.assertEqual(d["fields"]["o"], "!n")
        m["win"] = None
        self.assertNotIn("w", P.parse_line(P.model_line(2, 1, m))["fields"])

    def test_model_line_unknown_context(self):
        m = {"name": "x", "ctx": None, "ctx_src": None, "win": None, "cpt": "!t", "prefill": None,
             "decode": None, "cut": "!t", "r": "!q", "rfield": "n", "leak": "n", "think_off": "!q",
             "json": "!q", "resp": "!q"}
        d = P.parse_line(P.model_line(1, 3, m))
        self.assertEqual(d["fields"]["c"], "?")
        self.assertEqual(d["fields"]["p"], "-")
        self.assertEqual(d["fields"]["t"], "!t")


class ExplainTest(unittest.TestCase):
    def test_explain_model_line_mentions_reasoning_verdict(self):
        m = {"name": "gpt-oss-120b", "ctx": 131072, "ctx_src": "m", "win": None, "cpt": 1.62, "prefill": 2400,
             "decode": 38, "cut": "n", "r": "40/910t", "rfield": "c", "leak": "n", "think_off": "-",
             "json": "y", "resp": "y"}
        text = "\n".join(P.explain(P.parse_line(P.model_line(1, 1, m))))
        self.assertIn("gpt-oss-120b", text)
        self.assertIn("131072", text)
        self.assertIn("반영됨", text)
        self.assertIn("reasoning_content", text)

    def test_reasoning_not_applied(self):
        m = {"name": "gemma", "ctx": 8192, "ctx_src": "e", "win": None, "cpt": 2.1, "prefill": 1000,
             "decode": 40, "cut": "n", "r": "120/130o", "rfield": "n", "leak": "n", "think_off": "-",
             "json": "y", "resp": "!n"}
        text = "\n".join(P.explain(P.parse_line(P.model_line(1, 1, m))))
        self.assertIn("반영 안 됨", text)
        self.assertIn("404", text)

    def test_explain_error_codes(self):
        line = P.server_line(1, {"kind": "-", "server": "-", "n": 0, "m": 0, "auth": "?", "cors": "?",
                                 "route": "f", "tls": "!x", "redir": "o", "error": "!x"})
        text = "\n".join(P.explain(P.parse_line(line)))
        self.assertIn("TLS", text)
        self.assertIn("다른 호스트", text)
        self.assertIn("프록시", text)

    def test_explain_browser_line(self):
        fields = [("v", 1), ("c", "c150"), ("g", "f"), ("l", "10239/5119"), ("o", 0), ("i", "64/3072"),
                  ("e", "y"), ("u", "y"), ("p", "n"), ("s", "y"), ("m", "y120"), ("f", "n"), ("w", "y"),
                  ("k", "e"), ("d", "y"), ("r", "yn"), ("t", "-"), ("a", "b"), ("z", 0)]
        text = "\n".join(P.explain(P.parse_line(P.make_line("b", fields))))
        self.assertIn("Chrome 150", text)
        self.assertIn("file://", text)
        self.assertIn("10239", text)
        self.assertIn("mwl.progress", text)
        self.assertIn("CORS", text)

    def test_explain_marks_bad_checksum(self):
        line = P.make_line("e", [("v", 1), ("s", 1)])
        bad = line[:-2] + ("zz" if not line.endswith("zz") else "yy")
        text = "\n".join(P.explain(P.parse_line(bad)))
        self.assertIn("검사합이 맞지 않습니다", text)

    def test_unknown_field_is_shown_raw(self):
        line = P.make_line("e", [("v", 1), ("y", "new")])
        text = "\n".join(P.explain(P.parse_line(line)))
        self.assertIn("y=new", text)


class SummaryTest(unittest.TestCase):
    def test_render_summary_contains_code_lines(self):
        e = P.env_line({"py": "3.9.21", "os": "l5.14", "proxy": "n", "pac": "n", "servers": 0})
        text = P.render_summary([e])
        self.assertIn(e, text)
        self.assertIn("결과 코드", text)

    def test_render_summary_reports_unreadable_line(self):
        text = P.render_summary(["garbage without checksum"])
        self.assertIn("읽지 못한 줄", text)


if __name__ == "__main__":
    unittest.main()
