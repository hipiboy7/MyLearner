"""scripts/usage_cost.py — Claude Code 사용 비용 누적 (CLAUDE.md 11절 '비용 보고').

가짜 대화 기록(임시 폴더)으로 본다: 마지막 cost-state 값, 그 뒤 대화의 추정, 같은 응답 중복, 기준점(refresh) 빼기, 기록 파일.
"""
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load():
    spec = importlib.util.spec_from_file_location("mlscript_usage_cost", ROOT / "scripts" / "usage_cost.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


U = load()
PRICES = U.load_prices(ROOT / "scripts" / "usage_prices.json")
OPUS = "claude-opus-5-5"


def cost_state(total, models):
    return {"type": "cost-state", "totalCostUSD": total,
            "modelUsage": {m: {"costUSD": c, "outputTokens": 100, "thinkingTokens": 60} for m, c in models.items()}}


def reply(mid, model=OPUS, ts="2026-10-15T01:00:00Z", effort="max", **usage):
    u = {"input_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0, "output_tokens": 0}
    u.update(usage)
    return {"type": "assistant", "timestamp": ts, "effort": effort,
            "message": {"id": mid, "model": model, "usage": u}}


class EstimateTest(unittest.TestCase):
    def test_opus_rates(self):
        u = {"input_tokens": 1000, "cache_read_input_tokens": 10000, "output_tokens": 1000,
             "cache_creation_input_tokens": 1000,
             "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 1000}}
        self.assertAlmostEqual(U.estimate(OPUS, u, PRICES), (4000 + 8000 + 2000 + 20000) / 1e6)

    def test_creation_without_breakdown_is_5m(self):
        u = {"cache_creation_input_tokens": 1_000_000}
        self.assertAlmostEqual(U.estimate(OPUS, u, PRICES), 5.0)

    def test_haiku_long_prompt_tier(self):
        short = {"input_tokens": 100_000, "output_tokens": 0}
        long_ = {"input_tokens": 100_001, "output_tokens": 0}
        self.assertAlmostEqual(U.estimate("claude-haiku-5-5", short, PRICES), 0.01)
        self.assertAlmostEqual(U.estimate("claude-haiku-5-5", long_, PRICES), 100_001 * 0.50 / 1e6)

    def test_unknown_model_is_none(self):
        self.assertIsNone(U.estimate("claude-new-9", {"output_tokens": 5}, PRICES))


class SessionTest(unittest.TestCase):
    def test_recorded_plus_tail_without_double_count(self):
        rows = [reply("m1", output_tokens=999_999),          # cost-state 가 이미 셌다
                cost_state(3.0, {OPUS: 2.5, "claude-haiku-5-5": 0.5}),
                reply("m1", output_tokens=999_999),          # 같은 응답의 다음 블록 — 이미 셌다
                reply("m2", output_tokens=10),               # 스트리밍 중간 값
                reply("m2", output_tokens=1000, ts="2026-10-15T02:00:00Z")]
        s = U.read_session("abc", rows, PRICES)
        self.assertAlmostEqual(s["recorded"], 3.0)
        self.assertAlmostEqual(s["tail"], 1000 * 20 / 1e6)
        self.assertAlmostEqual(s["models"][OPUS], 2.5 + 0.02)
        self.assertEqual(s["efforts"], {"max"})
        self.assertEqual(s["end"], "2026-10-15T02:00:00Z")

    def test_no_cost_state_is_all_tail(self):
        s = U.read_session("x", [reply("a", output_tokens=1_000_000)], PRICES)
        self.assertEqual(s["recorded"], 0)
        self.assertAlmostEqual(s["tail"], 20.0)

    def test_unknown_model_is_flagged_not_fatal(self):
        s = U.read_session("x", [reply("a", model="claude-new-9", output_tokens=5)], PRICES)
        self.assertEqual(s["unknown"], {"claude-new-9"})
        self.assertEqual(s["tail"], 0)


class BaselineTest(unittest.TestCase):
    def test_since_baseline_subtracts_snapshot(self):
        sessions = [{"id": "old", "models": {OPUS: 5.0}}, {"id": "live", "models": {OPUS: 3.0, "s": 1.0}},
                    {"id": "new", "models": {OPUS: 2.0}}]
        base = {"old": {OPUS: 5.0}, "live": {OPUS: 1.0}}
        got = U.since_baseline(sessions, base)
        self.assertEqual(got, {"live": {OPUS: 2.0, "s": 1.0}, "new": {OPUS: 2.0}})


class CliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name) / "proj"
        self.dir.mkdir()
        (self.dir / "sub").mkdir()
        self.ledger = Path(self.tmp.name) / "ledger.json"
        self.write("s1", [cost_state(7.5, {OPUS: 7.5})])
        self.write("s2", [cost_state(2.0, {OPUS: 2.0}), reply("z", output_tokens=50_000)])
        self.write("empty", [cost_state(0, {})])
        (self.dir / "sub" / "agent.jsonl").write_text(json.dumps(reply("q", output_tokens=10**7)) + "\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, rows):
        text = "\n".join(json.dumps(r) for r in rows) + "\nnot json\n"
        (self.dir / (name + ".jsonl")).write_text(text, encoding="utf-8")

    def run_cli(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = U.main(["--dir", str(self.dir), "--ledger", str(self.ledger), *args])
        return rc, out.getvalue()

    def test_report_total_and_record_and_refresh(self):
        rc, out = self.run_cli("--record")
        self.assertEqual(rc, 0)
        self.assertIn("$10.50", out)                       # 7.5 + 2.0 + 추정 1.0, 하위 폴더(서브에이전트)는 부모 cost-state 에 들어 있다
        self.assertNotIn("empty", out)
        led = json.loads(self.ledger.read_text(encoding="utf-8"))
        self.assertEqual(len(led["records"]), 1)
        self.assertAlmostEqual(led["records"][0]["since_baseline_usd"], 10.5)
        self.assertAlmostEqual(led["records"][0]["estimated_usd"], 1.0)

        rc, out = self.run_cli("--refresh")
        self.assertEqual(rc, 0)
        self.assertIn("$0.00", out)
        led = json.loads(self.ledger.read_text(encoding="utf-8"))
        self.assertEqual(led["records"], [])
        self.assertAlmostEqual(led["baseline"]["sessions"]["s1"][OPUS], 7.5)

        self.write("s3", [cost_state(1.25, {OPUS: 1.25})])
        rc, out = self.run_cli()
        self.assertIn("$1.25", out)

    def test_missing_dir_is_error(self):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = U.main(["--dir", str(self.dir / "none"), "--ledger", str(self.ledger)])
        self.assertEqual(rc, 2)

    def test_project_dir_slug(self):
        self.assertEqual(U.project_dir(Path("/data/projects/MyLearner"), Path("/h")),
                         Path("/h/.claude/projects/-data-projects-MyLearner"))


if __name__ == "__main__":
    unittest.main()
