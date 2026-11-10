"""scripts/pack_app.py — 판 설정·과정 자료 감싸기·묶음 재현·판별 검사 (등급 B, FR-302·353·354). 문서: docs/P3_설계서_PC.md 3.1·3.9절."""
from __future__ import annotations

import contextlib
import gzip
import io
import json
import shutil
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts import pack_app as PA

COURSE = {"format": "mylearner-course", "version": 1, "min_reader": 1, "id": "demo", "title": "데모\u2028줄", "kind": "course",
          "parts": [], "lessons": {"l1": {"title": "x", "body": "[문서](https://docs.example.com/a) 와 </script>"}}}


class PackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ml-pack-"))
        self.cfile = self.tmp / "demo.course.json"
        self.cfile.write_text(json.dumps(COURSE, ensure_ascii=False), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_editions(self):
        closed, internet = PA.edition("closed"), PA.edition("internet")
        self.assertEqual((closed["export"], closed["link_hosts"], closed["ai_presets"]), (False, [], []))
        self.assertEqual((internet["export"], internet["link_hosts"]), (True, ["*"]))
        self.assertNotIn("_comment", closed)
        self.assertNotEqual(closed["server"]["port"], 8765, "MWL 기본 포트와 다르다(병행)")

    def test_repo_config_js_is_generated_from_internet(self):
        repo = (PA.ROOT / "web" / "config.js").read_text(encoding="utf-8")
        self.assertEqual(repo, PA.config_js(PA.edition("internet")), "web/config.js 는 config/editions/internet.json 으로 만든 것 그대로")

    def test_course_js_escapes_line_separators(self):
        js = PA.course_js(COURSE)
        self.assertNotIn("\u2028", js)
        self.assertIn("\\u2028", js)
        self.assertTrue(js.startswith("/* MyLearner 과정 자료 demo"))
        files = PA.data_files([COURSE])
        man = files["manifest.js"].decode("utf-8")
        self.assertIn('"file":"demo.js"', man)
        self.assertIn('"sha256":"', man)

    def test_load_courses_rejects(self):
        bad = self.tmp / "bad.json"
        bad.write_text('{"format":"x"}', encoding="utf-8")
        with self.assertRaises(SystemExit):
            PA.load_courses([str(bad)])
        with self.assertRaises(SystemExit):
            PA.load_courses([str(self.cfile), str(self.cfile)])

    def test_bundle_reproducible_and_closed_checks(self):
        cs = PA.load_courses([str(self.cfile)])
        files = PA.bundle_files("closed", cs)
        a = PA.tgz_bytes(PA.top_name("closed"), files)
        self.assertEqual(a, PA.tgz_bytes(PA.top_name("closed"), PA.bundle_files("closed", cs)))
        g = gzip.GzipFile(fileobj=io.BytesIO(a))
        g.read(1)
        self.assertEqual(g.mtime, 0, "gzip 머리 시각 없음")
        with tarfile.open(fileobj=io.BytesIO(a), mode="r:gz") as t:
            names = t.getnames()
            for m in t.getmembers():
                self.assertEqual((m.uid, m.gid, m.uname, m.mtime), (0, 0, "", PA.MTIME))
        top = PA.top_name("closed")
        for must in ("README_KO.txt", "MyLearner.cmd", "config.json", "mylearner/__main__.py", "mylearner/server.py", "web/index.html",
                     "web/config.js", "web/data/manifest.js", "web/data/courses/demo.js", "web/app/main.js", "web/store/browser.js", "web/core/checkup.js"):
            self.assertIn("%s/%s" % (top, must), names)
        self.assertFalse(any("/convert" in n for n in names), "변환기는 싣지 않는다")
        self.assertTrue(files["README_KO.txt"].startswith(PA.BOM))
        self.assertIn(b"\r\n", files["MyLearner.cmd"])
        problems, hosts = PA.problems_of("closed", files)
        self.assertEqual(problems, [])
        self.assertEqual(hosts, {"docs.example.com": 1}, "과정 자료 안의 외부 주소는 세기만")
        files2 = dict(files)
        files2["web/app/evil.js"] = b"var u = 'https://evil.example/x';"
        self.assertTrue(any("evil.example" in p for p in PA.problems_of("closed", files2)[0]))
        self.assertEqual(PA.problems_of("internet", files2)[0], [], "인터넷판은 앱 파일 주소를 막지 않는다")

    def test_internet_zip_and_main(self):
        cs = PA.load_courses([str(self.cfile)])
        files = PA.bundle_files("internet", cs)
        z = PA.zip_bytes(PA.top_name("internet"), files)
        self.assertEqual(z, PA.zip_bytes(PA.top_name("internet"), PA.bundle_files("internet", cs)))
        with zipfile.ZipFile(io.BytesIO(z)) as zz:
            self.assertIn("%s/web/index.html" % PA.top_name("internet"), zz.namelist())
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(PA.main(["--check", "--courses", str(self.cfile)]), 0)
            self.assertEqual(PA.main(["--edition", "internet", "--courses", str(self.cfile), "--out", str(self.tmp / "dist")]), 0)
        self.assertIn("두 판 모두 두 번 만들어 같음", out.getvalue())
        self.assertTrue((self.tmp / "dist" / (PA.top_name("internet") + ".tgz")).exists())
        self.assertTrue((self.tmp / "dist" / (PA.top_name("internet") + ".zip")).exists())

    def test_write_web_data_removes_stale(self):
        root = self.tmp / "web"
        (root / "data" / "courses").mkdir(parents=True)
        (root / "data" / "courses" / "old.js").write_text("x", encoding="utf-8")
        PA.write_web_data(PA.load_courses([str(self.cfile)]), root)
        self.assertEqual(sorted(p.name for p in (root / "data" / "courses").iterdir()), ["demo.js"])
        self.assertTrue((root / "config.js").exists())


if __name__ == "__main__":
    unittest.main()
