"""MyLearner 명령 — `py -3 -m mylearner serve` (Windows) · `python3 -m mylearner serve` (그 밖).

serve [--port N] [--data 폴더] [--web 폴더] [--config 파일] [--no-browser]
  127.0.0.1 에 로컬 서버를 켜고 토큰이 붙은 주소를 찍은 뒤, 브라우저는 한 번 쓰는 주소(?once=)로 연다(토큰을 브라우저 명령줄에 싣지 않는다). Ctrl+C 로 끈다.
  판 설정을 찾지 못하면 내보내기 없는 판으로 켠다(fail-closed).
  기본값: 웹 폴더 = 이 패키지 옆 web/, 데이터 폴더 = 옆 data/, 판 설정 = 옆 config.json(묶음) → 저장소의 config/editions/internet.json(개발)
  포트 = 판 설정 server.port(MWL 기본 8765 와 다르다 — 병행). 출력은 cp949 로 나타낼 수 있는 글자만(한국어 Windows 콘솔)
입력: 명령줄 / 출력: 서버(끌 때까지) / 트리거: 사용자, 묶음의 MyLearner.cmd
문서: docs/P3_요구사항정의서_PC.md FR-330, docs/P3_설계서_PC.md 3.3절
"""
from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from pathlib import Path

from mylearner import __version__
from mylearner.server import AppState, make_server
from mylearner.storage import DataDir, StorageError

HERE = Path(__file__).resolve().parent
# 판 설정을 찾지 못하면 내보내기 없는 쪽으로(fail-closed — 독립 점검 V1). 폐쇄망판 묶음에서 config.json 이 빠져도 내보내기가 열리지 않게
DEFAULT_EDITION = {"edition": "unknown", "label": "판 설정 없음", "export": False, "link_hosts": [], "server": {"port": 8770}, "ai_presets": []}


def load_edition(path) -> dict:
    candidates = [Path(path)] if path else [HERE.parent / "config.json", HERE.parent / "config" / "editions" / "internet.json"]
    for p in candidates:
        if p.is_file():
            data = json.loads(p.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("edition"), str):
                raise SystemExit("판 설정이 틀렸습니다: %s" % p)
            return data
    if path:
        raise SystemExit("판 설정 파일이 없습니다: %s" % path)
    print("판 설정(config.json)을 찾지 못해 내보내기 없는 판으로 켭니다")
    return dict(DEFAULT_EDITION)


def build(argv=None):
    ap = argparse.ArgumentParser(prog="python -m mylearner", description="MyLearner 로컬 서버")
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("serve", help="로컬 서버를 켠다")
    s.add_argument("--port", type=int, default=None)
    s.add_argument("--data", default=None)
    s.add_argument("--web", default=None)
    s.add_argument("--config", default=None)
    s.add_argument("--no-browser", action="store_true")
    sub.add_parser("version", help="판을 찍는다")
    return ap, ap.parse_args(argv)


def safe_output() -> None:
    """파이프·파일로 나갈 때 그 인코딩에 없는 글자(영문 Windows 의 cp1252 에서 한글 등)를 ? 로 — 출력 때문에 서버가 죽지 않게(P4 FR-470, MWL T-036).
    콘솔 창은 Python 이 유니코드로 쓰므로 그대로다."""
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass


def main(argv=None, run=None) -> int:
    """run: 시험이 서버를 받아 돌리고 끈다(없으면 serve_forever)."""
    safe_output()
    ap, args = build(argv)
    if args.cmd == "version":
        print("MyLearner %s" % __version__)
        return 0
    if args.cmd != "serve":
        ap.print_help()
        return 2
    edition = load_edition(args.config)
    port = args.port if args.port is not None else int((edition.get("server") or {}).get("port") or 8770)
    if not 1 <= port <= 65535:
        print("포트는 1~65535 입니다")
        return 2
    web = Path(args.web) if args.web else HERE.parent / "web"
    if not (web / "index.html").is_file():
        print("웹 폴더가 없습니다: %s" % web)
        return 2
    data = DataDir(Path(args.data) if args.data else HERE.parent / "data")
    try:
        data.lock_process()   # 같은 데이터 폴더를 서버 둘이 쓰지 않게(독립 점검 S4)
    except StorageError as e:
        print(str(e))
        return 1
    state = AppState(web, data, edition, data.token())
    try:
        server = make_server(state, port)
    except OSError as e:
        print("포트 %d 를 열 수 없습니다(이미 켜져 있나요?): %s" % (port, e.strerror or e))
        return 1
    url = "http://127.0.0.1:%d/?token=%s" % (port, state.token)
    print("MyLearner %s %s - %s" % (__version__, edition.get("label", ""), url))
    # 브라우저에는 한 번 쓰는 주소를 준다 — 브라우저 명령줄은 같은 컴퓨터의 다른 계정에게 ps 로 보인다(독립 점검 V2)
    open_url = "http://127.0.0.1:%d/?once=%s" % (port, state.new_once())
    print("데이터 폴더: %s" % data.root.resolve())
    print("끄려면 이 창에서 Ctrl+C")
    sys.stdout.flush()
    if not args.no_browser:
        try:
            webbrowser.open(open_url)
        except Exception:   # 브라우저를 못 열어도 주소를 찍었다 — 사용자가 연다
            pass
    try:
        (run or (lambda srv: srv.serve_forever()))(server)
    except KeyboardInterrupt:
        print("끕니다")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
