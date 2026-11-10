"""데이터 폴더 저장(서버 모드) — 기록 파일(합집합·원자적 쓰기)·기기 ID·접속 토큰·사용자 과정·백업. 표준 라이브러리만.

데이터 폴더(기본: 묶음 폴더의 data/):
  device.json  {"dev": "<16자리 16진>"}           token  접속 토큰(64자리 16진, 처음 켤 때 만든다)
  log.jsonl    mylearner-log v1 — 머리 한 줄 + 사건 줄(서버는 줄을 해석하지 않는다 — 같은 줄 = 같은 글)
  courses/<id>.json   사용자 과정        backups/<UTC 시각>-<까닭>.jsonl   백업(들여오기 전 각 20개·되살리기 전 10개·하루 14개)
  daily        마지막 하루 백업의 날짜(서버 현지 날짜)
규칙은 web/store/common.js 와 같다(백업 이름·남길 것). 화면이 줄을 해석하고(log.merge), 서버는 합집합만 한다.
입력: 데이터 폴더 경로·시계 / 출력: DataDir / 트리거: mylearner/server.py
되살리기(P4): backup_diff(지금에만 있는 줄·백업에만 있는 줄의 수 — 백업 글은 내주지 않는다)·restore((지금 − 뺄 줄) ∪ 백업, 먼저 'restore' 백업).
문서: docs/P3_요구사항정의서_PC.md FR-321·324·335, docs/P3_설계서_PC.md 3.2·3.3절, docs/P4_설계서_Mobile.md 3.6절
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
KEEP = {"import-mwl": 20, "import-merge": 20, "restore": 10, "daily": 14}   # web/store/common.js KEEP 와 같다(시험이 본다)
REASON_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
NAME_RE = re.compile(r"^(\d{8}T\d{9}Z)-([a-z][a-z0-9-]{0,31})$")
DEVICE_RE = re.compile(C.SHARED["DEVICE_RE"])
COURSE_ID_RE = re.compile(C.SHARED["COURSE_ID_RE"])
TOKEN_RE = re.compile(r"[0-9a-f]{64}")


class StorageError(Exception):
    """저장 요청이 틀렸다(화면에 이유를 보인다)."""


def ok(rx, value) -> bool:
    """정규식 전체 일치 — Python 의 match + $ 는 끝의 줄바꿈을 받는다(독립 점검 V7). 글이 아니면 거짓."""
    return isinstance(value, str) and rx.fullmatch(value) is not None


def _no_constant(name):
    raise ValueError("NaN·Infinity 는 받지 않는다: %s" % name)


def loads(text: str):
    """JSON 읽기 — NaN·Infinity 를 거부한다(화면 JSON.parse 가 응답 전체를 거부하게 되므로 — 독립 점검 V7)."""
    return json.loads(text, parse_constant=_no_constant)


# ---------------------------------------------------------------- 순수 함수(등급 A)
def backup_name(when: _dt.datetime, reason: str) -> str:
    if not ok(REASON_RE, reason):
        raise StorageError("백업 까닭이 틀렸다")
    return when.strftime("%Y%m%dT%H%M%S") + "%03dZ-%s" % (when.microsecond // 1000, reason)


def reason_of(name: str) -> Optional[str]:
    m = NAME_RE.fullmatch(name) if isinstance(name, str) else None
    return m.group(2) if m else None


def prune(names: List[str], keep: Optional[str] = None) -> List[str]:
    """지울 백업 이름 — 까닭마다 최근 KEEP 개만 남긴다. 모르는 이름과 keep(방금 만든 것 — 시계가 뒤로 가도 지우지 않게, S6)은 지우지 않는다."""
    by: Dict[str, List[str]] = {}
    for n in names:
        r = reason_of(n)
        if r in KEEP:
            by.setdefault(r, []).append(n)
    out: List[str] = []
    for r, lst in by.items():   # 방금 만든 것은 가장 새것으로 친다
        ranked = sorted(lst, key=lambda n: (n == keep, n), reverse=True)
        out += ranked[KEEP[r]:]
    return sorted(out)


def check_line(line) -> str:
    if not isinstance(line, str):
        raise StorageError("줄은 글이어야 한다")
    if "\n" in line or "\r" in line:
        raise StorageError("줄에 줄바꿈이 있다")
    s = line.strip(" \t")   # ASCII 빈칸만 — str.strip() 은 U+2028·U+0085 같은 글자까지 떼어 줄 글이 바뀐다(독립 점검 S2)
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
    # 줄은 \n·\r 로만 나눈다(web/core/log.js readFile 과 같게). splitlines() 는 U+2028·U+2029·U+0085 에서도 나눠
    # 그 글자가 든 사건(회고에 붙여 넣은 글 등)을 조각냈다(독립 점검 S2)
    lines = [ln for ln in re.split(r"\r\n|\n|\r", text.lstrip("\ufeff")) if ln.strip(" \t")]
    if not lines:
        return []
    try:
        head = json.loads(lines[0])
    except ValueError:
        head = None
    if not isinstance(head, dict) or head.get("format") != C.SHARED["LOG_FORMAT"]:
        raise StorageError("기록 파일 머리가 아니다 - 데이터 폴더의 log.jsonl 을 확인하세요")
    mr = head.get("min_reader")
    if not isinstance(mr, int) or mr > C.SHARED["LOG_READER"]:   # 더 새 판의 파일 — v1 머리로 다시 써서 낮추지 않는다(S10)
        raise StorageError("더 새 판의 기록 파일이다 - 이 판의 MyLearner 로는 쓰지 않는다")
    return [ln.strip(" \t") for ln in lines[1:]]


# ---------------------------------------------------------------- 데이터 폴더(등급 B)
def _atomic_write(path: Path, data: bytes) -> None:
    """임시 파일(처음부터 0600 — 독립 점검 V3·V4)에 쓰고 fsync 한 뒤 바꿔 넣는다."""
    tmp = path.with_name("." + path.name + ".%s.tmp" % secrets.token_hex(4))
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(fd, "wb") as f:
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
        for sub in ("", "courses", "backups"):   # 이 계정만 읽게(0700 — 같은 컴퓨터의 다른 계정, 독립 점검 V3)
            d = self.root / sub
            d.mkdir(mode=0o700, parents=True, exist_ok=True)
            try:
                os.chmod(d, 0o700)
            except OSError:   # Windows 등 — 그 계정 폴더 권한을 따른다
                pass

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
                        v = loads(v).get("dev", "")
                    except (ValueError, AttributeError):
                        v = ""
                if check(v):
                    try:
                        os.chmod(p, 0o600)   # 앞 판이 0644 로 만든 파일도 줄인다
                    except OSError:
                        pass
                    return v
            v = make()
            body = json.dumps({"dev": v}) if name == "device.json" else v
            _atomic_write(p, (body + "\n").encode("utf-8"))
            try:
                os.chmod(p, 0o600)
            except OSError:   # Windows 등 — 그 계정 폴더 권한을 따른다
                pass
            return v

    def lock_process(self):
        """이 데이터 폴더를 이 프로세스만 쓰게 잠근다(서버 둘이 같은 폴더를 쓰면 줄이 사라졌다 — 독립 점검 S4). 잠금은 프로세스가 끝나면 풀린다."""
        f = open(self.root / ".lock", "a+")
        try:
            if os.name == "nt":
                import msvcrt
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            f.close()
            raise StorageError("다른 MyLearner 서버가 이 데이터 폴더를 쓰고 있습니다 - 그 창을 쓰거나 끈 뒤 다시 켜세요")
        self._lockfile = f
        return f

    def device(self) -> str:
        return self._secret("device.json", lambda: secrets.token_hex(8), lambda v: ok(DEVICE_RE, v))

    def token(self) -> str:
        return self._secret("token", lambda: secrets.token_hex(32), lambda v: ok(TOKEN_RE, v))

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
            try:   # 하루 백업이 실패해도 기록은 쓴다(브라우저 어댑터와 같게 — 독립 점검 S5). 들여오기 전 백업은 실패하면 멈춘다
                self._backup_locked("daily", have)
            except OSError:
                return
        _atomic_write(mark, (day + "\n").encode("utf-8"))

    # -- 백업
    def _backup_locked(self, reason: str, have: Optional[List[str]] = None) -> str:
        lines = self._read_lines() if have is None else have
        name = backup_name(self.now(), reason)
        _atomic_write(self.root / "backups" / (name + ".jsonl"), ("\n".join([LOG_HEADER] + lines) + "\n").encode("utf-8"))
        for old in prune(self._backup_names(), keep=name):
            try:
                (self.root / "backups" / (old + ".jsonl")).unlink()
            except OSError:
                pass
        return name

    def backup(self, reason: str) -> str:
        with self.lock:
            return self._backup_locked(reason)

    def _backup_names(self) -> List[str]:
        return sorted(p.stem for p in (self.root / "backups").glob("*.jsonl") if ok(NAME_RE, p.stem))

    def list_backups(self) -> List[dict]:
        out = []
        for name in sorted(self._backup_names(), reverse=True):
            p = self.root / "backups" / (name + ".jsonl")
            stamp = NAME_RE.fullmatch(name).group(1)
            at = "%s-%s-%sT%s:%s:%s.%sZ" % (stamp[0:4], stamp[4:6], stamp[6:8], stamp[9:11], stamp[11:13], stamp[13:15], stamp[15:18])
            out.append({"name": name, "reason": reason_of(name), "at": at, "bytes": p.stat().st_size})
        return out

    def backup_text(self, name: str) -> str:
        if not ok(NAME_RE, name):
            raise StorageError("백업 이름이 틀렸다")
        p = self.root / "backups" / (name + ".jsonl")
        if not p.is_file():
            raise FileNotFoundError(name)
        return p.read_text(encoding="utf-8")

    # -- 되살리기(P4 FR-440~443) — 줄을 해석하지 않고 집합 연산만 한다. 어느 줄이 '이 기기' 것인지는 화면이 정해 remove 로 보낸다
    def backup_diff(self, name: str) -> Tuple[List[str], int]:
        backup = split_log(self.backup_text(name))
        with self.lock:
            have = self._read_lines()
        inb = set(backup)
        only_current = [ln for ln in dict.fromkeys(have) if ln not in inb]
        return only_current, len(inb - set(have))

    def restore(self, name: str, remove) -> dict:
        if not isinstance(remove, list):
            raise StorageError("remove 는 목록이어야 한다")
        if len(remove) > MAX_LINES:
            raise StorageError("한 번에 %d 줄까지" % MAX_LINES)
        drop = set(check_line(x) for x in remove)
        backup = split_log(self.backup_text(name))
        with self.lock:
            have = self._read_lines()
            pre = self._backup_locked("restore", have)   # 실패하면 여기서 멈춘다 — 아무것도 바꾸지 않는다
            inb = set(backup)
            kept = [ln for ln in have if ln not in drop or ln in inb]
            out, added = union(kept, backup)
            removed = len(set(have)) - len(set(kept))
            _atomic_write(self.log_path, ("\n".join([LOG_HEADER] + out) + "\n").encode("utf-8"))
            return {"removed": removed, "added": added, "backup": pre, "total": len(out)}

    # -- 사용자 과정
    def courses(self) -> List[dict]:
        out = []
        for p in sorted((self.root / "courses").glob("*.json")):
            if not ok(COURSE_ID_RE, p.stem):
                continue
            try:
                out.append(loads(p.read_text(encoding="utf-8")))
            except (ValueError, RecursionError):
                continue   # 깨진 파일은 건너뛴다(화면의 과정 검사가 다른 과정을 막지 않게)
        return out

    def save_course(self, cid: str, obj) -> None:
        if not ok(COURSE_ID_RE, cid):
            raise StorageError("과정 ID 가 틀렸다")
        if not isinstance(obj, dict) or obj.get("format") != C.SHARED["COURSE_FORMAT"] or obj.get("id") != cid:
            raise StorageError("과정 파일이 아니거나 ID 가 주소와 다르다")
        try:
            data = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
        except (ValueError, RecursionError):
            raise StorageError("과정에 NaN·Infinity 가 있거나 너무 깊다")
        with self.lock:
            _atomic_write(self.root / "courses" / (cid + ".json"), data.encode("utf-8"))
