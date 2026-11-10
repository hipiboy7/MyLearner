#!/bin/sh
# (컨테이너 안) 안드로이드 APK 빌드 단계 — scripts/build_android.sh 가 빌드 이미지(scripts/dev_tools.env ANDROID_IMAGE — JDK·build-tools·android-36)
# 안에서 부른다. 직접 부르지 않는다. MWL mobile/android/tools/docker-build.sh(MiddlewareLearner@e55b9c0)를 옮겨 고쳤다(SDK 는 이미지 안, Kv 시험).
# 들어오는 것: /src(저장소, 읽기 전용) · /stage(web 사본 — pack.py stage) · /work(중간물) · /keys(서명 키, 읽기 전용 — sign·keygen)
#   docker-build.sh compile <versionName> <versionCode> <debug 0|1>   규칙 시험(Policy·Kv — JVM) → 리소스(aapt2) → 자바(javac) → dex(d8)
#   docker-build.sh sign                                             정렬(zipalign) → 서명(apksigner, v2·v3) → 검증·요약(apksigner verify · aapt2 dump)
#   docker-build.sh keygen <CN>                                      서명 키를 처음 한 번 만든다(/keys 쓰기 가능으로 붙였을 때만)
# 문서: docs/P4_설계서_Mobile.md 3.8절
set -eu
SDK=${ANDROID_HOME:-/opt/android-sdk-linux}
BT=$SDK/build-tools/36.0.0
JAR=$SDK/platforms/android-36/android.jar
APP=/src/mobile/android
PKG=io/github/hipiboy7/mylearningplatform
MIN_SDK=26          # Android 8.0
TARGET_SDK=36       # 빌드 이미지의 android-36
STEP=${1:?단계}

case "$STEP" in
compile)
  VER=${2:?versionName}; CODE=${3:?versionCode}; DEBUG=${4:-0}
  rm -rf /work/test /work/gen /work/classes /work/dex /work/res.zip /work/base.apk
  mkdir -p /work/test /work/gen /work/classes /work/dex
  echo "-- 규칙·파일 KV 시험(Policy·Kv — JVM)"
  javac -encoding UTF-8 -Xlint:all -Werror -d /work/test "$APP/src/$PKG/Policy.java" "$APP/src/$PKG/Kv.java" \
    "$APP/test/$PKG/PolicyTest.java" "$APP/test/$PKG/KvTest.java"
  java -cp /work/test io.github.hipiboy7.mylearningplatform.PolicyTest
  java -cp /work/test io.github.hipiboy7.mylearningplatform.KvTest
  echo "-- 리소스(aapt2 $("$BT/aapt2" version 2>&1 | sed 's/.*) //'))"
  "$BT/aapt2" compile --dir "$APP/res" -o /work/res.zip
  DBG=""
  [ "$DEBUG" = 1 ] && DBG="--debug-mode"
  # shellcheck disable=SC2086
  "$BT/aapt2" link -o /work/base.apk -I "$JAR" --manifest "$APP/AndroidManifest.xml" -A /stage/assets \
    --java /work/gen --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
    --version-code "$CODE" --version-name "$VER" --no-auto-version $DBG /work/res.zip
  echo "-- 자바(javac $(javac -version 2>&1 | cut -d' ' -f2), 원본 수준 8 · android.jar)"
  find "$APP/src" /work/gen -name '*.java' | sort > /work/sources.txt
  # core-lambda-stubs.jar: 람다를 쓰려면 javac 가 LambdaMetafactory 를 봐야 한다(android.jar 에 없다 — d8 이 람다를 풀어 쓴다)
  javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$JAR:$BT/core-lambda-stubs.jar" -Xlint:all,-options,-deprecation -Werror \
    -d /work/classes @/work/sources.txt
  echo "-- dex(d8)"
  find /work/classes -name '*.class' | sort > /work/classes.txt
  "$BT/d8" --release --min-api "$MIN_SDK" --lib "$JAR" --output /work/dex @/work/classes.txt
  ls -l /work/base.apk /work/dex/classes.dex
  ;;
sign)
  rm -f /work/aligned.apk /work/signed.apk /work/signed.apk.idsig
  "$BT/zipalign" -f -p 4 /work/unaligned.apk /work/aligned.apk
  "$BT/zipalign" -c -p 4 /work/aligned.apk
  # 비밀번호는 파일에서 읽는다(명령 기록·화면에 남지 않는다). PKCS12 는 키 비밀번호가 저장소 비밀번호와 같다
  "$BT/apksigner" sign --ks /keys/android-release.jks --ks-key-alias mylearner --ks-pass file:/keys/android-release.pass \
    --min-sdk-version "$MIN_SDK" --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
    --out /work/signed.apk /work/aligned.apk
  "$BT/apksigner" verify --verbose --print-certs /work/signed.apk > /work/verify.txt
  "$BT/aapt2" dump badging /work/signed.apk > /work/badging.txt
  "$BT/aapt2" dump permissions /work/signed.apk > /work/permissions.txt
  "$BT/aapt2" dump xmltree /work/signed.apk --file AndroidManifest.xml > /work/xmltree.txt
  ;;
keygen)
  CN=${2:-MyLearningPlatform}
  [ -e /keys/android-release.jks ] && { echo "키가 이미 있다 — 새로 만들지 않는다"; exit 1; }
  [ -s /keys/android-release.pass ] || { echo "비밀번호 파일이 없다"; exit 1; }
  keytool -genkeypair -keystore /keys/android-release.jks -storetype PKCS12 -alias mylearner \
    -keyalg RSA -keysize 3072 -validity 10950 -dname "CN=$CN" \
    -storepass:file /keys/android-release.pass -keypass:file /keys/android-release.pass
  chmod 600 /keys/android-release.jks
  ;;
*)
  echo "알 수 없는 단계: $STEP"; exit 2 ;;
esac
