"""Python 쪽 도메인 상수 한 곳(CLAUDE.md 5절, docs/설계서_Architecture.md 6절).

SHARED 는 web/core/constants.js 의 SHARED 묶음과 같아야 한다 — tests/unit/py/test_constants_shared.py 가 본다.
문서: docs/P2_요구사항정의서_Core.md FR-202, docs/P2_설계서_Core.md 4절
"""
from __future__ import annotations

SHARED = {
    "COURSE_FORMAT": "mylearner-course",
    "COURSE_VERSION": 1,
    "COURSE_MIN_READER": 1,
    "COURSE_READER": 1,
    "LOG_FORMAT": "mylearner-log",
    "LOG_VERSION": 1,
    "LOG_MIN_READER": 1,
    "LOG_READER": 1,
    "EVENT_VERSION": 1,
    "COURSE_ID_RE": "^[a-z0-9][a-z0-9-]{0,39}$",
    "ITEM_ID_RE": "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$",
    "COURSE_KINDS": ["course", "notes"],
    "CONFIDENCE_LEVELS": ["verified", "likely", "unverified"],
    "QUIZ_ITEM_TYPES": ["mcq", "multi", "short", "order"],
    "LAB_CHECK_TYPES": ["choice", "text", "regex"],
    "MWL_COURSE_ID": "mwl",
    "MWL_NOTES_ID": "mwl-notes",
}

COURSE_FORMAT = SHARED["COURSE_FORMAT"]
COURSE_VERSION = SHARED["COURSE_VERSION"]
COURSE_MIN_READER = SHARED["COURSE_MIN_READER"]
MWL_COURSE_ID = SHARED["MWL_COURSE_ID"]

# MWL 미들웨어 과정(기본 제공 과정). 코드를 옮기고 골든 벡터를 복사한 기준 커밋(CLAUDE.md 0절)
MWL_COMMIT = "e55b9c0"
MWL_COURSE_TITLE = "미들웨어 과정"
# 출처 글(--ref) 꼴 — 저장소 이름@커밋 정도. 경로·주소를 넣지 않게 글자를 좁힌다(/ : 없음)
REF_RE = r"^[A-Za-z0-9][A-Za-z0-9._@-]{0,79}$"
