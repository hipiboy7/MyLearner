"""ai_probe.py 정적 검사 — 3.9 문법·표준 라이브러리만·없어진 모듈 안 씀·cp949 글자·머리 주석 (등급 A).

대응: docs/P1_요구사항정의서_Probe.md FR-110·143, NFR-101·106
"""
import ast
import sys
import unittest

from tests.support import TOOLS

SRC_PATH = TOOLS / "ai_probe.py"
SRC = SRC_PATH.read_text(encoding="utf-8")
TREE = ast.parse(SRC)

# 3.12~3.14 에서 없어진 표준 모듈(PEP 594·632 등) — 폐쇄망 PC 의 Python 3.14 에서 import 가 깨진다
REMOVED = {"distutils", "imp", "asynchat", "asyncore", "smtpd", "cgi", "cgitb", "crypt", "telnetlib", "nntplib",
           "pipes", "audioop", "aifc", "chunk", "imghdr", "mailcap", "msilib", "nis", "ossaudiodev", "sndhdr",
           "spwd", "sunau", "uu", "xdrlib", "lib2to3"}
# 이 도구가 쓰는 표준 모듈(더하면 여기에도 더한다 — 외부 패키지가 끼어드는 것을 막는다)
ALLOWED = {"__future__", "argparse", "datetime", "getpass", "hmac", "http", "json",
           "os", "platform", "re", "secrets", "socket", "ssl", "sys", "threading", "time", "urllib",
           "webbrowser", "winreg", "pathlib"}


def imported_roots():
    out = set()
    for node in ast.walk(TREE):
        if isinstance(node, ast.Import):
            out |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.add(node.module.split(".")[0])
    return out


class StaticTest(unittest.TestCase):
    def test_parses_with_python_39_grammar(self):
        ast.parse(SRC, feature_version=(3, 9))

    def test_no_removed_modules(self):
        self.assertEqual(imported_roots() & REMOVED, set())

    def test_only_allowed_stdlib(self):
        extra = imported_roots() - ALLOWED
        self.assertEqual(extra, set(), "새 import 는 ALLOWED 에 이유와 함께 더한다")

    def test_all_string_literals_encode_in_cp949(self):
        bad = []
        for node in ast.walk(TREE):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                try:
                    node.value.encode("cp949")
                except UnicodeEncodeError as e:
                    bad.append((node.lineno, node.value[e.start:e.end]))
        self.assertEqual(bad, [])

    def test_header_points_to_documents(self):
        doc = ast.get_docstring(TREE) or ""
        self.assertIn("docs/P1_요구사항정의서_Probe.md", doc)
        self.assertIn("docs/P1_설계서_Probe.md", doc)

    def test_no_print_of_key_variable(self):
        # 키는 Client 안에서 Authorization 헤더로만 쓴다 — say/print 인자에 key 이름이 들어가지 않는다
        for node in ast.walk(TREE):
            if isinstance(node, ast.Call) and getattr(node.func, "attr", getattr(node.func, "id", "")) in ("say", "print"):
                names = {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}
                self.assertNotIn("key", names, f"줄 {node.lineno}")

    def test_running_interpreter_is_supported(self):
        self.assertGreaterEqual(sys.version_info[:2], (3, 9))


if __name__ == "__main__":
    unittest.main()
