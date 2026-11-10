"""Learn 자료(콘텐츠 표준 v0) → MyLearner 과정 파일. CLI: python3 -m mylearner.convert.learn <프로젝트 폴더> --out <파일>

규칙(docs/P3_설계서_PC.md 3.8절):
  content/index.md 머리 → 과정(id = project, area: kids 는 거부 — Learn 경계 규칙 2절)
  장(content/ 바로 아래 NN-이름.md · NN-이름/) → 단원, 페이지 → 강의(ID = 경로에서 .md 를 떼고 / 를 .), 영역은 하나(main)
  content/cards/*.json → 카드(ID 그대로 — 바꾸거나 재사용하지 않는다), 카드의 강의 = source 의 페이지
  glossary.md 의 표 → 용어. 확장 문법(!!! ??? === 각주 mermaid)·상대 링크는 렌더러가 아는 꼴로 바꾼다(렌더러를 넓히지 않는다)
같은 입력이면 같은 바이트(키 정렬·고정 순서). 원본은 읽기만 한다(원본 → 산출물 단방향).
입력: Learn 프로젝트 폴더 / 출력: 과정 파일(JSON 한 줄 + 줄바꿈) / 트리거: 손으로, scripts/app_smoke.py·verify 의 Learn 단계
문서: docs/P3_요구사항정의서_PC.md FR-350~352, docs/P3_설계서_PC.md 3.8절
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from mylearner import constants as K
from mylearner.convert.mwl import dumps, summary, write_atomic

CHAPTER_RE = re.compile(r"^\d{2}-[a-z0-9][a-z0-9-]*$")
LEVEL_RE = re.compile(r"^L([0-5])$")
COURSE_RE = re.compile(K.SHARED["COURSE_ID_RE"])
ITEM_RE = re.compile(K.SHARED["ITEM_ID_RE"])
ADMON_RE = re.compile(r'^(!!!|\?\?\?\+?)\s+([A-Za-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*$')
TAB_RE = re.compile(r'^===\s+"((?:[^"\\]|\\.)*)"\s*$')
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
FOOTDEF_RE = re.compile(r"^\[\^([^\]\s]+)\]:\s?(.*)$")
FOOTREF_RE = re.compile(r"\[\^([^\]\s]+)\]")
LINK_RE = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)\s]+)\)")
ADMON_TITLE = {"note": "참고", "tip": "팁", "warning": "주의", "danger": "위험", "info": "정보", "example": "예", "question": "질문",
               "abstract": "요약", "success": "확인", "failure": "실패", "bug": "버그", "quote": "인용"}


class LearnError(Exception):
    """변환할 수 없다(사용자에게 이유를 보인다)."""


# ---------------------------------------------------------------- YAML 머리(콘텐츠 표준 v0 이 쓰는 부분집합)
def _scalar(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    return v


def parse_front(text: str) -> Tuple[Dict[str, Any], str]:
    lines = text.lstrip("\ufeff").splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    meta: Dict[str, Any] = {}
    key: Optional[str] = None
    for i in range(1, len(lines)):
        line = lines[i]
        if line.strip() == "---":
            return meta, "\n".join(lines[i + 1:])
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^\s+-\s*(.*)$", line)
        if m and key is not None:
            if not isinstance(meta.get(key), list):
                meta[key] = []
            meta[key].append(_scalar(m.group(1)))
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$", line)
        if not m:
            raise LearnError("머리 %d행을 읽을 수 없다" % (i + 1))
        key, val = m.group(1), m.group(2).strip()
        if val.startswith("[") and val.endswith("]"):
            meta[key] = [_scalar(x) for x in val[1:-1].split(",") if x.strip()]
        elif val:
            meta[key] = _scalar(val)
        else:
            meta[key] = []
    raise LearnError("머리를 닫는 --- 가 없다")


# ---------------------------------------------------------------- 본문 바꾸기
def lesson_id(rel: str) -> str:
    """content/ 기준 페이지 경로 → 강의 ID. 'a/b.md' → 'a.b'"""
    rid = rel[:-3].replace("/", ".") if rel.endswith(".md") else rel.replace("/", ".")
    if not ITEM_RE.match(rid):
        raise LearnError("강의 ID 로 쓸 수 없는 경로: %s" % rel)
    return rid


def _resolve(page_rel: str, target: str) -> str:
    parts = page_rel.split("/")[:-1]
    for seg in target.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            if parts:
                parts.pop()
        else:
            parts.append(seg)
    return "/".join(parts)


class _Ctx:
    def __init__(self, course_id: str, page_rel: str, lessons: set):
        self.course_id, self.page_rel, self.lessons = course_id, page_rel, lessons
        self.notes: List[Tuple[str, str]] = []
        self.order: Dict[str, int] = {}

    def note_no(self, key: str) -> int:
        if key not in self.order:
            self.order[key] = len(self.order) + 1
        return self.order[key]


def _link(ctx: _Ctx, label: str, href: str) -> str:
    if re.match(r"^https?://", href, re.I):
        return "[%s](%s)" % (label, href)
    if href.startswith("#"):
        return label                                  # 같은 페이지 앵커 — 앱의 해시 주소와 겹치므로 글로만
    path = href.split("#", 1)[0]
    if path.endswith(".md"):
        rel = _resolve(ctx.page_rel, path)
        if rel == "glossary.md":
            return "[%s](#/glossary/%s)" % (label, ctx.course_id)
        lid = lesson_id(rel) if ITEM_RE.match(rel[:-3].replace("/", ".")) else None
        if lid in ctx.lessons:
            return "[%s](#/learn/%s/%s)" % (label, ctx.course_id, lid)
    return label                                      # 그 밖의 상대 경로(그림·파일·없는 페이지)는 글로만


def _inline(ctx: _Ctx, line: str) -> str:
    out = []
    for i, seg in enumerate(re.split(r"(`+[^`]*`+)", line)):
        if i % 2:
            out.append(seg)
            continue
        seg = FOOTREF_RE.sub(lambda m: "(주 %d)" % ctx.note_no(m.group(1)), seg)
        seg = LINK_RE.sub(lambda m: _link(ctx, m.group(1), m.group(2)), seg)
        out.append(seg)
    return "".join(out)


def _block(lines: List[str], start: int) -> Tuple[List[str], int]:
    """start 부터 4칸 들여쓴 줄(사이 빈 줄 포함)을 모아 들여쓰기를 뗀다 → (줄들, 다음 위치)"""
    out, i = [], start
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("    ") or ln.startswith("\t"):
            out.append(ln[4:] if ln.startswith("    ") else ln[1:])
        elif not ln.strip():
            j = i
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines) and (lines[j].startswith("    ") or lines[j].startswith("\t")):
                out.extend([""] * (j - i))
                i = j
                continue
            break
        else:
            break
        i += 1
    return out, i


def _convert_lines(ctx: _Ctx, lines: List[str]) -> List[str]:
    out: List[str] = []
    i, fence = 0, None
    while i < len(lines):
        ln = lines[i]
        fm = FENCE_RE.match(ln)
        if fence:
            out.append(ln)
            if fm and fm.group(1)[0] == fence[0] and len(fm.group(1)) >= len(fence):
                fence = None
            i += 1
            continue
        if fm:
            fence = fm.group(1)
            out.append(ln)
            i += 1
            continue
        am = ADMON_RE.match(ln)
        if am:
            kind, title = am.group(2).lower(), (am.group(3) or "").replace('\\"', '"')
            body, i = _block(lines, i + 1)
            inner = _convert_lines(ctx, body)
            if am.group(1) == "!!!":
                out.append("> **%s**" % _inline(ctx, title or ADMON_TITLE.get(kind, kind)))
                out += [("> " + x) if x.strip() else ">" for x in inner]
            else:
                out.append("**%s**" % _inline(ctx, title or ADMON_TITLE.get(kind, kind)))
                out.append("")
                out += [("> " + x) if x.strip() else ">" for x in inner]
            out.append("")
            continue
        tm = TAB_RE.match(ln)
        if tm:
            body, i = _block(lines, i + 1)
            out.append("**%s**" % _inline(ctx, tm.group(1).replace('\\"', '"')))
            out.append("")
            out += _convert_lines(ctx, body)
            out.append("")
            continue
        dm = FOOTDEF_RE.match(ln)
        if dm:
            body, i = _block(lines, i + 1)
            text = " ".join([dm.group(2).strip()] + [b.strip() for b in body if b.strip()])
            ctx.notes.append((dm.group(1), _inline(ctx, text)))
            continue
        out.append(_inline(ctx, ln))
        i += 1
    return out


def convert_body(md: str, course_id: str, page_rel: str, lessons: set) -> str:
    lines = md.splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines and re.match(r"^#\s+\S", lines[0]):    # 맨 앞 # 제목은 화면이 강의 제목으로 그린다 — 두 번 나오지 않게
        lines.pop(0)
    ctx = _Ctx(course_id, page_rel, lessons)
    out = _convert_lines(ctx, lines)
    if ctx.notes:
        defs = {k: v for k, v in ctx.notes}
        out += ["", "## 주", ""]
        for key, n in sorted(ctx.order.items(), key=lambda x: x[1]):
            out.append("%d. %s" % (n, defs.get(key, "(주 내용 없음)")))
    text = "\n".join(out).strip("\n")
    return re.sub(r"\n{3,}", "\n\n", text) + "\n"


# ---------------------------------------------------------------- 용어집
def _plain(cell: str) -> str:
    cell = re.sub(r"(?<!!)\[([^\]]*)\]\([^)]*\)", r"\1", cell)
    return re.sub(r"\*\*([^*]+)\*\*", r"\1", cell).strip()


def parse_glossary(md: str, lessons: set) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for line in md.splitlines():
        s = line.strip()
        if not (s.startswith("|") and s.endswith("|")):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) < 2 or set(cells[0]) <= set("-: ") or cells[0] in ("용어", "낱말", "term"):
            continue
        lesson = None
        for href in re.findall(r"\]\(([^)\s]+)\)", cells[2] if len(cells) > 2 else ""):
            path = href.split("#", 1)[0]
            if path.endswith(".md"):
                lid = path[:-3].replace("/", ".")
                if lid in lessons:
                    lesson = lid
                    break
        term = _plain(cells[0])
        if not term:
            continue
        out.append({"id": "T-%03d" % (len(out) + 1), "term": term, "en": "", "short": _plain(cells[1]), "part": "main", "lesson": lesson})
    return out


# ---------------------------------------------------------------- 과정
def _git_short(path: Path) -> str:
    try:
        r = subprocess.run(["git", "-c", "safe.directory=*", "-C", str(path), "log", "-1", "--format=%h"], capture_output=True, text=True, timeout=20)
        return r.stdout.strip() if r.returncode == 0 and re.match(r"^[0-9a-f]{7,12}$", r.stdout.strip()) else "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def content_hash(content: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(content.rglob("*")):
        if p.is_file() and (p.suffix in (".md", ".json")):
            h.update(p.relative_to(content).as_posix().encode("utf-8") + b"\0" + p.read_bytes() + b"\0")
    return h.hexdigest()


def build(project: Path, ref: Optional[str] = None) -> Dict[str, Any]:
    content = Path(project) / "content"
    idx = content / "index.md"
    if not idx.is_file():
        raise LearnError("content/index.md 가 없다 - Learn 콘텐츠 표준 v0 프로젝트가 아니다")
    head, _ = parse_front(idx.read_text(encoding="utf-8"))
    cid, area = str(head.get("project", "")), str(head.get("area", ""))
    if area == "kids":
        raise LearnError("area: kids 자료는 가져오지 않는다(Learn 경계 규칙 2절)")
    if not COURSE_RE.match(cid):
        raise LearnError("project 가 과정 ID 규칙에 맞지 않는다: %r" % cid)
    pages: List[Tuple[str, str, Path]] = []        # (단원 ID, content 기준 경로, 파일)
    for ch in sorted(content.iterdir(), key=lambda p: p.name):
        name = ch.stem if ch.is_file() else ch.name
        if not CHAPTER_RE.match(name):
            continue
        if ch.is_file() and ch.suffix == ".md":
            pages.append((name, ch.name, ch))
        elif ch.is_dir():
            files = sorted(ch.glob("*.md"), key=lambda p: (p.name != "index.md", p.name))
            pages += [(name, "%s/%s" % (name, f.name), f) for f in files]
    lesson_ids = {lesson_id(rel) for _, rel, _ in pages}
    lessons: Dict[str, Any] = {}
    units: Dict[str, Dict[str, Any]] = {}
    worst = 0
    levels = K.SHARED["CONFIDENCE_LEVELS"]
    for unit, rel, f in pages:
        meta, body = parse_front(f.read_text(encoding="utf-8"))
        lid = lesson_id(rel)
        conf = meta.get("confidence") if meta.get("confidence") in levels else "unverified"
        worst = max(worst, levels.index(conf))
        lv = LEVEL_RE.match(str(meta.get("level", "")))
        text = convert_body(body, cid, rel, lesson_ids)
        lessons[lid] = {"title": str(meta.get("title") or lid), "minutes": max(5, min(60, round(len(text) / 400))), "level": int(lv.group(1)) if lv else 1,
                        "prereqs": [], "tags": [str(t) for t in meta.get("tags", []) if isinstance(t, str)] if isinstance(meta.get("tags"), list) else [],
                        "confidence": conf, "sources": [str(s) for s in meta.get("sources", [])] if isinstance(meta.get("sources"), list) else [], "body": text}
        u = units.setdefault(unit, {"id": unit, "title": "", "goal": "", "lessons": []})
        if not u["title"]:
            u["title"] = lessons[lid]["title"]
        u["lessons"].append(lid)
    cards: Dict[str, Any] = {}
    for cf in sorted((content / "cards").glob("*.json")) if (content / "cards").is_dir() else []:
        for c in json.loads(cf.read_text(encoding="utf-8")):
            src = str(c.get("source", ""))
            lid = lesson_id(src.split("#", 1)[0]) if src.split("#", 1)[0].endswith(".md") else None
            if not ITEM_RE.match(str(c.get("id", ""))) or lid not in lessons:
                raise LearnError("카드 %s: ID 가 틀렸거나 source 의 페이지가 없다(%s)" % (c.get("id"), src))
            if c["id"] in cards:
                raise LearnError("카드 ID 중복: %s" % c["id"])
            cards[c["id"]] = {"lesson": lid, "type": "concept", "q": str(c["q"]).strip(), "a": str(c["a"]).strip(), "hint": str(c.get("hint", "")),
                              "tags": [str(t) for t in c.get("tags", [])], "difficulty": 1, "source": src}
    gfile = content / "glossary.md"
    glossary = parse_glossary(parse_front(gfile.read_text(encoding="utf-8"))[1], lesson_ids) if gfile.is_file() else []
    title = str(head.get("title") or cid)
    return {"format": K.SHARED["COURSE_FORMAT"], "version": K.SHARED["COURSE_VERSION"], "min_reader": K.SHARED["COURSE_MIN_READER"],
            "id": cid, "title": title, "kind": "course", "lang": "ko", "confidence": levels[worst], "readonly": True,
            "origin": {"type": "learn", "ref": ref or "%s@%s" % (cid, _git_short(Path(project))), "hash": content_hash(content)},
            "default_plan": None, "summary": "",
            "parts": [{"id": "main", "title": title, "code": "", "summary": "", "units": [units[k] for k in sorted(units)]}],
            "lessons": lessons, "cards": cards, "quizzes": {}, "labs": {}, "drills": {}, "glossary": glossary, "diagnostic": [], "plans": {}}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m mylearner.convert.learn", allow_abbrev=False, description="Learn 자료(콘텐츠 표준 v0)를 MyLearner 과정 파일로 바꾼다")
    ap.add_argument("project", help="Learn 프로젝트 폴더(content/index.md 가 있는 곳)")
    ap.add_argument("--out", required=True, help="만들 과정 파일")
    ap.add_argument("--ref", default=None, help="출처 글(기본: <project>@<그 프로젝트의 git 커밋>)")
    args = ap.parse_args(argv)
    if args.ref is not None and not re.match(K.REF_RE, args.ref):
        print("--ref 는 저장소이름@커밋 꼴(영문·숫자·._@-)만 받는다")
        return 2
    try:
        course = build(Path(args.project), args.ref)
    except (LearnError, OSError, ValueError) as e:
        print("변환하지 못했다: %s" % e)
        return 1
    write_atomic(Path(args.out), dumps(course))
    print(summary(course))
    print("만듦: %s (%d 바이트)" % (args.out, len(dumps(course).encode("utf-8"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
