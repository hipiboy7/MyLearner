#!/usr/bin/env python3
"""Claude Code 사용 비용 누적 — 이 저장소에서 쓴 비용을 API 정가 달러로 모은다 (CLAUDE.md 11절 '비용 보고').

입력:  ~/.claude/projects/<저장소 경로의 영숫자 아닌 글자를 - 로>/*.jsonl — Claude Code 가 세션마다 남기는 cost-state 의
       마지막 값(/cost 와 같은 계산. 서브에이전트·보조 모델 포함). 그 뒤에 이어진 대화(진행 중 세션)는 응답의 usage 로 추정한다
       history/usage_ledger.json — 기준점(refresh 한 때 세션별·모델별 값)과 보고 기록
       scripts/usage_prices.json — 추정에 쓰는 단가
출력:  표(표준 출력). --record 면 기록 파일에 보고 한 줄을 더하고, --refresh 면 기준점을 지금으로 옮기고 기록을 비운다
트리거: 작업 시작 전 또는 완료 후 결과 보고(CLAUDE.md 11절)
한계:  VM 계정마다 기록이 따로다(이 계정 것만). 정가 환산이라 실제 청구(구독·할인)와 다를 수 있다. 추정분에는 마지막
       cost-state 뒤의 서브에이전트·보조 모델 호출이 빠진다. effort 는 단가를 바꾸지 않고 생각 토큰(출력 값)으로 비용에 들어간다
사용: python3 scripts/usage_cost.py [--record] [--refresh] [--dir D] [--ledger F]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRICES_FILE = ROOT / "scripts" / "usage_prices.json"
LEDGER_FILE = ROOT / "history" / "usage_ledger.json"


def project_dir(repo: Path, home: Path) -> Path:
    return home / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(repo))


def load_prices(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["models"]


def estimate(model: str, usage: dict, prices: dict):
    """응답 하나의 usage → 달러. 모르는 모델이면 None."""
    p = prices.get(model)
    if p is None:
        return None
    cc = usage.get("cache_creation") or {}
    w1 = cc.get("ephemeral_1h_input_tokens", 0)
    w5 = cc.get("ephemeral_5m_input_tokens", 0) if cc else usage.get("cache_creation_input_tokens", 0)
    inp, read, out = usage.get("input_tokens", 0), usage.get("cache_read_input_tokens", 0), usage.get("output_tokens", 0)
    over = p.get("over")
    if over and inp + read + w1 + w5 > over["tokens"]:
        p = over
    return (inp * p["input"] + w5 * p["write_5m"] + w1 * p["write_1h"] + read * p["read"] + out * p["output"]) / 1e6


def read_session(sid: str, rows, prices: dict) -> dict:
    """대화 기록 한 파일 → 마지막 cost-state 값 + 그 뒤 응답(같은 id 는 마지막 것 하나)의 추정."""
    rows = list(rows)
    last = max((i for i, r in enumerate(rows) if r.get("type") == "cost-state"), default=-1)
    models, out_tok, think_tok = {}, 0, 0
    recorded = 0.0
    if last >= 0:
        cs = rows[last]
        recorded = float(cs.get("totalCostUSD") or 0)
        for m, v in (cs.get("modelUsage") or {}).items():
            models[m] = float(v.get("costUSD") or 0)
            out_tok += v.get("outputTokens") or 0
            think_tok += v.get("thinkingTokens") or 0
    counted, tail_msgs, efforts, start, end = set(), {}, set(), None, None
    for i, r in enumerate(rows):
        ts = r.get("timestamp")
        if ts:
            start, end = start or ts, ts
        if r.get("type") != "assistant":
            continue
        msg = r.get("message") or {}
        if r.get("effort"):
            efforts.add(r["effort"])
        if i < last:
            counted.add(msg.get("id"))
        elif msg.get("usage") and msg.get("id") not in counted and not str(msg.get("model")).startswith("<"):   # <synthetic> = 오류 알림
            tail_msgs[msg.get("id")] = (msg.get("model"), msg["usage"])
    tail, unknown = 0.0, set()
    for model, usage in tail_msgs.values():
        usd = estimate(model, usage, prices)
        if usd is None:
            unknown.add(model)
            continue
        tail += usd
        models[model] = models.get(model, 0.0) + usd
        out_tok += usage.get("output_tokens", 0)
        think_tok += (usage.get("output_tokens_details") or {}).get("thinking_tokens", 0)
    return {"id": sid, "recorded": recorded, "tail": tail, "models": models, "unknown": unknown, "efforts": efforts,
            "start": start, "end": end, "out": out_tok, "think": think_tok}


def since_baseline(sessions, base: dict) -> dict:
    """세션별·모델별 지금 값 - 기준점 값. 0 이하는 뺀다."""
    got = {}
    for s in sessions:
        b = base.get(s["id"], {})
        d = {m: round(v - b.get(m, 0.0), 6) for m, v in s["models"].items()}
        d = {m: v for m, v in d.items() if v > 1e-6}
        if d:
            got[s["id"]] = d
    return got


def read_dir(d: Path, prices: dict):
    sessions = []
    for f in sorted(d.glob("*.jsonl")):          # 하위 폴더(서브에이전트)는 부모 세션 cost-state 에 들어 있다
        rows = []
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
        sessions.append(read_session(f.stem, rows, prices))
    return sessions


def _local(ts):
    if not ts:
        return "?"
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().strftime("%m-%d %H:%M")


def _short(model: str) -> str:
    return model[len("claude-"):] if model.startswith("claude-") else model


def render(sessions, delta: dict, ledger: dict) -> str:
    now = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")
    base_time = ledger["baseline"].get("time")
    lines = ["Claude Code 사용 비용 - API 정가 환산 (%s)" % now,
             "기준점: %s" % ("처음부터" if not base_time else base_time + " refresh"),
             "%-9s %-25s %9s %8s  %s" % ("세션", "기간", "비용$", "추정$", "모델별 / effort")]
    total, est, by_model, out_tok, think_tok, unknown = 0.0, 0.0, {}, 0, 0, set()
    for s in sorted(sessions, key=lambda x: x["start"] or ""):
        d = delta.get(s["id"])
        if not d:
            continue
        cost = sum(d.values())
        tail = min(s["tail"], cost)
        total, est = total + cost, est + tail
        out_tok, think_tok, unknown = out_tok + s["out"], think_tok + s["think"], unknown | s["unknown"]
        for m, v in d.items():
            by_model[m] = by_model.get(m, 0.0) + v
        models = " · ".join("%s %.2f" % (_short(m), v) for m, v in sorted(d.items(), key=lambda x: -x[1]))
        lines.append("%-9s %-25s %9.2f %8s  %s / %s" % (s["id"][:8], "%s ~ %s" % (_local(s["start"]), _local(s["end"])),
                                                       cost, "%.2f" % tail if tail > 0.005 else "",
                                                       models, ",".join(sorted(s["efforts"])) or "?"))
    lines.append("기준점 뒤 누적: $%.2f (Claude Code 기록 %.2f + 추정 %.2f)" % (total, total - est, est))
    if by_model:
        lines.append("모델별: " + " · ".join("%s $%.2f" % (_short(m), v) for m, v in sorted(by_model.items(), key=lambda x: -x[1])))
    if out_tok:
        lines.append("출력 토큰 중 생각 토큰(effort 영향): %d%% (%d / %d, 포함 세션 전체)" % (100 * think_tok // out_tok, think_tok, out_tok))
    if unknown:
        lines.append("단가 모름(추정에서 빠짐): %s - scripts/usage_prices.json 에 더한다" % ", ".join(sorted(unknown)))
    return "\n".join(lines)


def load_ledger(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"_comment": "scripts/usage_cost.py 가 쓴다. baseline = refresh 한 때 세션별·모델별 누적 $, records = 보고 때 기준점 뒤 누적",
            "baseline": {"time": None, "sessions": {}}, "records": []}


def save_ledger(path: Path, ledger: dict) -> None:
    path.write_text(json.dumps(ledger, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Claude Code 사용 비용 누적(API 정가 달러)")
    ap.add_argument("--dir", type=Path, default=project_dir(ROOT, Path.home()), help="대화 기록 폴더")
    ap.add_argument("--ledger", type=Path, default=LEDGER_FILE)
    ap.add_argument("--record", action="store_true", help="보고 한 줄을 기록 파일에 더한다")
    ap.add_argument("--refresh", action="store_true", help="기준점을 지금으로 옮기고 기록을 비운다(사용자가 요청할 때만)")
    a = ap.parse_args(argv)
    if not a.dir.is_dir():
        print("대화 기록 폴더가 없습니다: %s" % a.dir)
        return 2
    sessions = read_dir(a.dir, load_prices(PRICES_FILE))
    ledger = load_ledger(a.ledger)
    stamp = datetime.now().astimezone().isoformat(timespec="minutes")
    if a.refresh:
        ledger["baseline"] = {"time": stamp, "sessions": {s["id"]: {m: round(v, 6) for m, v in s["models"].items()}
                                                          for s in sessions if s["models"]}}
        ledger["records"] = []
    delta = since_baseline(sessions, ledger["baseline"]["sessions"])
    print(render(sessions, delta, ledger))
    if a.record:
        total = sum(sum(d.values()) for d in delta.values())
        est = sum(min(s["tail"], sum(delta[s["id"]].values())) for s in sessions if s["id"] in delta)
        ledger["records"].append({"time": stamp, "since_baseline_usd": round(total, 2), "estimated_usd": round(est, 2)})
    if a.record or a.refresh:
        save_ledger(a.ledger, ledger)
    return 0


if __name__ == "__main__":
    sys.exit(main())
