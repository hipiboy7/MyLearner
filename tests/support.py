"""시험 공용 — 단독 도구(tools/)를 모듈로 불러온다.

tools/ 는 패키지가 아니다(폐쇄망에 파일 하나로 들고 간다). 시험은 경로를 sys.path 에 넣고 이름으로 불러온다.
coverage_lite.py 는 파일 경로로 줄을 세므로 이렇게 불러도 측정된다.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"


def load_ai_probe():
    if str(TOOLS) not in sys.path:
        sys.path.insert(0, str(TOOLS))
    import ai_probe  # noqa: E402
    return ai_probe
