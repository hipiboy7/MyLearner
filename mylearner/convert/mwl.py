"""MWL 미들웨어 과정(content/) → MyLearner 과정 파일 v1 (등급 B — 변환 도구).

입력:  MWL 저장소의 content/ 폴더(curriculum.json·plan.json·lessons/·cards/·labs/·drills/·quizzes/·glossary·diagnostic.json)
출력:  과정 파일 JSON 하나(키 정렬·한 줄 — 같은 입력이면 같은 바이트). 표준 출력에 개수 한 줄
트리거: python3 -m mylearner.convert.mwl --content <content 폴더> --ref <출처> --out <파일>
        (전체 검증의 'MWL 실데이터 대조'·'골든 벡터 복사본' 단계가 부른다. Phase 3 묶음 만들기도 부른다)
문서:  docs/P2_요구사항정의서_Core.md FR-260, docs/P2_설계서_Core.md 3.2·3.9절
옮긴 코드: MWL mwl/content/frontmatter.py(parse_frontmatter·split_sections·extract_json_block)와
          mwl/content/loader.py(읽는 규칙) — MiddlewareLearner@e55b9c0. 모델 검사는 JS course.validate 가 맡는다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from mylearner import constants as K

# ---------------------------------------------------------------- MWL frontmatter.py (e55b9c0) 그대로
LIST_KEYS = {"sources", "tags", "lessons", "prereqs"}
INT_KEYS = {"minutes", "level"}
_KEY_RE = re.compile(r"^[a-z_]+$")
_JSON_BLOCK_RE = re.compile(r"```json\s*\n(.*?)\n\s*```", re.DOTALL)
_LESSON_KEYS = ("id", "title", "domain", "module", "minutes", "level", "confidence", "sources", "tags")
_LAB_KEYS = ("id", "title", "tier", "domain", "module", "lessons", "minutes", "env")
CONFIDENCE_ORDER = ("verified", "likely", "unverified")


class ConvertError(Exception):
    """MWL 내용 오류 모음. errors 는 '경로: 까닭' 글 목록."""

    def __init__(self, errors: List[str]):
        super().__init__("%d개 오류" % len(errors))
        self.errors = errors


def parse_frontmatter(text: str) -> Tuple[Dict[str, Any], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("frontmatter 블록(첫 줄 ---)이 없음")
    meta: Dict[str, Any] = {}
    end: Optional[int] = None
    for i in range(1, len(lines)):
        line = lines[i]
        if line.strip() == "---":
            end = i
            break
        if not line.strip():
            continue
        if ":" not in line:
            raise ValueError("%d행: 'key: value' 형식이 아님" % (i + 1))
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if not _KEY_RE.match(key):
            raise ValueError("%d행: 키 형식 오류 (소문자·밑줄만)" % (i + 1))
        if key in LIST_KEYS:
            meta[key] = [v.strip() for v in value.split(",") if v.strip()]
        elif key in INT_KEYS:
            try:
                meta[key] = int(value)
            except ValueError:
                raise ValueError("%d행: %s는 정수여야 함" % (i + 1, key)) from None
        else:
            meta[key] = value
    if end is None:
        raise ValueError("frontmatter 닫는 --- 가 없음")
    return meta, "\n".join(lines[end + 1:])


def split_sections(body: str) -> List[Tuple[str, str]]:
    sections: List[Tuple[str, List[str]]] = [("", [])]
    in_fence = False
    for line in body.splitlines():
        if line.strip().startswith("```"):
            in_fence = not in_fence
            sections[-1][1].append(line)
            continue
        if not in_fence and line.startswith("## "):
            sections.append((line[3:].strip(), []))
            continue
        sections[-1][1].append(line)
    out = []
    for title, content in sections:
        text = "\n".join(content)
        if title == "" and not text.strip():
            continue
        out.append((title, text))
    return out


def extract_json_block(text: str) -> Any:
    m = _JSON_BLOCK_RE.search(text)
    return json.loads(m.group(1)) if m else None


# ---------------------------------------------------------------- 읽기(MWL loader.py 의 규칙)
def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def content_hash(content_dir: Path) -> str:
    """MWL mwl/content/bundle.py content_hash 와 같은 방법 — 상대 경로·바이트의 SHA-256."""
    h = hashlib.sha256()
    root = Path(content_dir)
    for p in sorted(x for x in root.rglob("*") if x.is_file()):
        h.update(p.relative_to(root).as_posix().encode("utf-8"))
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def load_content(content_dir: Path) -> Dict[str, Any]:
    """MWL content/ → MWL 번들 꼴 사전(강의·실습은 html 대신 마크다운 body). 오류가 있으면 ConvertError."""
    root = Path(content_dir)
    errors: List[str] = []

    def rel(p: Path) -> str:
        return p.relative_to(root).as_posix()

    def safe(path: Path, fn) -> None:
        try:
            fn()
        except (ValueError, TypeError, KeyError, OSError) as e:   # json.JSONDecodeError 는 ValueError
            errors.append("%s: %s: %s" % (rel(path), type(e).__name__, e))

    cur_path = root / "curriculum.json"
    if not cur_path.is_file():
        raise ConvertError(["curriculum.json 없음"])
    out: Dict[str, Any] = {"curriculum": {}, "plans": {}, "lessons": {}, "cards": {}, "labs": {}, "drills": {}, "quizzes": {},
                           "glossary": [], "diagnostic": []}

    def _cur():
        data = _read_json(cur_path)
        domains = []
        for d in data["domains"]:
            modules = []
            for m in d["modules"]:
                lessons = [{"id": l["id"], "title": l["title"], "minutes": l.get("minutes", 20), "level": l.get("level", 1),
                            "prereqs": list(l.get("prereqs", [])), "tags": list(l.get("tags", []))} for l in m["lessons"]]
                modules.append({"id": m["id"], "title": m["title"], "goal": m.get("goal", ""), "lessons": lessons})
            domains.append({"id": d["id"], "code": d["code"], "title": d["title"], "summary": d.get("summary", ""), "modules": modules})
        out["curriculum"] = {"version": int(data.get("version", 1)), "domains": domains}
    safe(cur_path, _cur)

    plan_path = root / "plan.json"
    if plan_path.is_file():
        def _plan():
            for name, weeks in _read_json(plan_path).get("variants", {}).items():
                out["plans"][name] = {"weeks": [{"week": w["week"], "theme": w["theme"], "drill": w.get("drill"),
                                                 "days": [{"day": d["day"], "lesson": d["lesson"], "lab": d.get("lab")} for d in w["days"]]}
                                                for w in weeks]}
        safe(plan_path, _plan)

    for path in sorted(root.glob("lessons/**/*.md")):
        def _lesson(path=path):
            meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
            missing = [k for k in _LESSON_KEYS if k not in meta]
            if missing:
                raise ValueError("강의 frontmatter 키 누락: %s" % missing)
            lid = meta["id"]
            if lid != path.stem:
                raise ValueError("파일명과 frontmatter id 가 다름")
            if path.parent.resolve() != (root / "lessons" / meta["domain"] / meta["module"]).resolve():
                raise ValueError("경로가 lessons/<domain>/<module>/ 이 아님")
            if lid in out["lessons"]:
                raise ValueError("강의 ID 중복: %s" % lid)
            out["lessons"][lid] = {"meta": {k: meta[k] for k in _LESSON_KEYS}, "body": body}
        safe(path, _lesson)

    for path in sorted(root.glob("cards/*.json")):
        def _cards(path=path):
            data = _read_json(path)
            if not isinstance(data, list):
                raise ValueError("카드 파일은 JSON 배열이어야 함")
            for d in data:
                if d["id"] in out["cards"]:
                    raise ValueError("카드 ID 중복: %s" % d["id"])
                out["cards"][d["id"]] = {"id": d["id"], "lesson": d["lesson"], "type": d["type"], "q": d["q"], "a": d["a"],
                                         "hint": d.get("hint", ""), "tags": list(d.get("tags", [])), "difficulty": d.get("difficulty", 1)}
        safe(path, _cards)

    for path in sorted(root.glob("labs/LAB-*.md")):
        def _lab(path=path):
            meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
            missing = [k for k in _LAB_KEYS if k not in meta]
            if missing:
                raise ValueError("실습 frontmatter 키 누락: %s" % missing)
            if meta["id"] != path.stem:
                raise ValueError("파일명과 frontmatter id 가 다름")
            checks: List[Dict[str, Any]] = []
            for title, text in split_sections(body):
                if title == "점검 문항":
                    checks = [{"id": c["id"], "q": c["q"], "type": c["type"], "options": list(c.get("options", [])),
                               "answer": c.get("answer", ""), "explain": c.get("explain", "")} for c in (extract_json_block(text) or [])]
            out["labs"][meta["id"]] = {"meta": {k: meta[k] for k in _LAB_KEYS}, "body": body, "checks": checks}
        safe(path, _lab)

    for path in sorted(root.glob("drills/DR-*.json")):
        def _drill(path=path):
            d = _read_json(path)
            if d["id"] != path.stem:
                raise ValueError("파일명과 id 가 다름")
            out["drills"][d["id"]] = {
                "id": d["id"], "title": d["title"], "domains": list(d["domains"]), "difficulty": int(d["difficulty"]),
                "minutes": int(d["minutes"]), "lessons": list(d.get("lessons", [])), "situation": d["situation"], "start": d["start"],
                "steps": {k: {"id": v.get("id", k), "prompt": v["prompt"],
                              "options": [{"text": o["text"], "next": o.get("next"), "score": int(o.get("score", 0)),
                                           "feedback": o.get("feedback", "")} for o in v["options"]]} for k, v in d["steps"].items()},
                "debrief": d.get("debrief", ""), "max_score": int(d.get("max_score", 0))}
        safe(path, _drill)

    for path in sorted(root.glob("quizzes/QZ-*.json")):
        def _quiz(path=path):
            d = _read_json(path)
            if d["id"] != path.stem:
                raise ValueError("파일명과 id 가 다름")
            out["quizzes"][d["id"]] = {"id": d["id"], "module": d["module"], "items": [_item(i) for i in d["items"]]}
        safe(path, _quiz)

    g_paths = ([root / "glossary.json"] if (root / "glossary.json").is_file() else []) + sorted(root.glob("glossary/*.json"))
    for g_path in g_paths:
        def _gloss(g_path=g_path):
            data = _read_json(g_path)
            if not isinstance(data, list):
                raise ValueError("용어집 파일은 JSON 배열이어야 함")
            out["glossary"].extend({"id": t["id"], "term": t["term"], "en": t.get("en", ""), "short": t.get("short", ""),
                                    "domain": t["domain"], "lesson": t.get("lesson")} for t in data)
        safe(g_path, _gloss)

    d_path = root / "diagnostic.json"
    if d_path.is_file():
        def _diag():
            data = _read_json(d_path)
            out["diagnostic"].extend(_item(i) for i in (data["items"] if isinstance(data, dict) else data))
        safe(d_path, _diag)

    if errors:
        raise ConvertError(errors)
    return out


def _item(i: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": i["id"], "type": i["type"], "q": i["q"], "options": list(i.get("options", [])), "answer": i["answer"],
            "explain": i.get("explain", ""), "lesson": i["lesson"]}


# ---------------------------------------------------------------- MWL 번들 꼴 → 과정 파일
def _meta(entry: Dict[str, Any]) -> Dict[str, Any]:
    return entry.get("meta", entry)


def to_course(b: Dict[str, Any], ref: str, origin_hash: str = "") -> Dict[str, Any]:
    """MWL 번들 꼴(load_content 결과, 또는 MWL 골든 벡터의 content) → 과정 파일 v1 사전."""
    lessons: Dict[str, Any] = {}
    parts = []
    for d in b["curriculum"]["domains"]:
        units = []
        for m in d["modules"]:
            for l in m["lessons"]:
                src = b.get("lessons", {}).get(l["id"], {})
                meta = _meta(src)
                # 강의 파일이 있으면 제목·태그·수준은 그쪽(더 자세하다), 분·선수 강의는 curriculum(MWL 계획이 쓰는 값)
                lessons[l["id"]] = {"title": meta.get("title", l["title"]), "minutes": l.get("minutes", 20),
                                    "level": meta.get("level", l.get("level", 1)), "prereqs": list(l.get("prereqs", [])),
                                    "tags": list(meta.get("tags", l.get("tags", []))),
                                    "confidence": meta.get("confidence", "unverified"), "sources": list(meta.get("sources", [])),
                                    "body": src.get("body", "")}
            units.append({"id": m["id"], "title": m["title"], "goal": m.get("goal", ""), "lessons": [l["id"] for l in m["lessons"]]})
        parts.append({"id": d["id"], "title": d["title"], "code": d.get("code", ""), "summary": d.get("summary", ""), "units": units})
    for lid, src in b.get("lessons", {}).items():   # 목차에 없는 강의도 버리지 않는다(검사가 W-ORPHAN 으로 알린다)
        if lid not in lessons:
            meta = _meta(src)
            lessons[lid] = {"title": meta.get("title", lid), "minutes": meta.get("minutes", 20), "level": meta.get("level", 1),
                            "prereqs": [], "tags": list(meta.get("tags", [])), "confidence": meta.get("confidence", "unverified"),
                            "sources": list(meta.get("sources", [])), "body": src.get("body", "")}
    cards = {cid: {"lesson": c["lesson"], "type": c["type"], "q": c["q"], "a": c["a"], "hint": c.get("hint", ""),
                   "tags": list(c.get("tags", [])), "difficulty": c.get("difficulty", 1)} for cid, c in b.get("cards", {}).items()}
    quizzes = {qid: {"unit": q["module"], "items": [_item(i) for i in q["items"]]} for qid, q in b.get("quizzes", {}).items()}
    labs = {}
    for lab_id, entry in b.get("labs", {}).items():
        m = _meta(entry)
        labs[lab_id] = {"title": m["title"], "tier": m["tier"], "unit": m["module"], "lessons": list(m["lessons"]), "minutes": m["minutes"],
                        "env": m["env"], "body": entry.get("body", ""),
                        "checks": [{"id": c["id"], "q": c["q"], "type": c["type"], "options": list(c.get("options", [])),
                                    "answer": c.get("answer", ""), "explain": c.get("explain", "")} for c in entry.get("checks", [])]}
    drills = {}
    for did, d in b.get("drills", {}).items():
        drills[did] = {"title": d["title"], "parts": list(d["domains"]), "difficulty": d["difficulty"], "minutes": d["minutes"],
                       "lessons": list(d.get("lessons", [])), "situation": d["situation"], "start": d["start"],
                       "steps": {sid: {"prompt": s["prompt"], "options": [{"text": o["text"], "next": o.get("next"), "score": o.get("score", 0),
                                                                          "feedback": o.get("feedback", "")} for o in s["options"]]}
                                 for sid, s in d["steps"].items()},
                       "debrief": d.get("debrief", ""), "max_score": d.get("max_score", 0)}
    glossary = [{"id": t["id"], "term": t["term"], "en": t.get("en", ""), "short": t.get("short", ""), "part": t.get("domain"),
                 "lesson": t.get("lesson")} for t in sorted(b.get("glossary", []), key=lambda t: t["id"])]
    plans = {name: {"weeks": [{"week": w["week"], "theme": w["theme"], "drill": w.get("drill"),
                               "days": [{"day": d["day"], "lesson": d["lesson"], "lab": d.get("lab")} for d in w["days"]]}
                              for w in p["weeks"]]} for name, p in b.get("plans", {}).items()}
    levels = [l["confidence"] for l in lessons.values() if l["confidence"] in CONFIDENCE_ORDER]
    confidence = max(levels, key=CONFIDENCE_ORDER.index) if levels else "unverified"
    default_plan = "default" if "default" in plans else (sorted(plans)[0] if plans else None)
    return {"format": K.COURSE_FORMAT, "version": K.COURSE_VERSION, "min_reader": K.COURSE_MIN_READER,
            "id": K.MWL_COURSE_ID, "title": K.MWL_COURSE_TITLE, "kind": "course", "lang": "ko", "confidence": confidence,
            "readonly": True, "origin": {"type": "mwl", "ref": ref, "hash": origin_hash}, "default_plan": default_plan, "summary": "",
            "parts": parts, "lessons": lessons, "cards": cards, "quizzes": quizzes, "labs": labs, "drills": drills,
            "glossary": glossary, "diagnostic": [_item(i) for i in b.get("diagnostic", [])], "plans": plans}


def dumps(course: Dict[str, Any]) -> str:
    return json.dumps(course, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def summary(course: Dict[str, Any]) -> str:
    n = lambda k: len(course.get(k) or {})  # noqa: E731
    return "과정 %s: 강의 %d · 카드 %d · 실습 %d · 드릴 %d · 퀴즈 %d · 용어 %d · 진단 %d" % (
        course["id"], n("lessons"), n("cards"), n("labs"), n("drills"), n("quizzes"), n("glossary"), n("diagnostic"))


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m mylearner.convert.mwl", allow_abbrev=False,
                                 description="MWL content/ 를 MyLearner 과정 파일로 바꾼다")
    ap.add_argument("--content", required=True, help="MWL 저장소의 content 폴더")
    ap.add_argument("--ref", required=True, help="출처 글(예: MiddlewareLearner@%s)" % K.MWL_COMMIT)
    ap.add_argument("--out", required=True, help="만들 과정 파일")
    args = ap.parse_args(argv)
    if not re.match(K.REF_RE, args.ref):
        print("오류: --ref 는 영문·숫자로 시작하는 영문·숫자·._@- 80자 이내")
        return 2
    content = Path(args.content)
    if not content.is_dir():
        print("오류: content 폴더가 없다")
        return 2
    try:
        bundle = load_content(content)
    except ConvertError as e:
        print("MWL 내용 오류 %d개: 과정 파일을 만들지 않았다" % len(e.errors))
        for line in e.errors[:50]:
            print("  " + line)
        return 1
    text = dumps(to_course(bundle, args.ref, content_hash(content)))
    out = Path(args.out)
    write_atomic(out, text)
    data = text.encode("utf-8")
    print("%s -> %s (%d B, sha256 %s)" % (summary(json.loads(text)), out.name, len(data), hashlib.sha256(data).hexdigest()[:12]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
