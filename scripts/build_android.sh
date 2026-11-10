#!/usr/bin/env bash
# 안드로이드 앱 빌드(P4 FR-401·407·408, NFR-401·405) — APK 하나를 폰에 설치하면 인터넷 없이 MyLearner 화면 전체가 돈다(모바일판).
# 결과: dist/android/MyLearningPlatform-v<판>.apk (시험 키면 -test.apk). dist/ 는 커밋하지 않는다. 크기·SHA-256·서명 인증서 SHA-256 을 찍는다.
# 사용: bash scripts/build_android.sh [--courses F ...] [--test-key] [--debuggable] [--repro] [--init-key <사본 폴더>] [--out 폴더]
#   --courses F ...      싣는 과정 파일(기본 dist/courses/*.course.json — README 빠른 시작으로 만든다)
#   --test-key           실행 때 임시 폴더에 새 키를 만들어 서명하고 끝나면 지운다(Actions·에뮬레이터 시험용 — 폰에 덮어 설치되지 않는다)
#   --debuggable         디버그 표시(aapt2 --debug-mode) — 에뮬레이터 시험이 run-as 로 앱 파일을 읽는다. 릴리스에는 쓰지 않는다
#   --repro              한 번 더 빌드해 서명 전·후 APK 가 같은 바이트인지 본다
#   --init-key <폴더>    릴리스 키가 없을 때 한 번만: ~/.config/mylearner/ 에 새 키(RSA 3072·PKCS12)를 만들고 사본을 <폴더>(700)에 둔다(보류 결정 3)
# 빌드 도구: scripts/dev_tools.env 의 ANDROID_IMAGE(JDK·build-tools 36.0.0·android-36, Gradle 없음), 컨테이너는 --network none.
# 서명 키: 저장소 밖 $MYLEARNER_ANDROID_KEYS(기본 ~/.config/mylearner)/android-release.jks + .pass(600). 키 값·비밀번호는 화면·로그에 찍지 않는다.
# 순서: 과정 → web 사본(pack_app.py --edition mobile --web-out) → 셸 한 줄(pack.py stage) → (컨테이너) Policy·Kv 시험 → aapt2 → javac → d8
#       → dex 붙이기(pack.py add-dex) → (컨테이너) zipalign → apksigner(v2·v3) → 점검(pack.py check: 패키지·판·SDK·권한 0·exported 1·디버그 표시)
# MWL scripts/build_android.sh(MiddlewareLearner@e55b9c0)를 옮겨 고쳤다. 문서: docs/P4_설계서_Mobile.md 3.8절
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
. scripts/dev_tools.env
COURSES=(); TEST_KEY=0; DEBUG=0; REPRO=0; INIT=""; OUT=dist/android
while [ $# -gt 0 ]; do
  case "$1" in
    --courses) shift; while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do COURSES+=("$1"); shift; done; continue ;;
    --test-key) TEST_KEY=1 ;;
    --debuggable) DEBUG=1 ;;
    --repro) REPRO=1 ;;
    --init-key) shift; INIT=${1:?--init-key 뒤에 사본 폴더} ;;
    --out) shift; OUT=${1:?--out 뒤에 폴더} ;;
    *) echo "알 수 없는 옵션: $1"; exit 2 ;;
  esac
  shift
done
fail() { echo "실패: $*"; exit 1; }
command -v docker >/dev/null 2>&1 || fail "docker 없음 — 이 스크립트는 개발 VM·Actions 전용이다"
docker image inspect "$ANDROID_IMAGE" >/dev/null 2>&1 || fail "빌드 이미지가 없다: $ANDROID_IMAGE (bash scripts/check_env.sh 참고)"
if [ ${#COURSES[@]} -eq 0 ]; then
  for f in dist/courses/*.course.json; do [ -f "$f" ] && COURSES+=("$f"); done
fi
[ ${#COURSES[@]} -gt 0 ] || fail "과정 파일이 없다 — README 빠른 시작으로 dist/courses/ 를 만들거나 --courses 로 준다"
read -r VER CODE < <(python3 mobile/android/tools/pack.py version)
UIDGID="$(id -u):$(id -g)"
mkdir -p "$OUT"
echo "== MyLearningPlatform $VER (versionCode $CODE) · 과정 ${#COURSES[@]}개 · $([ $TEST_KEY = 1 ] && echo 시험 키 || echo 릴리스 키)$([ $DEBUG = 1 ] && echo ' · 디버그')"

newpass() {   # 비밀번호 파일을 600 으로 처음부터 만든다(화면에 찍지 않는다)
  python3 -c 'import os, secrets, sys
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.write(fd, secrets.token_urlsafe(24).encode()); os.close(fd)' "$1"
}
keygen() {   # keygen <폴더> <CN>
  docker run --rm --network none --user "$UIDGID" -e HOME=/tmp -v "$PWD:/src:ro" -v "$1:/keys" \
    "$ANDROID_IMAGE" sh /src/mobile/android/tools/docker-build.sh keygen "$2" >/dev/null
}

# 1) 서명 키
if [ "$TEST_KEY" = 1 ]; then
  KEYDIR=$(mktemp -d); chmod 700 "$KEYDIR"
  trap 'rm -rf "$KEYDIR"' EXIT
  newpass "$KEYDIR/android-release.pass"
  keygen "$KEYDIR" "MyLearningPlatform-test"
  SUFFIX="-test"
else
  KEYDIR=${MYLEARNER_ANDROID_KEYS:-$HOME/.config/mylearner}
  SUFFIX=""
  if [ ! -f "$KEYDIR/android-release.jks" ]; then
    [ -n "$INIT" ] || fail "릴리스 서명 키가 없다($KEYDIR/android-release.jks). 처음 한 번만: bash scripts/build_android.sh --init-key <사본 폴더>"
    mkdir -p "$KEYDIR" && chmod 700 "$KEYDIR"
    [ -s "$KEYDIR/android-release.pass" ] || newpass "$KEYDIR/android-release.pass"
    keygen "$KEYDIR" "MyLearningPlatform"
    mkdir -p "$INIT" && chmod 700 "$INIT"
    cp -p "$KEYDIR/android-release.jks" "$KEYDIR/android-release.pass" "$INIT/"
    chmod 600 "$INIT/android-release.jks" "$INIT/android-release.pass"
    cmp -s "$KEYDIR/android-release.jks" "$INIT/android-release.jks" || fail "키 사본이 원본과 다르다"
    echo "새 서명 키를 만들었다: $KEYDIR (+ 사본 $INIT). VM 밖에도 한 부 보관한다 — 잃으면 다음 판을 덮어 설치할 수 없다"
  elif [ -n "$INIT" ]; then
    fail "서명 키가 이미 있다 — --init-key 는 처음 한 번만 쓴다"
  fi
  chmod 600 "$KEYDIR/android-release.jks" "$KEYDIR/android-release.pass"
fi

# 2) 빌드 한 번 — web 사본 → 셸 한 줄 → (컨테이너) 시험·리소스·자바·dex → dex 붙이기 → (컨테이너) 정렬·서명·점검 자료
build_once() {
  local W=$1
  rm -rf "$W"; mkdir -p "$W"
  W=$(cd "$W" && pwd)   # --out 이 절대 경로여도 상대 경로여도 컨테이너에 붙일 수 있게
  python3 scripts/pack_app.py --edition mobile --web-out "$W/src" --courses "${COURSES[@]}"
  python3 mobile/android/tools/pack.py stage "$W/src/web" "$W/stage"
  docker run --rm --network none --user "$UIDGID" -e HOME=/tmp \
    -v "$PWD:/src:ro" -v "$W/stage:/stage:ro" -v "$W:/work" \
    "$ANDROID_IMAGE" sh /src/mobile/android/tools/docker-build.sh compile "$VER" "$CODE" "$DEBUG"
  python3 mobile/android/tools/pack.py add-dex "$W/base.apk" "$W/dex/classes.dex" "$W/unaligned.apk"
  docker run --rm --network none --user "$UIDGID" -e HOME=/tmp \
    -v "$PWD:/src:ro" -v "$W:/work" -v "$KEYDIR:/keys:ro" \
    "$ANDROID_IMAGE" sh /src/mobile/android/tools/docker-build.sh sign
}
W=$OUT/build$SUFFIX
build_once "$W"

# 3) 점검 — 패키지·판·SDK·권한 0·exported 1·디버그 표시·서명(v2·v3). 하나라도 어긋나면 실패
python3 mobile/android/tools/pack.py check "$W/badging.txt" "$W/permissions.txt" "$W/xmltree.txt" "$VER" "$CODE" "$DEBUG" || fail "APK 점검"
grep -q "Verified using v2 scheme (APK Signature Scheme v2): true" "$W/verify.txt" || fail "v2 서명 검증 실패"
grep -q "Verified using v3 scheme (APK Signature Scheme v3): true" "$W/verify.txt" || fail "v3 서명 검증 실패"
APK=$OUT/MyLearningPlatform-v$VER$SUFFIX.apk
cp "$W/signed.apk" "$APK"
(cd "$OUT" && sha256sum "$(basename "$APK")" > "$(basename "$APK").sha256")
echo
echo "결과: $APK"
echo "  크기            $(stat -c %s "$APK") 바이트"
echo "  SHA-256         $(sha256sum "$APK" | cut -d' ' -f1)"
echo "  서명 전 SHA-256 $(sha256sum "$W/aligned.apk" | cut -d' ' -f1)"
echo "  패키지          io.github.hipiboy7.mylearningplatform · $VER ($CODE) · minSdk 26 · targetSdk 36$([ $DEBUG = 1 ] && echo ' · 디버그')"
echo "  권한            없음(인터넷 권한 없음) · exported 구성요소 1(런처)"
echo "  서명 인증서     SHA-256 $(grep -m1 'certificate SHA-256 digest' "$W/verify.txt" | sed 's/.*digest: //')"
echo "  들어간 화면     $(python3 -c 'import sys, zipfile; print(sum(1 for n in zipfile.ZipFile(sys.argv[1]).namelist() if n.startswith("assets/web/")))' "$APK")개 파일(assets/web/)"

# 4) 재현성 — 같은 입력이면 같은 APK 인가(서명 전·후)
if [ "$REPRO" = 1 ]; then
  echo; echo "== 재현성: 한 번 더 빌드"
  R=$OUT/build-repro$SUFFIX
  build_once "$R" > "$OUT/repro.log" 2>&1 || { tail -20 "$OUT/repro.log"; fail "두 번째 빌드 실패"; }
  BAD=0
  for f in base.apk dex/classes.dex aligned.apk signed.apk; do
    a=$(sha256sum "$W/$f" | cut -d' ' -f1); b=$(sha256sum "$R/$f" | cut -d' ' -f1)
    if [ "$a" = "$b" ]; then echo "  같음  $f  $a"; else echo "  다름  $f  $a != $b"; BAD=1; fi
  done
  rm -rf "$R"
  [ "$BAD" = 0 ] || fail "재현되지 않는다 — 위에서 다른 것부터 본다"
  echo "  같은 입력 -> 같은 APK(서명 전·후)"
fi
echo
echo "끝 — $APK"
