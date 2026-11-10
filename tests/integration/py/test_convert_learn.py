"""mylearner/convert/learn.py — 만든 Learn 프로젝트로 규칙 표(docs/P3_설계서_PC.md 3.8절)를 하나씩 (등급 B, FR-350~352)."""
from __future__ import annotations

import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from mylearner.convert import learn as LC

INDEX = """---
title: 데모 학습
project: demo-app
area: internal
kind: repo
confidence: likely
sources:
  - x@1 README.md
updated: 2026-11-09
---

# 데모
"""
PAGE1 = """---
title: 01 개요 — 데모
level: L1
type: chapter
confidence: verified
sources:
  - x@1 a.py
tags: [개요, "데모"]
updated: 2026-11-09
---

# 01 개요

!!! note "명령을 치는 곳"
    루트에서 친다.

    둘째 문단 `[^9]` 은 코드라 그대로.

!!! warning
    조심

본문[^1] 과 [아키텍처](02-arch.md#데이터-흐름), [용어](glossary.md#가), [앵커](#위), [밖](https://example.com/a), [그림 파일](img/a.png), ![그림](img/b.png).

=== "Windows"
    py -3 -m x

```mermaid
graph TD; A-->B
```

```
!!! note "코드 안"
```

[^1]: 각주 글
    이어지는 줄

## 자가진단

??? question "1. 왜?"
    까닭이다. 근거: `a.py`

    둘째 줄
"""
PAGE2 = """---
title: 02 아키텍처
level: L2
confidence: oops
sources: []
updated: 2026-11-09
---

내용 [개요로](../content/01-overview.md)
"""
SUB = """---
title: 04-1 설정
confidence: likely
sources:
  - x@1 b.py
updated: 2026-11-09
---

[위로](../01-overview.md) [목차](index.md)
"""
SUBIDX = """---
title: 04 활용
confidence: likely
sources: []
updated: 2026-11-09
---

목차
"""
GLOSS = """---
title: 용어집
type: reference
confidence: likely
sources: []
updated: 2026-11-09
---

| 용어 | 뜻 | 처음 나오는 곳 |
|---|---|---|
| **가** | 첫 글자 `a` | [01 개요](01-overview.md#x) |
| 나 | [링크](02-arch.md) 뜻 | 없음 |
"""
CARDS = [{"id": "demo-app.01-overview.001", "q": " 질문 ", "a": "답", "hint": "힌트", "tags": ["t"], "source": "01-overview.md#자가진단"},
         {"id": "demo-app.04-usage.001", "q": "q2", "a": "a2", "source": "04-usage/01-config.md#x"}]


class LearnTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ml-learn-"))
        self.proj = self.tmp / "demo-app"
        c = self.proj / "content"
        (c / "04-usage").mkdir(parents=True)
        (c / "cards").mkdir()
        (c / "index.md").write_text(INDEX, encoding="utf-8")
        (c / "01-overview.md").write_text(PAGE1, encoding="utf-8")
        (c / "02-arch.md").write_text(PAGE2, encoding="utf-8")
        (c / "04-usage" / "index.md").write_text(SUBIDX, encoding="utf-8")
        (c / "04-usage" / "01-config.md").write_text(SUB, encoding="utf-8")
        (c / "glossary.md").write_text(GLOSS, encoding="utf-8")
        (c / "notes.md").write_text("---\ntitle: 장 아님\nconfidence: likely\nsources: []\nupdated: 2026-11-09\n---\n", encoding="utf-8")
        (c / "cards" / "all.json").write_text(json.dumps(CARDS, ensure_ascii=False), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_structure(self):
        c = LC.build(self.proj, "demo-app@abc1234")
        self.assertEqual((c["id"], c["title"], c["kind"], c["readonly"], c["origin"]["type"], c["origin"]["ref"]), ("demo-app", "데모 학습", "course", True, "learn", "demo-app@abc1234"))
        self.assertEqual(sorted(c["lessons"]), ["01-overview", "02-arch", "04-usage.01-config", "04-usage.index"])
        units = c["parts"][0]["units"]
        self.assertEqual([u["id"] for u in units], ["01-overview", "02-arch", "04-usage"])
        self.assertEqual(units[2]["lessons"], ["04-usage.index", "04-usage.01-config"], "폴더는 index.md 먼저")
        self.assertEqual(units[2]["title"], "04 활용")
        l1 = c["lessons"]["01-overview"]
        self.assertEqual((l1["level"], l1["confidence"], l1["tags"], l1["sources"]), (1, "verified", ["개요", "데모"], ["x@1 a.py"]))
        self.assertEqual(c["lessons"]["02-arch"]["confidence"], "unverified", "모르는 신뢰도는 unverified")
        self.assertEqual(c["confidence"], "unverified", "과정 신뢰도 = 가장 낮은 것")
        self.assertEqual(c["lessons"]["04-usage.01-config"]["level"], 1, "level 이 없으면 1")
        self.assertTrue(5 <= l1["minutes"] <= 60)
        self.assertEqual(c["cards"]["demo-app.01-overview.001"], {"lesson": "01-overview", "type": "concept", "q": "질문", "a": "답", "hint": "힌트",
                                                                  "tags": ["t"], "difficulty": 1, "source": "01-overview.md#자가진단"})
        self.assertEqual(c["cards"]["demo-app.04-usage.001"]["lesson"], "04-usage.01-config")
        self.assertEqual(c["glossary"][0], {"id": "T-001", "term": "가", "en": "", "short": "첫 글자 `a`", "part": "main", "lesson": "01-overview"})
        self.assertEqual((c["glossary"][1]["short"], c["glossary"][1]["lesson"]), ("링크 뜻", None))

    def test_extension_syntax(self):
        b = LC.build(self.proj, "demo-app@abc1234")["lessons"]["01-overview"]["body"]
        self.assertNotIn("# 01 개요", b.splitlines()[0], "맨 앞 # 제목은 뗀다")
        self.assertIn("> **명령을 치는 곳**\n> 루트에서 친다.\n>\n> 둘째 문단 `[^9]` 은 코드라 그대로.", b)
        self.assertIn("> **주의**\n> 조심", b)
        self.assertIn("본문(주 1) 과 [아키텍처](#/learn/demo-app/02-arch), [용어](#/glossary/demo-app), 앵커, [밖](https://example.com/a), 그림 파일, ![그림](img/b.png).", b)
        self.assertIn("**Windows**\n\npy -3 -m x", b)
        self.assertIn("```mermaid\ngraph TD; A-->B\n```", b)
        self.assertIn('```\n!!! note "코드 안"\n```', b, "펜스 안은 그대로")
        self.assertIn("**1. 왜?**\n\n> 까닭이다. 근거: `a.py`\n>\n> 둘째 줄", b)
        self.assertTrue(b.rstrip().endswith("## 주\n\n1. 각주 글 이어지는 줄"))
        sub = LC.build(self.proj, "demo-app@abc1234")["lessons"]["04-usage.01-config"]["body"]
        self.assertEqual(sub, "[위로](#/learn/demo-app/01-overview) [목차](#/learn/demo-app/04-usage.index)\n")
        self.assertIn("내용 개요로", LC.build(self.proj, "x@1")["lessons"]["02-arch"]["body"], "없는 페이지로 가는 링크는 글로만")

    def test_deterministic_and_cli(self):
        a = LC.dumps(LC.build(self.proj, "demo-app@abc1234"))
        self.assertEqual(a, LC.dumps(LC.build(self.proj, "demo-app@abc1234")))
        out = self.tmp / "o" / "demo.course.json"
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(LC.main([str(self.proj), "--out", str(out), "--ref", "demo-app@abc1234"]), 0)
        self.assertEqual(out.read_text(encoding="utf-8"), a)
        self.assertIn("과정 demo-app: 강의 4 · 카드 2", buf.getvalue())
        buf.getvalue().encode("cp949")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(LC.main([str(self.proj), "--out", str(out), "--ref", "bad/ref"]), 2)
            self.assertEqual(LC.main([str(self.tmp / "nope"), "--out", str(out)]), 1)
        self.assertRegex(LC.build(self.proj)["origin"]["ref"], r"^demo-app@(unknown|[0-9a-f]{7,12})$")

    def test_refusals(self):
        idx = self.proj / "content" / "index.md"
        idx.write_text(INDEX.replace("area: internal", "area: kids"), encoding="utf-8")
        with self.assertRaisesRegex(LC.LearnError, "kids"):
            LC.build(self.proj)
        idx.write_text(INDEX.replace("project: demo-app", "project: Bad_Id"), encoding="utf-8")
        with self.assertRaisesRegex(LC.LearnError, "과정 ID"):
            LC.build(self.proj)
        idx.write_text(INDEX, encoding="utf-8")
        cards = self.proj / "content" / "cards" / "all.json"
        cards.write_text(json.dumps(CARDS + [dict(CARDS[0])]), encoding="utf-8")
        with self.assertRaisesRegex(LC.LearnError, "중복"):
            LC.build(self.proj)
        cards.write_text(json.dumps([{"id": "x.y.001", "q": "q", "a": "a", "source": "99-none.md"}]), encoding="utf-8")
        with self.assertRaisesRegex(LC.LearnError, "source"):
            LC.build(self.proj)
        with self.assertRaisesRegex(LC.LearnError, "index.md"):
            LC.build(self.tmp)

    def test_front_parser(self):
        meta, body = LC.parse_front("---\na: 1\nb:\n  - x\n  - 'y'\nc: [p, q]\n# 주석\n\nd: \"z\"\n---\nbody")
        self.assertEqual(meta, {"a": "1", "b": ["x", "y"], "c": ["p", "q"], "d": "z"})
        self.assertEqual(body, "body")
        self.assertEqual(LC.parse_front("no head"), ({}, "no head"))
        with self.assertRaises(LC.LearnError):
            LC.parse_front("---\n: bad\n---\n")
        with self.assertRaises(LC.LearnError):
            LC.parse_front("---\na: 1\n")
        with self.assertRaises(LC.LearnError):
            LC.lesson_id("a b.md")


if __name__ == "__main__":
    unittest.main()
