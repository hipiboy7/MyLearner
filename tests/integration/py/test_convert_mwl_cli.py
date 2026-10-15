"""등급 B — python3 -m mylearner.convert.mwl 명령(FR-260). 실제 하위 프로세스로 부른다. 2026-10-15."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.support_mwl import make_content, write

ROOT = Path(__file__).resolve().parents[3]


def run(*args):
    env = dict(os.environ, PYTHONIOENCODING="cp949")   # 한국어 Windows 콘솔에서 깨지는 글자를 쓰지 않는다(NFR-205)
    return subprocess.run([sys.executable, "-m", "mylearner.convert.mwl"] + list(args), cwd=str(ROOT), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, env=env)


class ConvertCliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.content = make_content(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_converts_and_reports(self):
        out = self.root / "out" / "mwl.course.json"
        r = run("--content", str(self.content), "--ref", "MiddlewareLearner@e55b9c0", "--out", str(out))
        self.assertEqual(r.returncode, 0, r.stderr)
        line = r.stdout.decode("cp949")
        self.assertIn("과정 mwl: 강의 3 · 카드 3 · 실습 1 · 드릴 1 · 퀴즈 1 · 용어 2 · 진단 1 -> mwl.course.json", line)
        self.assertNotIn(str(self.root), line, "경로를 찍지 않는다")
        first = out.read_bytes()
        self.assertEqual(json.loads(first)["id"], "mwl")
        r2 = run("--content", str(self.content), "--ref", "MiddlewareLearner@e55b9c0", "--out", str(out))
        self.assertEqual(r2.returncode, 0)
        self.assertEqual(out.read_bytes(), first, "같은 입력 = 같은 바이트")
        self.assertEqual(sorted(p.name for p in out.parent.iterdir()), ["mwl.course.json"], "임시 파일을 남기지 않는다")

    def test_bad_ref_and_missing_dir(self):
        out = self.root / "x.json"
        for ref in ("C:\\Users\\me", "a b", "x" * 81, "http://192.0.2.10/"):
            r = run("--content", str(self.content), "--ref", ref, "--out", str(out))
            self.assertEqual(r.returncode, 2, ref)
        self.assertEqual(run("--content", str(self.root / "none"), "--ref", "r", "--out", str(out)).returncode, 2)
        self.assertFalse(out.exists())
        self.assertNotEqual(run("--content", str(self.content), "--ref", "r", "--out", str(out), "--outp", "x").returncode, 0)

    def test_content_errors_write_nothing(self):
        write(self.content, "cards/C.json", "{not json")
        out = self.root / "x.json"
        r = run("--content", str(self.content), "--ref", "r", "--out", str(out))
        self.assertEqual(r.returncode, 1)
        self.assertIn("MWL 내용 오류 1개", r.stdout.decode("cp949"))
        self.assertIn("cards/C.json", r.stdout.decode("cp949"))
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
