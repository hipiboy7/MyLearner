#!/usr/bin/env bash
# 전체 검증 명령 (FR-102, CLAUDE.md 1절 9단계) — 모든 관문을 돌리고 표로 요약한다. 하나라도 실패하면 종료 코드 1.
# 실패해도 끝까지 돌린다. 커밋은 이 명령이 종료 코드 0 일 때만 한다: bash scripts/verify.sh > 로그 && git commit ...
#
# 사용: bash scripts/verify.sh            # 전체
#       bash scripts/verify.sh --quick    # 느린 Docker 단계(Python 3.12·3.14 시험·Chromium 세 단계)를 뺀다. Node 단계는 돈다
#       bash scripts/verify.sh --release  # 설계 문서까지 문서 검사(배포 전)
# 단계: 0 환경 · 1 시험 3.9 · 2 시험 3.11 · 3 시험 3.12(Docker) · 4 시험 3.14(Docker, DeprecationWarning 은 실패)
#       · 5 3.9 문법 · 6 커버리지 · 7 문서 · 8 공개 전 점검 · 9 브라우저 점검 정적 검사 · 10 브라우저 스모크(Chromium)
#       · 11 반입 묶음 재현성·외부 URL 0
#       · 12 시험 JS(Node 22, web/core 줄 커버리지 90%) · 13 core JS 정적 검사 · 14 골든 벡터 복사본(MWL 기준 커밋)
#       · 15 기록 왕복(S3, 실제 파일) · 16 MWL 실데이터 대조(MWL 저장소가 없으면 건너뜀) · 17 렌더러 Chromium(XSS)
#       · 18 앱 묶음 재현·판별(폐쇄망판 외부 URL 0·내보내기 꺼짐) · 19 화면 스모크(Chromium — file://·서버 모드, 접근성, 다시 연 뒤 남음, 합치기·되살리기·폰 폭)
#       · 20 워크플로 정적 검사(P4) · 21 묶음 실기(Linux — Windows 는 Actions) · 22 APK 빌드·권한 0·재현(Docker, 시험 키 — P4)
# 문서: docs/P1_요구사항정의서_Probe.md FR-102, docs/P1_테스트결과서_Probe.md 1절, docs/P2_테스트결과서_Core.md 1절, docs/P3_테스트결과서_PC.md 1절, docs/P4_테스트결과서_Mobile.md 1절
set -u
cd "$(dirname "$0")/.." || exit 1
. scripts/dev_tools.env
QUICK=0; RELEASE=0
for a in "$@"; do
  case "$a" in
    --quick) QUICK=1 ;;
    --release) RELEASE=1 ;;
    *) echo "알 수 없는 옵션: $a"; exit 2 ;;
  esac
done
LOG=$(mktemp -d)
NAMES=(); RESULTS=(); SECS=(); FAILED=0

run() { # run <이름> <명령...>
  local name="$1"; shift
  local start end rc out
  start=$(date +%s)
  out="$LOG/$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_').log"
  if "$@" > "$out" 2>&1; then rc=0; else rc=$?; fi
  end=$(date +%s)
  NAMES+=("$name"); SECS+=($((end - start)))
  if [ $rc -eq 0 ]; then RESULTS+=("통과"); else RESULTS+=("실패($rc)"); FAILED=$((FAILED + 1)); fi
  printf '  %-30s %-8s %ss\n' "$name" "${RESULTS[${#RESULTS[@]}-1]}" "$((end - start))"
  [ $rc -ne 0 ] && tail -8 "$out" | sed 's/^/      /'
  return 0
}
skip() { NAMES+=("$1"); RESULTS+=("건너뜀"); SECS+=(0); printf '  %-30s 건너뜀 (%s)\n' "$1" "$2"; }

PYTESTS='python3 -m unittest discover -s tests/unit/py -t . && python3 -m unittest discover -s tests/integration/py -t .'
echo "== MyLearner 전체 검증 $(date '+%Y-%m-%d %H:%M')$([ $QUICK = 1 ] && echo ' (quick)')$([ $RELEASE = 1 ] && echo ' (release)')"
if [ $QUICK = 1 ]; then run "0 환경 확인" bash scripts/check_env.sh --quick; else run "0 환경 확인" bash scripts/check_env.sh; fi
run "1 시험 Python 3.9" bash -c "$PYTESTS"
if [ -x /usr/bin/python3.11 ]; then
  run "2 시험 Python 3.11" bash -c "${PYTESTS//python3 /\/usr\/bin\/python3.11 }"
else
  skip "2 시험 Python 3.11" "/usr/bin/python3.11 없음"
fi
if [ $QUICK = 0 ]; then
  run "3 시험 Python 3.12(Docker)" docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 \
      -v "$PWD:/w:ro" -w /w "$PLAYWRIGHT_IMAGE" bash -c "$PYTESTS"
else
  skip "3 시험 Python 3.12(Docker)" "quick"
fi
if [ $QUICK = 0 ]; then
  # 폐쇄망 PC 의 기본 판. 다음 판에서 없어질 API 를 일찍 잡으려고 DeprecationWarning 을 오류로 본다(시험이 띄우는 하위 프로세스도)
  run "4 시험 Python 3.14(Docker)" docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 \
      -e PYTHONWARNINGS=error::DeprecationWarning -v "$PWD:/w:ro" -w /w "$PY314_IMAGE" bash -c "$PYTESTS"
else
  skip "4 시험 Python 3.14(Docker)" "quick"
fi
PY_NEW=python3; [ -x /usr/bin/python3.11 ] && PY_NEW=/usr/bin/python3.11
run "5 3.9 문법(ai_probe)" "$PY_NEW" -c "import ast; ast.parse(open('tools/ai_probe.py', encoding='utf-8').read(), feature_version=(3, 9))"
run "6 커버리지(A>=90 B>=70)" python3 scripts/coverage_lite.py --enforce
if [ $RELEASE = 1 ]; then run "7 문서 검사(release)" python3 scripts/verify_docs.py --release; else run "7 문서 검사" python3 scripts/verify_docs.py; fi
run "8 공개 전 점검" python3 scripts/check_publish_safety.py
run "9 브라우저 점검 정적 검사" python3 scripts/check_probe_html.py
if [ $QUICK = 0 ]; then run "10 브라우저 스모크(Chromium)" python3 scripts/browser_smoke.py; else skip "10 브라우저 스모크(Chromium)" "quick"; fi
run "11 반입 묶음 재현·외부 URL 0" python3 scripts/pack_probe.py --check
run "12 시험 JS(Node 22)+커버리지" bash scripts/run_js_tests.sh
run "13 웹 JS 정적 검사" python3 scripts/check_core_js.py
run "14 골든 벡터 복사본(MWL)" python3 scripts/import_mwl_fixtures.py --check
run "15 기록 왕복(S3)" docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/w:ro" -w /w "$NODE_IMAGE" node scripts/check_log_roundtrip.js
if [ -d "${MWL_REPO:-/nonexistent}/.git" ]; then
  run "16 MWL 실데이터 대조" python3 scripts/check_mwl_real.py
else
  skip "16 MWL 실데이터 대조" "MWL 저장소 없음(${MWL_REPO:-})"
fi
if [ $QUICK = 0 ]; then run "17 렌더러 Chromium(XSS)" python3 scripts/render_smoke.py; else skip "17 렌더러 Chromium(XSS)" "quick"; fi
run "18 앱 묶음 재현·판별" python3 scripts/pack_app.py --check
if [ $QUICK = 0 ]; then run "19 화면 스모크(Chromium)" python3 scripts/app_smoke.py; else skip "19 화면 스모크(Chromium)" "quick"; fi
run "20 워크플로 정적 검사" python3 scripts/check_workflows.py
run "21 묶음 실기(Linux)" python3 scripts/ci_windows_bundle.py
if [ $QUICK = 0 ]; then
  run "22 APK 빌드·권한 0·재현" bash scripts/build_android.sh --courses tests/fixtures/mwl/scheduler_course.json --test-key --repro --out "$LOG/android"
else
  skip "22 APK 빌드·권한 0·재현" "quick"
fi

echo
printf '%-30s %-8s %s\n' "단계" "결과" "초"
for i in "${!NAMES[@]}"; do printf '%-30s %-8s %s\n' "${NAMES[$i]}" "${RESULTS[$i]}" "${SECS[$i]}"; done
echo "로그: $LOG"
if [ $FAILED -eq 0 ]; then echo "전체 통과 (${#NAMES[@]}단계)"; else echo "실패 $FAILED / ${#NAMES[@]}단계 - 위 로그를 보세요"; fi
exit $((FAILED > 0 ? 1 : 0))
