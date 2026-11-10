"""mylearner/storage.py — 순수 함수(등급 A, 시험 먼저 2026-11-09)와 데이터 폴더(등급 B). 문서: docs/P3_설계서_PC.md 3.2절."""
from __future__ import annotations

import datetime as dt
import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path

from mylearner import storage as S


class PureTest(unittest.TestCase):
    def test_backup_name_and_reason(self):
        n = S.backup_name(dt.datetime(2026, 11, 9, 3, 4, 5, 6789), "import-mwl")
        self.assertEqual(n, "20261109T030405006Z-import-mwl")   # web/store/common.js backupName 과 같은 꼴
        self.assertEqual(S.reason_of(n), "import-mwl")
        self.assertIsNone(S.reason_of("x-daily"))
        with self.assertRaises(S.StorageError):
            S.backup_name(dt.datetime(2026, 1, 1), "Bad")
        with self.assertRaises(S.StorageError):
            S.backup_name(dt.datetime(2026, 1, 1), "../x")

    def test_prune_keeps_20_and_14(self):
        names = ["202611%02dT000000000Z-import-mwl" % i for i in range(25)] + ["202610%02dT000000000Z-daily" % i for i in range(16)] + ["junk"]
        dele = S.prune(names)
        self.assertEqual(len(dele), 7)
        self.assertIn("20261100T000000000Z-import-mwl", dele)
        self.assertNotIn("20261105T000000000Z-import-mwl", dele)
        self.assertIn("20261001T000000000Z-daily", dele)
        self.assertNotIn("junk", dele)
        self.assertEqual(S.prune([]), [])

    def test_check_line(self):
        self.assertEqual(S.check_line('  {"a":1}  '), '{"a":1}')
        for bad in (1, None, "a\nb", "a\rb", "   ", "x" * (S.MAX_LINE_BYTES + 1)):
            with self.assertRaises(S.StorageError):
                S.check_line(bad)
        self.assertEqual(S.check_line("가" * (S.MAX_LINE_BYTES // 3)), "가" * (S.MAX_LINE_BYTES // 3))

    def test_union(self):
        self.assertEqual(S.union(["a", "b", "a"], ["b", "c", "c"]), (["a", "b", "c"], 1))
        self.assertEqual(S.union([], []), ([], 0))

    def test_split_log(self):
        head = S.LOG_HEADER
        self.assertEqual(head, '{"format":"mylearner-log","min_reader":1,"version":1}')   # web/core/log.js HEADER 와 같다
        self.assertEqual(S.split_log("\ufeff" + head + "\n a \n\n b\r\n"), ["a", "b"])
        self.assertEqual(S.split_log(""), [])
        for bad in ("not json\nx", '{"format":"other"}\nx', "[1]\n"):
            with self.assertRaises(S.StorageError):
                S.split_log(bad)


class DataDirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ml-store-"))
        self.clock = [dt.datetime(2026, 11, 9, 1, 0, 0)]
        self.day = [dt.date(2026, 11, 9)]
        self.d = S.DataDir(self.tmp / "data", now=lambda: self.clock[0], today=lambda: self.day[0])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_device_and_token_are_made_once(self):
        dev, tok = self.d.device(), self.d.token()
        self.assertRegex(dev, r"^[0-9a-f]{16}$")
        self.assertRegex(tok, r"^[0-9a-f]{64}$")
        again = S.DataDir(self.tmp / "data")
        self.assertEqual((again.device(), again.token()), (dev, tok))
        (self.tmp / "data" / "device.json").write_text("{bad", encoding="utf-8")
        self.assertNotEqual(again.device(), dev)   # 깨진 파일이면 새로 만든다(기기 ID 는 새 기기가 된다 — 기록은 남는다)
        (self.tmp / "data" / "token").write_text("short", encoding="utf-8")
        self.assertRegex(again.token(), r"^[0-9a-f]{64}$")

    def test_append_is_union_and_atomic_file(self):
        self.assertEqual(self.d.log_text(), S.LOG_HEADER + "\n")
        self.assertEqual(self.d.append(["a", "b"]), (2, 2))
        self.assertEqual(self.d.append(["b", "c", " a "]), (1, 3))
        self.assertEqual(self.d.log_text(), "\n".join([S.LOG_HEADER, "a", "b", "c"]) + "\n")
        self.assertEqual(self.d.append([]), (0, 3))
        self.assertEqual(sorted(p.name for p in (self.tmp / "data").iterdir() if p.name.endswith(".tmp")), [], "임시 파일이 남지 않는다")
        for bad in ("x", None, [1], ["a\nb"], ["x"] * (S.MAX_LINES + 1)):
            with self.assertRaises(S.StorageError):
                self.d.append(bad)
        self.assertEqual(self.d.log_text().count("\n"), 4, "틀린 요청은 아무것도 쓰지 않는다")

    def test_refuses_foreign_log_file(self):
        self.d.log_path.write_text("hello\n", encoding="utf-8")
        with self.assertRaises(S.StorageError):
            self.d.append(["a"])
        self.assertEqual(self.d.log_path.read_text(encoding="utf-8"), "hello\n", "남의 파일을 덮어쓰지 않는다")

    def test_daily_backup_before_first_append_of_day(self):
        self.d.append(["a"])                    # 첫날 — 기록이 비어 있어 백업하지 않는다
        self.assertEqual(self.d.list_backups(), [])
        self.d.append(["b"])
        self.day[0] = dt.date(2026, 11, 10)
        self.clock[0] = dt.datetime(2026, 11, 10, 0, 0, 1)
        self.d.append(["c"])
        bl = self.d.list_backups()
        self.assertEqual([b["reason"] for b in bl], ["daily"])
        self.assertEqual(self.d.backup_text(bl[0]["name"]), "\n".join([S.LOG_HEADER, "a", "b"]) + "\n", "그날 쓰기 전 모습")
        self.assertEqual(bl[0]["at"], "2026-11-10T00:00:01.000Z")
        self.d.append(["d"])
        self.assertEqual(len(self.d.list_backups()), 1, "같은 날은 한 번")

    def test_backups_pruned_and_names_checked(self):
        self.d.append(["a"])
        for i in range(22):
            self.clock[0] = dt.datetime(2026, 11, 9, 2, 0, i)
            self.d.backup("import-mwl")
        self.assertEqual(len(self.d.list_backups()), 20)
        with self.assertRaises(S.StorageError):
            self.d.backup("")
        with self.assertRaises(S.StorageError):
            self.d.backup_text("../token")
        with self.assertRaises(FileNotFoundError):
            self.d.backup_text("20200101T000000000Z-daily")

    def test_courses(self):
        c = {"format": "mylearner-course", "id": "mwl-notes", "title": "메모"}
        self.d.save_course("mwl-notes", c)
        self.assertEqual(self.d.courses(), [c])
        (self.tmp / "data" / "courses" / "broken.json").write_text("{", encoding="utf-8")
        (self.tmp / "data" / "courses" / "Bad_Id.json").write_text("{}", encoding="utf-8")
        self.assertEqual(self.d.courses(), [c], "깨진 파일·틀린 이름은 건너뛴다")
        for cid, obj in (("../x", c), ("mwl-notes", {"format": "x", "id": "mwl-notes"}), ("other", c), ("mwl-notes", [1])):
            with self.assertRaises(S.StorageError):
                self.d.save_course(cid, obj)
        saved = json.loads((self.tmp / "data" / "courses" / "mwl-notes.json").read_text(encoding="utf-8"))
        self.assertEqual(saved, c)

    def test_files_are_private(self):   # 독립 점검 V3·V4 — 데이터 폴더 0700, 파일은 처음부터 0600
        import os
        import stat
        self.d.append(["a"])
        self.d.backup("import-mwl")
        self.d.save_course("abc", {"format": "mylearner-course", "id": "abc"})
        self.d.token()
        root = self.tmp / "data"
        if os.name != "nt":
            for d in (root, root / "backups", root / "courses"):
                self.assertEqual(stat.S_IMODE(d.stat().st_mode), 0o700, d)
            for f in [root / "log.jsonl", root / "token", root / "daily"] + list((root / "backups").iterdir()) + list((root / "courses").iterdir()):
                if f.exists():
                    self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600, f)

    def test_fullmatch_and_nan(self):   # 독립 점검 V7
        self.assertIsNone(S.reason_of("20261109T000000000Z-daily\n"))
        with self.assertRaises(S.StorageError):
            S.backup_name(dt.datetime(2026, 1, 1), "daily\n")
        with self.assertRaises(S.StorageError):
            self.d.save_course("abc\n", {"format": "mylearner-course", "id": "abc\n"})
        with self.assertRaises(S.StorageError):
            self.d.save_course("nan", {"format": "mylearner-course", "id": "nan", "x": float("nan")})
        (self.tmp / "data" / "courses" / "inf.json").write_text('{"id":"inf","x":Infinity}', encoding="utf-8")
        self.assertEqual(self.d.courses(), [], "NaN·Infinity 가 든 파일은 건너뛴다")
        with self.assertRaises(ValueError):
            S.loads("[NaN]")

    def test_review_s2_s10_line_splitting_and_newer_header(self):   # 독립 점검 S2·S10
        odd = '{"a":"x\u2028y\u2029z\u0085w\x1cq"}'
        self.assertEqual(S.check_line(odd), odd, "줄 안의 U+2028 등은 그대로(ASCII 빈칸만 뗀다)")
        self.d.append([odd, "b"])
        self.assertEqual(self.d.log_text().split("\n")[1:3], [odd, "b"], "다시 읽어도 한 줄")
        self.d.append(["c"])
        self.assertEqual(S.split_log(self.d.log_path.read_text(encoding="utf-8")), [odd, "b", "c"], "다음 덧붙이기에도 조각나지 않는다")
        self.assertEqual(S.split_log(S.LOG_HEADER + "\r\na\rb\n"), ["a", "b"])
        newer = '{"format":"mylearner-log","min_reader":2,"version":2}'
        with self.assertRaises(S.StorageError):
            S.split_log(newer + "\nx\n")
        self.d.log_path.write_text(newer + "\nx\n", encoding="utf-8")
        with self.assertRaises(S.StorageError):
            self.d.append(["y"])
        self.assertEqual(self.d.log_path.read_text(encoding="utf-8"), newer + "\nx\n", "더 새 판의 파일을 낮춰 쓰지 않는다")

    def test_review_s5_daily_backup_failure_does_not_block(self):   # 독립 점검 S5
        self.d.append(["a"])
        self.day[0] = dt.date(2026, 11, 10)
        real = self.d._backup_locked
        def boom(*a, **k):
            raise OSError("디스크")
        self.d._backup_locked = boom
        try:
            self.assertEqual(self.d.append(["b"]), (1, 2), "하루 백업이 실패해도 기록은 쓴다")
        finally:
            self.d._backup_locked = real

    def test_review_s6_new_backup_survives_clock_back(self):   # 독립 점검 S6
        self.d.append(["a"])
        for i in range(20):
            self.clock[0] = dt.datetime(2026, 11, 9, 3, 0, i)
            self.d.backup("import-mwl")
        self.clock[0] = dt.datetime(2020, 1, 1)
        name = self.d.backup("import-mwl")
        names = [b["name"] for b in self.d.list_backups()]
        self.assertIn(name, names)
        self.assertEqual(len(names), 20)
        self.assertEqual(S.prune(["20200101T000000000Z-daily"] + ["202611%02dT000000000Z-daily" % i for i in range(1, 15)], keep="20200101T000000000Z-daily"),
                         ["20261101T000000000Z-daily"])

    def test_review_s4_one_server_per_data_folder(self):   # 독립 점검 S4
        import subprocess
        import sys
        self.d.lock_process()
        code = ("import sys; sys.path.insert(0, %r); from mylearner.storage import DataDir, StorageError\n"
                "try:\n    DataDir(%r).lock_process(); print('locked')\nexcept StorageError as e:\n    print('refused')") % (
            str(Path(__file__).resolve().parents[3]), str(self.tmp / "data"))
        out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30).stdout.strip()
        self.assertEqual(out, "refused", "다른 프로세스는 같은 데이터 폴더를 잠글 수 없다")
        self.d._lockfile.close()
        out2 = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30).stdout.strip()
        self.assertEqual(out2, "locked", "놓으면 잠글 수 있다")

    def test_parallel_appends_lose_nothing(self):
        def worker(k):
            for i in range(30):
                self.d.append(["w%d-%d" % (k, i), "shared-%d" % i])
        ts = [threading.Thread(target=worker, args=(k,)) for k in range(4)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        lines = self.d.log_text().splitlines()[1:]
        self.assertEqual(len(lines), 4 * 30 + 30)
        self.assertEqual(len(set(lines)), len(lines))


if __name__ == "__main__":
    unittest.main()
