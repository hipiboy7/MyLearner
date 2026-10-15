#!/usr/bin/env bash
# 개발 환경 확인 (FR-101, CLAUDE.md 1절 0단계). 마지막 줄이 READY 또는 NOT READY 다.
# 입력:  없음(이 VM 의 환경). --quick 이면 Docker 를 필수로 보지 않는다(scripts/verify.sh --quick 과 같이 쓴다)
# 출력:  항목마다 OK / NG / 참고. 종료 코드 0 = READY, 1 = NOT READY
# 문서:  docs/P1_요구사항정의서_Probe.md FR-101, docs/설계서_Architecture.md 7절(도구 판), scripts/dev_tools.env
set -u
cd "$(dirname "$0")/.." || exit 1
. scripts/dev_tools.env
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1
bad=0
ok()   { printf '  OK    %s\n' "$1"; }
ng()   { printf '  NG    %s\n' "$1"; bad=1; }
note() { printf '  참고  %s\n' "$1"; }

echo "== MyLearner 개발 환경 확인 $(date '+%Y-%m-%d %H:%M')$([ $QUICK = 1 ] && echo ' (quick)')"
ok "bash ${BASH_VERSION}"
if command -v git >/dev/null 2>&1; then ok "$(git --version)"; else ng "git 이 없다"; fi
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
  ok "python3 $(python3 -c 'import platform; print(platform.python_version())')"
else
  ng "python3 3.9 이상이 없다"
fi
if [ -x /usr/bin/python3.11 ]; then
  ok "python3.11 $(/usr/bin/python3.11 -c 'import platform; print(platform.python_version())') - 시험을 이 판으로도 돌린다"
else
  note "/usr/bin/python3.11 이 없다 - 그 판 시험은 건너뛴다"
fi
if command -v openssl >/dev/null 2>&1; then ok "openssl - TLS 시험용"; else note "openssl 이 없다 - TLS 시험은 건너뛴다"; fi
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
  if docker image inspect "$PLAYWRIGHT_IMAGE" >/dev/null 2>&1; then
    ok "이미지 $PLAYWRIGHT_IMAGE (브라우저 스모크·Python 3.12 시험)"
  elif [ $QUICK = 1 ]; then
    note "이미지 $PLAYWRIGHT_IMAGE 이 없다 - quick 이라 넘어간다"
  else
    ng "이미지 $PLAYWRIGHT_IMAGE 이 없다(약 3.5GB). df -h /data 로 여유를 본 뒤 docker pull 한다"
  fi
elif [ $QUICK = 1 ]; then
  note "docker 를 쓸 수 없다 - quick 이라 넘어간다"
else
  ng "docker 를 쓸 수 없다(브라우저 스모크·Python 3.12 시험에 필요)"
fi
free_kb=$(df -Pk . | awk 'NR==2 {print $4}')
if [ "${free_kb:-0}" -ge 2097152 ]; then
  ok "디스크 여유 $(df -Ph . | awk 'NR==2 {print $4}') (저장소가 있는 곳)"
else
  ng "디스크 여유가 2G 보다 적다"
fi
if tmp=$(mktemp -d 2>/dev/null) && rmdir "$tmp"; then ok "임시 폴더를 만들 수 있다"; else ng "임시 폴더를 만들 수 없다"; fi
if [ $bad -eq 0 ]; then echo "READY"; exit 0; else echo "NOT READY"; exit 1; fi
