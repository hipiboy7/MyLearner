"""등급 B — mylearner/convert/mwl.py 의 읽기·바꾸기(FR-260). MWL 로더 규칙과 오류 모음, 과정 파일 꼴. 2026-10-15."""
import json
import tempfile
import unittest
from pathlib import Path

from mylearner.convert import mwl as M
from tests.support_mwl import make_content, write

ROOT = Path(__file__).resolve().parents[3]


class FrontmatterTest(unittest.TestCase):
    def test_parse(self):
        meta, body = M.parse_frontmatter("---\nid: A1-1\nminutes: 20\ntags: a, b ,\nsources:\n\n---\n본문\n둘")
        self.assertEqual(meta, {"id": "A1-1", "minutes": 20, "tags": ["a", "b"], "sources": []})
        self.assertEqual(body, "본문\n둘")

    def test_errors(self):
        for text in ("id: x", "---\nid x\n---", "---\nId: x\n---", "---\nminutes: 이십\n---", "---\nid: x\n"):
            with self.assertRaises(ValueError, msg=text):
                M.parse_frontmatter(text)

    def test_sections_and_json_block(self):
        secs = M.split_sections("머리\n## 하나\n```\n## 펜스 안\n```\n## 둘\n끝")
        self.assertEqual([t for t, _ in secs], ["", "하나", "둘"])
        self.assertEqual(M.split_sections("## 만\n")[0][0], "만")
        self.assertEqual(M.extract_json_block("x\n```json\n[1, 2]\n```\n"), [1, 2])
        self.assertIsNone(M.extract_json_block("없음"))


class LoadAndConvertTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.content = make_content(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_course_shape(self):
        c = M.to_course(M.load_content(self.content), "MiddlewareLearner@e55b9c0", "h")
        self.assertEqual((c["format"], c["version"], c["min_reader"], c["id"], c["kind"], c["readonly"]), ("mylearner-course", 1, 1, "mwl", "course", True))
        self.assertEqual(c["origin"], {"type": "mwl", "ref": "MiddlewareLearner@e55b9c0", "hash": "h"})
        self.assertEqual([p["id"] for p in c["parts"]], ["A", "B"])
        self.assertEqual(c["parts"][0]["units"][0]["lessons"], ["A1-1", "A1-2"])
        l1 = c["lessons"]["A1-1"]
        self.assertEqual(l1["title"], "첫 — 긴 제목", "강의 파일의 제목")
        self.assertEqual(l1["minutes"], 25, "curriculum 의 분")
        self.assertEqual(l1["tags"], ["was", "overview"])
        self.assertEqual(l1["sources"], ["매뉴얼 1장", "매뉴얼 2장"])
        self.assertIn("`A1-2` 를 먼저 본다", l1["body"])
        self.assertEqual(c["lessons"]["A1-2"]["prereqs"], ["A1-1"])
        self.assertEqual(c["confidence"], "likely")
        self.assertEqual(c["cards"]["A1-1-c01"], {"lesson": "A1-1", "type": "concept", "q": "Q", "a": "A", "hint": "h", "tags": ["t"], "difficulty": 2})
        self.assertEqual(c["cards"]["A1-2-c01"]["difficulty"], 1)
        lab = c["labs"]["LAB-A1-1"]
        self.assertEqual((lab["unit"], lab["lessons"], lab["env"]), ("A1", ["A1-1", "A1-2"], "docker"))
        self.assertEqual([k["id"] for k in lab["checks"]], ["q1", "q2"])
        self.assertEqual(lab["checks"][1]["answer"], "(?i)ms\\d+")
        self.assertEqual(c["drills"]["DR-01"]["parts"], ["A"])
        self.assertNotIn("id", c["drills"]["DR-01"]["steps"]["s1"])
        self.assertEqual(c["quizzes"]["QZ-A1"]["unit"], "A1")
        self.assertEqual([t["id"] for t in c["glossary"]], ["T-001", "T-002"], "용어는 ID 순")
        self.assertEqual(c["glossary"][0]["part"], "A")
        self.assertEqual(c["diagnostic"][0]["id"], "dg-01")
        self.assertEqual(c["default_plan"], "default")
        self.assertEqual(c["plans"]["default"]["weeks"][0]["days"][1], {"day": 2, "lesson": "B1-1", "lab": None})

    def test_dumps_is_deterministic(self):
        b = M.load_content(self.content)
        a = M.dumps(M.to_course(b, "r", M.content_hash(self.content)))
        self.assertEqual(a, M.dumps(M.to_course(M.load_content(self.content), "r", M.content_hash(self.content))))
        self.assertTrue(a.endswith("}\n"))
        self.assertEqual(json.loads(a)["origin"]["hash"], M.content_hash(self.content))
        self.assertEqual(len(M.content_hash(self.content)), 64)

    def test_errors_are_collected(self):
        write(self.content, "lessons/A/A1/A1-9.md", "---\nid: A1-8\ntitle: t\ndomain: A\nmodule: A1\nminutes: 1\nlevel: 1\nconfidence: x\nsources: s\ntags: t\n---\n")
        write(self.content, "lessons/B/B1/A1-7.md", "---\nid: A1-7\ntitle: t\ndomain: A\nmodule: A1\nminutes: 1\nlevel: 1\nconfidence: x\nsources: s\ntags: t\n---\n")
        write(self.content, "lessons/A/A1/A1-6.md", "본문만")
        write(self.content, "cards/C.json", "{not json")
        write(self.content, "cards/D.json", json.dumps({"id": 1}))
        write(self.content, "cards/E.json", json.dumps([{"id": "A1-1-c01", "lesson": "A1-1", "type": "concept", "q": "q", "a": "a"}]))
        write(self.content, "quizzes/QZ-B1.json", json.dumps({"id": "QZ-B9", "module": "B1", "items": []}))
        write(self.content, "drills/DR-02.json", json.dumps({"id": "DR-02"}))
        write(self.content, "glossary/b.json", json.dumps({"x": 1}))
        with self.assertRaises(M.ConvertError) as cm:
            M.load_content(self.content)
        text = "\n".join(cm.exception.errors)
        for frag in ("lessons/A/A1/A1-9.md", "lessons/B/B1/A1-7.md", "lessons/A/A1/A1-6.md", "cards/C.json", "cards/D.json", "카드 ID 중복",
                     "quizzes/QZ-B1.json", "drills/DR-02.json", "glossary/b.json"):
            self.assertIn(frag, text)
        self.assertEqual(len(cm.exception.errors), 9)

    def test_missing_curriculum(self):
        with tempfile.TemporaryDirectory() as t:
            with self.assertRaises(M.ConvertError):
                M.load_content(Path(t))

    def test_golden_fixture_content(self):
        """MWL 골든 벡터의 content(번들 꼴, 본문 없음)도 바꾼다 — tests/fixtures/mwl/scheduler_course.json 과 같다."""
        cases = json.loads((ROOT / "tests" / "fixtures" / "mwl" / "scheduler_cases.json").read_text(encoding="utf-8"))
        text = M.dumps(M.to_course(cases["content"], "MiddlewareLearner@e55b9c0"))
        self.assertEqual(text, (ROOT / "tests" / "fixtures" / "mwl" / "scheduler_course.json").read_text(encoding="utf-8"))
        c = json.loads(text)
        self.assertEqual(c["lessons"]["A1-1"]["body"], "")
        self.assertEqual(c["default_plan"], "default")

    def test_orphan_lesson_and_no_plans(self):
        b = M.load_content(self.content)
        b["lessons"]["Z1-1"] = {"meta": {"title": "고아", "confidence": "verified", "sources": [], "tags": []}, "body": "x"}
        b["plans"] = {"zeta": b["plans"]["sqld"]}
        c = M.to_course(b, "r")
        self.assertEqual(c["lessons"]["Z1-1"]["title"], "고아")
        self.assertEqual(c["default_plan"], "zeta")
        b["plans"] = {}
        self.assertIsNone(M.to_course(b, "r")["default_plan"])
        self.assertEqual(M.to_course({"curriculum": {"domains": []}}, "r")["confidence"], "unverified")


if __name__ == "__main__":
    unittest.main()
