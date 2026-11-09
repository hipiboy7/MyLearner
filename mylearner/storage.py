"""데이터 폴더 저장(서버 모드) — 기록 파일(합집합·원자적 쓰기)·기기 ID·접속 토큰·사용자 과정·백업. 표준 라이브러리만.

데이터 폴더(기본: 묶음 폴더의 data/):
  device.json  {"dev": "<16자리 16진>"}           token  접속 토큰(64자리 16진, 처음 켤 때 만든다)
  log.jsonl    mylearner-log v1 — 머리 한 줄 + 사건 줄(서버는 줄을 해석하지 않는다 — 같은 줄 = 같은 글)
  courses/<id>.json   사용자 과정        backups/<UTC 시각>-<까닭>.jsonl   백업(들여오기 전 20개·하루 14개)
  daily        마지막 하루 백업의 날짜(서버 현지 날짜)
규칙은 web/store/common.js 와 같다(백업 이름·남길 것). 화면이 줄을 해석하고(log.merge), 서버는 합집합만 한다.
입력: 데이터 폴더 경로·시계 / 출력: DataDir / 트리거: mylearner/server.py
문서: docs/P3_요구사항정의서_PC.md FR-321·324·335, docs/P3_설계서_PC.md 3.2·3.3절
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import secrets
import threading
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from mylearner import constants as C

LOG_HEADER = json.dumps({"format": C.SHARED["LOG_FORMAT"], "version": C.SHARED["LOG_VERSION"],
                         "min_reader": C.SHARED["LOG_MIN_READER"]}, sort_keys=True, separators=(",", ":"))
MAX_LINE_BYTES = 65536
MAX_LINES = 50000
KEEP = {"import-mwl": 20, "daily": 14}
REASON_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
NAME_RE = re.compile(r"^(\d{8}T\d{9}Z)-([a-z][a-z0-9-]{0,31})$")
DEVICE_RE = re.compile(C.SHARED["DEVICE_RE"])
COURSE_ID_RE = re.compile(C.SHARED["COURSE_ID_RE"])


class StorageError(Exception):
    """저장 요청이 틀렸다(화면에 이유를 보인다)."""


# ---------------------------------------------------------------- 순수 함수(등급 A)
def backup_name(when: _dt.datetime, reason: str) -> str:
    if not REASON_RE.match(reason or ""):
        raise StorageError("백업 까닭이 틀렸다")
    return when.strftime("%Y%m%dT%H%M%S") + "%03dZ-%s" % (when.microsecond // 1000, reason)


def reason_of(name: str) -> Optional[str]:
    m = NAME_RE.match(name or "")
    return m.group(2) if m else None


def prune(names: List[str]) -> List[str]:
    """지울 백업 이름 — 까닭마다 최근 KEEP 개만 남긴다. 모르는 이름은 지우지 않는다."""
    by: Dict[str, List[str]] = {}
    for n in names:
        r = reason_of(n)
        if r in KEEP:
            by.setdefault(r, []).append(n)
    out: List[str] = []
    for r, lst in by.items():
        out += sorted(lst, reverse=True)[KEEP[r]:]
    return sorted(out)


def check_line(line) -> str:
    if not isinstance(line, str):
        raise StorageError("줄은 글이어야 한다")
    if "\n" in line or "\r" in line:
        raise StorageError("줄에 줄바꿈이 있다")
    s = line.strip()
    if not s:
        raise StorageError("빈 줄")
    if len(s.encode("utf-8")) > MAX_LINE_BYTES:
        raise StorageError("줄이 %d 바이트를 넘는다" % MAX_LINE_BYTES)
    return s


def union(have: List[str], add: List[str]) -> Tuple[List[str], int]:
    seen = set()
    out: List[str] = []
    added = 0
    for line in have:
        if line not in seen:
            seen.add(line)
            out.append(line)
    for line in add:
        if line not in seen:
            seen.add(line)
            out.append(line)
            added += 1
    return out, added


def split_log(text: str) -> List[str]:
    """기록 파일 글 → 사건 줄. 첫 줄이 기록 파일 머리가 아니면 StorageError(남의 파일을 덮어쓰지 않는다)."""
    lines = [ln for ln in text.lstrip("﻿").splitlines() if ln.strip()]
    if not lines:
        return []
    try:
        head = json.loads(lines[0])
    except ValueError:
        head = None
    if not isinstance(head, dict) or head.get("format") != C.SHARED["LOG_FORMAT"]:
        raise StorageError("기록 파일 머리가 아니다 - 데이터 폴더의 log.jsonl 을 확인하세요")
    return [ln.strip() for ln in lines[1:]]


# ---------------------------------------------------------------- 데이터 폴더(등급 B)
def _atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_name("." + path.name + ".%s.tmp" % secrets.token_hex(4))
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


class DataDir:
    def __init__(self, root: Path, now: Callable[[], _dt.datetime] = None, today: Callable[[], _dt.date] = None):
        self.root = Path(root)
        self.now = now or (lambda: _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None))
        self.today = today or _dt.date.today
        self.lock = threading.Lock()
        for sub in ("", "courses", "backups"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)

    @property
    def log_path(self) -> Path:
        return self.root / "log.jsonl"

    def _secret(self, name: str, make: Callable[[], str], check: Callable[[str], bool]) -> str:
        p = self.root / name
        with self.lock:
            if p.exists():
                v = p.read_text(encoding="utf-8").strip()
                if name == "device.json":
                    try:
                        v = json.loads(v).get("dev", "")
                    except (ValueError, AttributeError):
                        v = ""
                if check(v):
                    return v
            v = make()
            body = json.dumps({"dev": v}) if name == "device.json" else v
            _atomic_write(p, (body + "\n").encode("utf-8"))
            try:
                os.chmod(p, 0o600)
            except OSError:   # Windows 등 — 그 계정 폴더 권한을 따른다
                pass
            return v

    def device(self) -> str:
        return self._secret("device.json", lambda: secrets.token_hex(8), lambda v: bool(DEVICE_RE.match(v or "")))

    def token(self) -> str:
        return self._secret("token", lambda: secrets.token_hex(32), lambda v: bool(re.match(r"^[0-9a-f]{64}$", v or "")))

    # -- 기록
    def _read_lines(self) -> List[str]:
        if not self.log_path.exists():
            return []
        return split_log(self.log_path.read_text(encoding="utf-8"))

    def log_text(self) -> str:
        with self.lock:
            return "\n".join([LOG_HEADER] + self._read_lines()) + "\n"

    def append(self, lines) -> Tuple[int, int]:
        if not isinstance(lines, list):
            raise StorageError("lines 는 목록이어야 한다")
        if len(lines) > MAX_LINES:
            raise StorageError("한 번에 %d 줄까지" % MAX_LINES)
        add = [check_line(x) for x in lines]
        with self.lock:
            have = self._read_lines()
            self._daily_locked(have)
            out, added = union(have, add)
            if added:
                _atomic_write(self.log_path, ("\n".join([LOG_HEADER] + out) + "\n").encode("utf-8"))
            return added, len(out)

    def _daily_locked(self, have: List[str]) -> None:
        mark = self.root / "daily"
        day = self.today().isoformat()
        if mark.exists() and mark.read_text(encoding="utf-8").strip() == day:
            return
        if have:
            self._backup_locked("daily", have)
        _atomic_write(mark, (day + "\n").encode("utf-8"))

    # -- 백업
    def _backup_locked(self, reason: str, have: Optional[List[str]] = None) -> str:
        lines = self._read_lines() if have is None else have
        name = backup_name(self.now(), reason)
        _atomic_write(self.root / "backups" / (name + ".jsonl"), ("\n".join([LOG_HEADER] + lines) + "\n").encode("utf-8"))
        for old in prune(self._backup_names()):
            try:
                (self.root / "backups" / (old + ".jsonl")).unlink()
            except OSError:
                pass
        return name

    def backup(self, reason: str) -> str:
        with self.lock:
            return self._backup_locked(reason)

    def _backup_names(self) -> List[str]:
        return sorted(p.stem for p in (self.root / "backups").glob("*.jsonl") if NAME_RE.match(p.stem))

    def list_backups(self) -> List[dict]:
        out = []
        for name in sorted(self._backup_names(), reverse=True):
            p = self.root / "backups" / (name + ".jsonl")
            stamp = NAME_RE.match(name).group(1)
            at = "%s-%s-%sT%s:%s:%s.%sZ" % (stamp[0:4], stamp[4:6], stamp[6:8], stamp[9:11], stamp[11:13], stamp[13:15], stamp[15:18])
            out.append({"name": name, "reason": reason_of(name), "at": at, "bytes": p.stat().st_size})
        return out

    def backup_text(self, name: str) -> str:
        if not NAME_RE.match(name or ""):
            raise StorageError("백업 이름이 틀렸다")
        p = self.root / "backups" / (name + ".jsonl")
        if not p.is_file():
            raise FileNotFoundError(name)
        return p.read_text(encoding="utf-8")

    # -- 사용자 과정
    def courses(self) -> List[dict]:
        out = []
        for p in sorted((self.root / "courses").glob("*.json")):
            if not COURSE_ID_RE.match(p.stem):
                continue
            try:
                out.append(json.loads(p.read_text(encoding="utf-8")))
            except ValueError:
                continue   # 깨진 파일은 건너뛴다(화면의 과정 검사가 다른 과정을 막지 않게)
        return out

    def save_course(self, cid: str, obj) -> None:
        if not COURSE_ID_RE.match(cid or ""):
            raise StorageError("과정 ID 가 틀렸다")
        if not isinstance(obj, dict) or obj.get("format") != C.SHARED["COURSE_FORMAT"] or obj.get("id") != cid:
            raise StorageError("과정 파일이 아니거나 ID 가 주소와 다르다")
        data = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        with self.lock:
            _atomic_write(self.root / "courses" / (cid + ".json"), data.encode("utf-8"))
