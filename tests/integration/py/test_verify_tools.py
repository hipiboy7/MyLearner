"""검증 도구가 잡아야 할 것을 잡는가 — verify_docs·check_publish_safety·coverage_lite·pack_probe·check_probe_html.

등급 C 도구의 음성 시험(늘 '통과'만 하는 검사기는 쓸모가 없다). 막아야 할 값은 시험 안에서 이어 붙여 만든다 —
이 파일 자체가 공개 전 점검에 걸리지 않게.
대응: docs/P1_요구사항정의서_Probe.md FR-103~106·160, docs/P1_설계서_Probe.md 3.6절
"""
import ast
import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load(name):
    spec = importlib.util.spec_from_file_location("mlscript_" + name, ROOT / "scripts" / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


VD, PS, CL, PK, HC = (load(n) for n in ("verify_docs", "check_publish_safety", "coverage_lite", "pack_probe",
                                         "check_probe_html"))


class TempRoot(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ml-vt-"))
        for d in ("scripts", "docs", "tools"):
            (self.root / d).mkdir()
        (self.root / "scripts" / "real.py").write_text("", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


class VerifyDocsTest(TempRoot):
    def test_catches_links_paths_commands(self):
        self.write("README.md", "\n".join([
            "[깨진 링크](docs/none.md) [바깥](https://example.com) [앵커](#x)",
            "`scripts/missing.py` 와 `python3 scripts/real.py --x`",
            "```bash",
            "bash scripts/gone.sh",
            "python3 tools/nothere.py --decode",
            "python3 scripts/real.py",
            "```",
            "`python3 -m mylearner serve`",
            "MWL `web/app.js` 는 다른 저장소다",
            "`dist/mylearner-probe-v1.tgz` 는 생성물이다",
            "`scripts/real.py#앵커` 는 파일만 본다, `scripts/nofile.py#x` 는 없다",
        ]))
        _, _, v = VD.check(self.root)
        text = "\n".join(v)
        for want in ("LINK: docs/none.md", "PATH: scripts/missing.py", "SCRIPT: scripts/gone.sh",
                     "SCRIPT: tools/nothere.py", "MODULE: mylearner", "PATH: scripts/nofile.py"):
            self.assertIn(want, text)
        for not_want in ("real.py", "web/app.js", "dist/", "example.com"):
            self.assertNotIn(not_want, text)

    def test_planned_paths_and_stale_planned(self):
        self.write("scripts/verify_docs_planned.txt", "# 예정\nscripts/future.py\nscripts/real.py\n")
        self.write("README.md", "`scripts/future.py`\n")
        _, planned, v = VD.check(self.root)
        self.assertEqual(planned, {"scripts/future.py", "scripts/real.py"})
        self.assertEqual(len(v), 1)
        self.assertIn("PLANNED-EXISTS: scripts/real.py", v[0])

    def test_release_scope(self):
        self.write("CLAUDE.md", "`scripts/later.py`\n")
        self.write("docs/P1_체크리스트_X.md", "`scripts/now.py`\n")
        self.assertEqual([x.split(": ", 1)[1] for x in VD.check(self.root)[2]], ["PATH: scripts/now.py"])
        self.assertEqual(len(VD.check(self.root, release=True)[2]), 2)


class PublishSafetyTest(TempRoot):
    def test_scan_text(self):
        ip_bad = ".".join(["10", "20", "30", "40"])
        token = "gh" + "p_" + "A" * 24
        mail = "someone" + "@" + "corp-mail.co.kr"
        text = "\n".join([
            "server " + ip_bad,
            "ok 192.0.2.10 198.51.100.7 203.0.113.9 127.0.0.1 0.0.0.0",
            "skip " + ip_bad + " ip-ok 예시 값",
            "token " + token,
            "mail " + mail,
            "fine noreply@anthropic.com user@example.com git@github.com a@b.example",
            "version 150.0.7871.125 and 3.14.0",
        ])
        found = {(no, kind) for _, no, kind, _ in PS.scan_text("x.md", text)}
        self.assertEqual(found, {(1, "IP"), (4, "GitHub 토큰"), (5, "메일")})

    def test_other_token_kinds(self):
        samples = ["sk-" + "ant-" + "b" * 24, "AKIA" + "C" * 16, "-----BEGIN " + "RSA PRIVATE KEY-----",
                   "eyJ" + "d" * 12 + "." + "e" * 12 + "." + "f" * 8]
        kinds = {kind for _, _, kind, _ in PS.scan_text("x", "\n".join(samples))}
        self.assertEqual(kinds, {"API 키(sk-)", "AWS 키", "개인 키", "JWT"})

    def test_forbidden_files(self):
        self.write("docs/ok.md", "깨끗하다\n")
        files = [".env", "a/secrets/x.txt", "ai_probe_result_20261015_101010.txt", "docs/ok.md", "x.key"]
        found = [rel for rel, _, kind, _ in PS.scan(self.root, files) if kind == "커밋 금지 파일"]
        self.assertEqual(sorted(found), sorted([".env", "a/secrets/x.txt", "ai_probe_result_20261015_101010.txt",
                                                "x.key"]))


class CoverageLiteTest(unittest.TestCase):
    SRC = "\n".join([
        '"""모듈 설명"""',            # 1 docstring
        "import os",                  # 2
        "",                           # 3
        "def judge_a(x):",            # 4
        "    return x",               # 5
        "",                           # 6
        "def flow(y):",               # 7
        "    if y:",                  # 8
        "        return 1",           # 9
        "    return 2  # pragma: no cover",  # 10
        "",                           # 11
        "@staticmethod",              # 12
        "def judge_b():",             # 13
        "    pass",                   # 14
    ]) + "\n"

    def test_executable_lines(self):
        tree = ast.parse(self.SRC)
        self.assertEqual(CL.executable_lines(tree, self.SRC.splitlines()), {2, 4, 5, 7, 8, 9, 13, 14})

    def test_function_and_file_grades(self):
        tree = ast.parse(self.SRC)
        grades = {"A": ["tools/t.py::judge_*"], "B": ["tools/t.py", "mylearner/"]}
        per = CL.line_grades("tools/t.py", tree, grades)
        self.assertEqual({ln for ln, g in per.items() if g == "A"}, {4, 5, 12, 13, 14})
        self.assertEqual(CL.file_grade("tools/t.py", grades), "B")
        self.assertEqual(CL.file_grade("mylearner/server.py", grades), "B")
        self.assertIsNone(CL.file_grade("tools/other.py", grades))
        self.assertEqual(CL.line_grades("tools/other.py", tree, grades), {})


class PackProbeTest(unittest.TestCase):
    def test_reproducible_and_complete(self):
        a, b = PK.build_bytes(), PK.build_bytes()
        self.assertEqual(a, b)
        self.assertEqual(a[:2], b"\x1f\x8b")
        self.assertEqual(PK.problems_of(a), [])

    def test_external_url_detection(self):
        self.assertEqual(PK.external_urls("예: http://192.0.2.10:8000, http://127.0.0.1:8770/?t=x https://localhost/a"), [])
        self.assertEqual(PK.external_urls("load https://cdn.example.com/x.js"), ["https://cdn.example.com"])

    def test_main_writes_bundle(self):
        tmp = tempfile.mkdtemp(prefix="ml-pack-")
        try:
            self.assertEqual(PK.main(["--out", tmp]), 0)
            self.assertTrue((Path(tmp) / (PK.top_name() + ".tgz")).is_file())
            self.assertEqual(PK.main(["--check"]), 0)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class ProbeHtmlTest(TempRoot):
    def test_real_page_is_clean(self):
        self.assertEqual(HC.check(ROOT / "tools" / "browser_probe.html"), [])

    def test_catches_problems(self):
        bad = ("<html><head></head><body><script src=\"https://cdn.example.com/x.js\"></script>"
               "<input id=\"q\"><button>ok</button><button type=\"button\"> </button><img src=\"a.png\">"
               "<script>el.innerHTML = 1; var ORDER = ['v']; var ALPHA = 'abc'; var VERSION = 9;</script></body></html>")
        self.write("tools/bad.html", bad)
        text = "\n".join(HC.check(self.root / "tools" / "bad.html"))
        for want in ('lang="ko"', "charset", "viewport", "module script", "자원을 불러오는 태그", "외부 URL",
                     "라벨 없는 입력", 'type="button"', "글이 없는 단추", "innerHTML", "칸 순서", "ALPHA", "VERSION",
                     "필수 요소가 없다"):
            self.assertIn(want, text)


if __name__ == "__main__":
    unittest.main()
