"""시험 지원 — 작은 MWL content/ 를 임시 폴더에 만든다(MWL 로더 규칙대로). tests/unit/py·integration/py 의 변환기 시험이 쓴다."""
from __future__ import annotations

import json
from pathlib import Path

LESSON = """---
id: {id}
title: {title}
domain: {d}
module: {m}
minutes: 20
level: 2
confidence: {conf}
sources: 매뉴얼 1장, 매뉴얼 2장
tags: was, overview
---

## 결론 먼저

`{ref}` 를 먼저 본다. **굵게**.
"""
LAB = """---
id: LAB-A1-1
title: 실습 하나
tier: L1
domain: A
module: A1
lessons: A1-1, A1-2
minutes: 15
env: docker
---

## 할 일

명령을 친다.

## 점검 문항

```json
[{"id": "q1", "q": "?", "type": "choice", "options": ["a", "b"], "answer": "b", "explain": "e"},
 {"id": "q2", "q": "?", "type": "regex", "answer": "(?i)ms\\\\d+"}]
```
"""


def write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def make_content(root: Path) -> Path:
    c = root / "content"
    write(c, "curriculum.json", json.dumps({"version": 1, "domains": [
        {"id": "A", "code": "JEUS", "title": "JEUS", "summary": "s", "modules": [
            {"id": "A1", "title": "개관", "goal": "g", "lessons": [{"id": "A1-1", "title": "첫(짧은 제목)", "minutes": 25, "prereqs": []},
                                                                 {"id": "A1-2", "title": "둘", "prereqs": ["A1-1"], "tags": ["x"]}]}]},
        {"id": "B", "code": "WEBTOB", "title": "WebtoB", "modules": [{"id": "B1", "title": "개관", "lessons": [{"id": "B1-1", "title": "셋"}]}]}]},
        ensure_ascii=False))
    write(c, "plan.json", json.dumps({"variants": {"default": [{"week": 1, "theme": "테마", "drill": "DR-01",
                                                               "days": [{"day": 1, "lesson": "A1-1", "lab": "LAB-A1-1"}, {"day": 2, "lesson": "B1-1"}]}],
                                                  "sqld": [{"week": 1, "theme": "t", "days": [{"day": 1, "lesson": "B1-1"}]}]}}, ensure_ascii=False))
    write(c, "lessons/A/A1/A1-1.md", LESSON.format(id="A1-1", title="첫 — 긴 제목", d="A", m="A1", conf="verified", ref="A1-2"))
    write(c, "lessons/A/A1/A1-2.md", LESSON.format(id="A1-2", title="둘", d="A", m="A1", conf="likely", ref="B1-1"))
    write(c, "lessons/B/B1/B1-1.md", LESSON.format(id="B1-1", title="셋", d="B", m="B1", conf="verified", ref="A1-1"))
    write(c, "cards/A.json", json.dumps([{"id": "A1-1-c01", "lesson": "A1-1", "type": "concept", "q": "Q", "a": "A", "hint": "h", "tags": ["t"], "difficulty": 2},
                                         {"id": "A1-2-c01", "lesson": "A1-2", "type": "command", "q": "Q2", "a": "A2"}], ensure_ascii=False))
    write(c, "cards/B.json", json.dumps([{"id": "B1-1-c01", "lesson": "B1-1", "type": "concept", "q": "Q3", "a": "A3"}], ensure_ascii=False))
    write(c, "labs/LAB-A1-1.md", LAB)
    write(c, "drills/DR-01.json", json.dumps({"id": "DR-01", "title": "드릴", "domains": ["A"], "difficulty": 1, "minutes": 15, "lessons": ["A1-1"],
                                              "situation": "상황", "start": "s1", "max_score": 10, "debrief": "복기",
                                              "steps": {"s1": {"prompt": "고른다", "options": [{"text": "좋음", "next": None, "score": 10, "feedback": "f"}]}}},
                                             ensure_ascii=False))
    write(c, "quizzes/QZ-A1.json", json.dumps({"id": "QZ-A1", "module": "A1", "items": [
        {"id": "q1", "type": "mcq", "q": "?", "options": ["a", "b"], "answer": "a", "explain": "e", "lesson": "A1-1"}]}, ensure_ascii=False))
    write(c, "glossary.json", json.dumps([{"id": "T-002", "term": "용어2", "en": "t2", "short": "s", "domain": "B", "lesson": None}], ensure_ascii=False))
    write(c, "glossary/a.json", json.dumps([{"id": "T-001", "term": "용어", "en": "t", "short": "s", "domain": "A", "lesson": "A1-1"}], ensure_ascii=False))
    write(c, "diagnostic.json", json.dumps({"items": [{"id": "dg-01", "type": "mcq", "q": "?", "options": ["a", "b"], "answer": "b", "explain": "", "lesson": "B1-1"}]},
                                           ensure_ascii=False))
    return c
