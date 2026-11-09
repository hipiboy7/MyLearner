"""Phase 2 검증 도구의 음성 시험 — check_core_js.py·import_mwl_fixtures.py --check 가 나쁜 것을 실제로 잡는다(등급 C 도구, FR-201·263)."""
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


CJ = load("check_core_js")
GOOD = "/* MyLearner web/core/x.js — 시험 */\n(function () {\n  function dep(name) { return require('./' + name + '.js'); }\n  'use strict';\n  return 1;\n})();\n"


class CoreJsCheckTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ml-cj-"))
        (self.root / "web" / "core").mkdir(parents=True)
        (self.root / "tests" / "ui").mkdir(parents=True)
        (self.root / "scripts").mkdir()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def put(self, name, text, where="web/core"):
        (self.root / where / name).write_text(text, encoding="utf-8")

    def test_real_tree_is_clean(self):
        n, w, _, problems = CJ.check(ROOT)
        self.assertEqual(problems, [])
        self.assertEqual(n, 15)   # web/core 15개(regex.js — 2026-11-09, checkup.js — Phase 3)
        self.assertGreaterEqual(w, 4)   # web/store·web/app·web/*.js·index.html (Phase 3)

    def test_good_file(self):
        self.put("x.js", GOOD)
        self.assertEqual(CJ.check(self.root)[3], [])

    def test_catches(self):
        self.put("x.js", GOOD.replace("/* MyLearner web/core/x.js", "/* other"))
        self.put("y.js", "/* MyLearner web/core/y.js */\n'use strict';\nfetch('a'); document.body; var u = 'https://evil.example';\nrequire('fs');\n")
        self.put("z.js", "/* MyLearner web/core/z.js */\nvar r = /a\u2028b/;\n")
        self.put("t.js", "var s = '\ue000';\n", where="tests/ui")
        problems = "\n".join(CJ.check(self.root)[3])
        for frag in ("x.js: 머리 주석", "y.js:3: 쓰지 않는 것 'fetch(", "y.js:3: 쓰지 않는 것 'document.", "y.js:3: 쓰지 않는 것 'https://e",
                     "y.js:4: UMD 머리 밖의 require", "z.js: 'use strict' 가 없다", "z.js:2: 보이지 않는 글자 U+2028", "t.js:1: 보이지 않는 글자 U+E000"):
            self.assertIn(frag, problems)

    def test_phase3_groups(self):
        for d in ("web/store", "web/app"):
            (self.root / d).mkdir(parents=True)
        self.put("s.js", "/* MyLearner web/store/s.js */\n'use strict';\nenv.fetch('/api'); fetch('x'); localStorage.x; require('fs');\n", where="web/store")
        self.put("a.js", "/* MyLearner web/app/a.js */\n'use strict';\nel.innerHTML = ''; document.body; fetch('x'); eval('1');\n", where="web/app")
        self.put("b.js", "/* other */\nvar x = 1;\n", where="web/app")
        (self.root / "web" / "index.html").write_text('<html><head></head><body style="x"><script>1</script><script src="a.js"></script>'
                                                       '<a href="https://evil.example">x</a></body></html>', encoding="utf-8")
        problems = "\n".join(CJ.check(self.root)[3])
        for frag in ("s.js:3: 쓰지 않는 것 'fetch(", "s.js:3: 쓰지 않는 것 'localStorage'", "s.js:3: UMD 머리 밖의 require", "a.js:3: 쓰지 않는 것 'fetch(",
                     "a.js:3: 쓰지 않는 것 'eval(", "b.js: 머리 주석", "b.js: 'use strict' 가 없다", "index.html: 인라인 <script>", "index.html: style= 속성",
                     "index.html: 외부 주소", "index.html: CSP 메타가 없다"):
            self.assertIn(frag, problems)
        self.assertNotIn("env.fetch", problems)
        self.assertNotIn("innerHTML", problems)
        self.assertNotIn("document.", problems)

    def test_comments_are_ignored(self):
        self.put("x.js", GOOD + "// fetch( 와 https://x.example 는 주석\n/* innerHTML */\n")
        self.assertEqual(CJ.check(self.root)[3], [])


class FixtureCheckTest(unittest.TestCase):
    def test_check_passes_and_detects_change(self):
        IM = load("import_mwl_fixtures")
        tmp = Path(tempfile.mkdtemp(prefix="ml-fx-"))
        try:
            shutil.copytree(ROOT / "tests" / "fixtures", tmp / "fixtures")   # 저장소는 읽기만 한다(Docker 시험은 읽기 전용으로 붙인다)
            d = str(tmp / "fixtures" / "mwl")
            self.assertEqual(IM.main(["--check", "--dir", d]), 0)
            self.assertEqual(IM.main(["--check", "--dir", d, "--mwl", "/nonexistent"]), 0, "MWL 이 없으면 복사본에서 만든 과정만 견준다")
            target = tmp / "fixtures" / "mwl" / "scheduler_course.json"
            target.write_bytes(target.read_bytes().replace(b'"mwl"', b'"mwx"', 1))
            self.assertEqual(IM.main(["--check", "--dir", d]), 1)
            self.assertEqual(IM.main(["--check", "--dir", d, "--mwl", "/nonexistent"]), 1)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
