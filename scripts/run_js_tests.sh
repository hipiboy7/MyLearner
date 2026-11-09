#!/usr/bin/env bash
# JS 시험을 Docker(Node 22)에서 돌린다 — 개발 VM 에는 Node 가 없다(CLAUDE.md 0절).
# 사용: bash scripts/run_js_tests.sh                  # 단위·통합 전체 + 커버리지(web/core 줄 90%·분기 80% 미만이면 실패)
#       bash scripts/run_js_tests.sh tests/unit/js/srs.test.js   # 고른 파일만(커버리지 기준 없이)
# 문서: docs/P2_요구사항정의서_Core.md FR-203, docs/P2_설계서_Core.md 6절
set -u
cd "$(dirname "$0")/.." || exit 1
. scripts/dev_tools.env
RUN=(docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/w:ro" -w /w "$NODE_IMAGE")
if [ $# -gt 0 ]; then
  exec "${RUN[@]}" node --test "$@"
fi
exec "${RUN[@]}" node --test --experimental-test-coverage --test-coverage-include='web/core/**' --test-coverage-include='web/store/**' --test-coverage-exclude='web/store/idb.js' \
  --test-coverage-lines=90 --test-coverage-branches=80 'tests/unit/js/**/*.test.js' 'tests/integration/js/**/*.test.js'
