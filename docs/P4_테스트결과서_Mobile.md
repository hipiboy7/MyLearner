# P4 테스트결과서 — 폰에서 배우기 + 합치기

- 정정 2026-11-10: 7절 11 을 바로잡고(Policy.java 도 구현이 먼저, zip.js 는 구현 초안 뒤에 실패를 봄, 리팩터 단계 없음) 7.1절 TDD 사후 점검(변이 시험·시험 3건 보탬·리팩터)을 더했다 — 사용자 질문 "red·green·blue 다 했어?"
- 작성 2026-11-10 / 대응: [`P4_요구사항정의서_Mobile.md`](P4_요구사항정의서_Mobile.md) FR-401~481·NFR-401~408, [`P4_설계서_Mobile.md`](P4_설계서_Mobile.md) / 써 보기: [`P4_체크리스트_Mobile.md`](P4_체크리스트_Mobile.md)
- 실행 환경: 개발 VM(RHEL 9.6, 메모리 11Gi), Python 3.9.21·3.11.9·3.12.3(Playwright 이미지)·3.14.8, Node 22.23.3, 헤드리스 Chromium 153, 안드로이드 빌드 이미지 `ghcr.io/cirruslabs/android-sdk:36`(JDK 21.0.9 · build-tools 36.0.0 · android-36 · 에뮬레이터 36.3.10), 에뮬레이터 시스템 이미지 `system-images;android-36;default;x86_64`(Android 16 · WebView — Docker 볼륨 2.05 GB, 2026-11-10 받음). 과정 자료: MWL `e55b9c0`(135과), Learn `mwm-app`(45과)·`llm-chat-agent`(9과)

## 1. 실행 증거

### 1.1 전체 검증 — `bash scripts/verify.sh` (2026-11-10)

중간 커밋 `597b1f9` 직전 실행(16:08 시작). 그 뒤 더한 것(3만 줄 성능 단계·교환 파일 속성 시험·메뉴 줄바꿈)은 이 문서를 커밋하기 전 전체 검증에 들어간다(history 에 결과).

```
단계                         결과   초
0 환경 확인                통과   1
1 시험 Python 3.9            통과   19
2 시험 Python 3.11           통과   20
3 시험 Python 3.12(Docker)   통과   21
4 시험 Python 3.14(Docker)   통과   24
5 3.9 문법(ai_probe)         통과   0
6 커버리지(A>=90 B>=70)    통과   21
7 문서 검사                통과   0
8 공개 전 점검            통과   0
9 브라우저 점검 정적 검사 통과   0
10 브라우저 스모크(Chromium) 통과   4
11 반입 묶음 재현·외부 URL 0 통과   0
12 시험 JS(Node 22)+커버리지 통과   14
13 웹 JS 정적 검사        통과   0
14 골든 벡터 복사본(MWL) 통과   0
15 기록 왕복(S3)           통과   7
16 MWL 실데이터 대조     통과   2
17 렌더러 Chromium(XSS)     통과   4
18 앱 묶음 재현·판별   통과   4
19 화면 스모크(Chromium)  통과   51
20 워크플로 정적 검사  통과   0
21 묶음 실기(Linux)        통과   1
22 APK 빌드·권한 0·재현 통과   14
전체 통과 (23단계)
```

새 단계는 20(워크플로 정적 검사)·21(묶음 실기 — Linux, Windows 는 Actions)·22(APK 빌드·권한 0·재현 — 시험 키, `tests/fixtures/mwl/scheduler_course.json`)이고, 19(화면 스모크)에 합치기·되살리기·폰 폭 셋을 더했다. `--quick` 은 3·4·10·17·19·22 를 건너뛴다.

### 1.2 에뮬레이터 — `python3 mobile/android/e2e/emulator_test.py dist/android/MyLearningPlatform-v0.4.0-test.apk <캡처 폴더>` (2026-11-10)

시험 APK(시험 키 · 디버그 표시 · 과정 셋)를 Android 16(API 36 · x86_64 · KVM · 머리 없이 · 컨테이너 `--network none` · 한국어)에 설치해 WebView DevTools(CDP)로 눌렀다. **24건 통과 · 실패 0**(마지막 실행. 첫 두 실행은 시험 쪽 문제 — 7절 3·4).

| 묶음 | 확인한 것 |
|---|---|
| 설치·판·권한 | 설치 Success, `versionName=0.4.0`, `dumpsys package` 요청 권한 0(인터넷 포함), 비행기 모드 |
| 첫 화면 | 저장소 `android`(파일 KV), 판 `mobile`, 셸·플랫폼 훅, 과정 3개, 읽기 전용 띠 없음(T-014) |
| 강의·복습 → 강제 종료 | 강의 마침(사건 2), 복습 채점 **0.1초 뒤 `am force-stop` → 다시 켜도 그 사건이 있다**(FR-410·NFR-403), 다시 켠 뒤 바로 쓴다, `run-as … ls files/kv` 에 `ls.mylearner.log.2026-11`, 임시 파일 0 |
| 회전 | 가로로 돌려도 같은 JS 문맥·같은 주소(화면을 다시 만들지 않는다), 가로 폭으로 그림 |
| 교환 파일 | 설정 → [교환 파일 파일로 저장] → 시스템 저장 창의 저장 단추(uiautomator 로 누름) → `/sdcard/Download/mylearner-exchange-2026-11-10-<6자리>.zip` 을 꺼내 열어 머리 `mylearner-exchange` v1·판 `mobile`, 줄 수 = 기록(3), 화면이 저장 끝을 받음 |
| 뒤로 가기 | 통계 → 오늘(한 걸음), 오늘에서 앱이 닫힘 |
| 오류 | `logcat -b crash` 0, 스크립트 `Uncaught` 0 |

### 1.3 APK — `bash scripts/build_android.sh` (2026-11-10)

| 빌드 | 결과 |
|---|---|
| 릴리스(새 키 — `--init-key <사본 폴더>`, 처음 한 번) | `dist/android/MyLearningPlatform-v0.4.0.apk` 2,456,660 바이트 · 패키지 `io.github.hipiboy7.mylearningplatform` · 0.4.0(400) · minSdk 26 · targetSdk 36 · **권한 0** · exported 1(런처) · 디버그 표시 없음 · v2·v3 서명 · 서명 인증서 SHA-256 `7589128ce39f53ef32dfffa269405d8c07d625248273a23b50ce6d25e0a9b18c`. 키: 원본 `~/.config/mylearner/`(600) + 이 계정 `/data` 개인 폴더 사본(700·600, `cmp` 같음). VM 밖 한 부는 사용자(체크리스트 1절) |
| 시험(`--test-key --debuggable --repro`) | 같은 점검 + 디버그 표시 있음. **두 번 빌드해 `base.apk`·`classes.dex`·정렬 APK·서명 APK 가 같은 바이트**(NFR-405) |
| JVM 규칙 시험(빌드마다 먼저) | `PolicyTest` 95건 · `KvTest` 55건 통과 |

### 1.4 화면 스모크 — `python3 scripts/app_smoke.py` (2026-11-10)

| 단계 | 결과 |
|---|---|
| first(두 판) — P4 | 인터넷판: [교환 파일 내려받기] → 받은 zip 을 다시 열어 줄 수 = 기록, 사용자 과정 `mwl-notes` 포함, 마지막 내보내기 시각. 폐쇄망판: 내보내기 단추 없음·합치기 입구 있음. 다른 기기(폰) 교환 파일(복습 12 + 강의 1 + 사용자 과정 1) 합치기 → 새 줄 13 · **N/N 13/13** · 새 과정 저장, 같은 파일 다시 → 새 줄 0·과정 '같음', 되돌리기 → 폰 줄 13 빠짐·이 기기 줄 그대로, '되살리기 전'으로 다시 → 13 돌아옴, 저장소에도 있음, 백업 '합치기 전' 1·'되살리기 전' 2, 내보내기 알림 띠(10일 전 있음·방금 없음), `#/restore/bad-name` 은 오류 상자 |
| persist(두 판) | 브라우저를 다시 연 뒤 사라진 사건 0(합치기·되살리기 뒤 상태 그대로) |
| phone@344·390·690 | 화면 10개(오늘·복습·강의·통계·과정·지도·설정·합치기·MWL 들여오기·점검) — 정한 폭보다 넓어지지 않음, 메뉴가 가로 스크롤 뒤에 숨지 않음, 44px 보다 작은 누르는 곳 0, 화면 밖으로 잘린 단추 0, 접근성 위반 0 |
| perf(사건 5,069줄) | 첫 화면 272 ms · 복습 한 장 133 ms(NFR-302), 3만 줄 교환 파일 미리보기 884 ms · 합친 뒤 다시 계산 228 ms(NFR-406) |
| 서버 모드 · 데이터 폴더(명령 단위) | 화면이 만든 줄이 모두 `data/log.jsonl` 에 있음 |

### 1.5 묶음 실기(Linux) — `python3 scripts/ci_windows_bundle.py` (2026-11-10)

폐쇄망판 zip 만들기 → 풀기 → 켜기(`PYTHONIOENCODING=cp949`) → 첫 줄 cp949 엄격히 풀림 → `/api/health` 폐쇄망판 → `?token=` 쿠키(HttpOnly·SameSite=Strict) → 한 줄 덧붙이기 → 백업 → 백업 내려받기 404 → 되살리기 차이 API → 끄고 다시 켜도 그 줄 → 데이터 폴더 — **13건 통과**. Windows(`MyLearner.cmd`·`py -3`·`chcp 949`)는 Actions(1.6절). 전체 검증 21단계는 2026-11-10 부터 `PYTHONIOENCODING=cp1252`(러너 콘솔처럼)로 돌린다(T-015)

### 1.6 GitHub Actions — `impl-phase4` push(2026-11-10, 사용자 허락)

| 워크플로 | 러너 | 커밋 | 결과 |
|---|---|---|---|
| `android-emulator` | `ubuntu-24.04`(이미지 20261101.360) | `f085b86` | **통과** 2분 53초 — `/dev/kvm` 켜짐(udev 규칙), 빌드 이미지 안에서 `PolicyTest` 95·`KvTest` 55 통과, 시험 키 APK, 에뮬레이터 시험 **24건 통과·실패 0**(VM 결과 1.2 와 같은 24항목), 캡처 artifact `emulator-shots`(보존 7일). 시스템 이미지 받기 단계만 네트워크 |
| `windows-bundle` (3.9 · 3.14) | `windows-2025` | `e73737b` | **통과** — 3.9.13(1분 31초)·3.14 둘 다 **13건 통과·실패 0**: `py -3` 이 `PY_PYTHON3` 판을 고름, `MyLearner.cmd` 로 켬, 첫 줄 cp949 엄격히 풀림, 토큰 쿠키, 끄고 다시 켜도 기록 남음, 폐쇄망판 백업 내려받기 404 |
| `android-emulator` | `ubuntu-24.04` | `e73737b` | **통과** 2분 52초 — 24건 |
| `windows-bundle` (3.9 · 3.14) | `windows-2025` | `f085b86` | **실패** — 둘 다 앱을 켜기 전, 시험 도구 첫 `print` 에서 `UnicodeEncodeError: 'charmap' codec can't encode characters in position 3-4`(러너 콘솔 cp1252). `actions/setup-python` 은 3.9.13·3.14.10 을 깔았고 `py -3 가 고르는 판` 단계는 통과. 고침: T-015 |

공개 로그에 이 저장소의 경로·토큰·기록은 없었다(러너의 표준 경로 `/home/runner/work/…`·`D:\a\…` 만 — 2026-11-10 로그 내려받아 검색).

## 2. 테스트 구성

| 종류 | 파일 | 수 |
|---|---|---|
| JS 단위(A) | `zip.test.js`·`exchange.test.js`·`merge.test.js`, `store_common.test.js`(되살리기 1건 더함) | 11 · 11 · 11 · +1 (경계 3건은 7.1절 사후 보강) |
| JS 단위(B) | `store_android.test.js`(가짜 다리), `store_adapters.test.js`(브라우저·서버 되살리기 2건 더함) | 5 · +2 |
| Python 단위(A·B) | `test_storage.py`(`KEEP` 표 JS 와 같음 1 · 되살리기 3) | +4 |
| Python 통합(B) | `test_server.py`(되살리기 API 1)·`test_pack_app.py`(폐쇄망 zip·모바일판 사본 1)·`test_verify_tools_p4.py`(워크플로 검사 음성 시험·APK 점검·자바 CSP·다리 이름 10) | +12 |
| 자바(A, JVM) | `mobile/android/test/…/PolicyTest.java`·`KvTest.java` | 95 · 55 |
| 화면(C) | `app_check.js`(P4 흐름·`phone` 시나리오·`prep-merge`), `app_smoke.py`(폰 폭 셋·폴드 스크린샷) | 시나리오 +4 |
| 에뮬레이터(C) | `mobile/android/e2e/emulator_test.py` | 24 |
| 묶음 실기(B) | `scripts/ci_windows_bundle.py` | 13 |

JS 시험 187건(단위 182·통합 5 — 교환 파일 속성 시험 8 · 7.1절 경계 3 · 5.2절 독립 점검 회귀 5 포함), Python 시험 275건, 자바 JVM 시험 150건, 에뮬레이터 24건, 묶음 실기 13건 — 모두 통과(2026-11-10).

## 3. 커버리지

### 3.1 JS — `bash scripts/run_js_tests.sh`(기준 줄 90%·분기 80%, `web/core/**`·`web/store/**`, `idb.js` 제외)

| 파일 | 등급 | 줄 | 분기 | 함수 |
|---|---|---|---|---|
| `web/core/zip.js` | A | 100.00 | 90.09 | 100.00 |
| `web/core/exchange.js` | A | 100.00 | 83.76 | 93.75 |
| `web/core/merge.js` | A | 100.00 | 87.04 | 100.00 |
| `web/store/common.js` | A | 100.00 | 92.13 | 100.00 |
| `web/store/android.js` | B | 100.00 | 76.74 | 88.89 |
| `web/store/browser.js` | B | 100.00 | 88.76 | 98.04 |
| `web/store/server.js` | B | 100.00 | 80.70 | 100.00 |
| 전체 | — | 100.00 | 87.53 | 99.03 |

### 3.2 Python — `python3 scripts/coverage_lite.py --enforce`

| 파일 | 등급 | 커버 |
|---|---|---|
| `mylearner/storage.py`(순수 함수) | A | 100.0% |
| `mylearner/storage.py` | B | 95.2% |
| `mylearner/server.py` | B | 96.3% |
| `mylearner/__main__.py` | B | 94.0% |
| 등급 전체 | A 96.6% · B 95.4% | — |

- `mobile/android/tools/pack.py`·`scripts/build_android.sh`·`scripts/check_workflows.py`·`scripts/ci_windows_bundle.py`(B)는 측정 폴더(`tools`·`mylearner`) 밖이라 줄 커버리지를 재지 않았다 — 음성 시험(`test_verify_tools_p4.py`)과 전체 검증 20~22단계로 본다
- 자바 `Policy`·`Kv`(A)는 JVM 시험 150건으로 보고 줄 커버리지 도구는 두지 않았다(외부 시험 도구 0 — MWL 과 같다). `MainActivity`·`ShareProvider`(B)는 안드로이드 API 라 에뮬레이터 시험으로 본다
- 화면(`web/app/*.js`, C)·셸 스크립트(C)는 측정하지 않고 화면 스모크·에뮬레이터 시험으로 본다

## 4. 요구사항별 검증

| FR | 증거 |
|---|---|
| 401·402 | 1.3 — 패키지·앱 이름·판·SDK, 권한 0·exported 1·allowBackup 거짓(`pack.py check`, `test_verify_tools_p4.py` 매니페스트), 에뮬레이터 `dumpsys` 요청 권한 0 |
| 403 | `PolicyTest`(자산 경로·`..`·퍼센트·바깥 주소 403), `test_verify_tools_p4.py`(자바 CSP = 화면 메타 + frame-ancestors) |
| 404·405 | `PolicyTest`(이동 규칙·고른 주소 `content:` 만·파일 이름), 에뮬레이터(저장 창), `test_verify_tools_p4.py`(다리 이름 = JS) |
| 406 | 에뮬레이터 — 뒤로 가기·회전에 화면 그대로. 날짜 넘김은 `onResume → MyLearner.app.checkDay`(시간을 돌리는 시험은 없음 — 8절) |
| 407·408 | 1.3 — 새 키(RSA 3072·PKCS12, 사본), `--repro` 같은 바이트, `--network none` |
| 409 | `test_pack_app.py`(모바일판 설정·`app_version`·AI 없음·서버 없음), 에뮬레이터(판 `mobile`) |
| 410~412 | `store_android.test.js`, `KvTest`, 에뮬레이터(강제 종료 뒤 남음·`files/kv`·임시 파일 0) |
| 413 | `merge.test.js`(알림 날 수), 스모크(띠 있음·없음) |
| 420~424 | `zip.test.js`·`exchange.test.js`(같은 바이트·해시 깨짐·모르는 판·MWL 진도·기록 파일·한 폴더째 다시 묶은 deflate zip·한도), 스모크(내보낸 zip 다시 열기), 에뮬레이터(폰이 저장한 zip) |
| 430~435 | `merge.test.js`, 스모크(N/N 13/13·멱등) |
| 437 | `merge.test.js`(`seq_end` 경계·`long` — 정규형이 길어지는 줄), `tests/integration/js/state_reload.test.js`(순번 끝에서 `record` 가 던지지 않음) — 5.2절 F-1·F-2 |
| 436 | 폰 MWL 들여오기 화면은 PC 와 같은 코드 — 에뮬레이터에서는 돌리지 않았다(파일 고르기 창 — 체크리스트 2-8) |
| 440~443 | `merge.test.js`(계획), `store_common.test.js`·`store_adapters.test.js`·`store_android.test.js`, `test_storage.py`(되살리기 왕복·입력 거부·백업 실패 시 그대로·`KEEP` 표), `test_server.py`(diff·restore API·폐쇄망판 백업 글 404), 스모크(되돌리기·다시) |
| 450~452 | `test_pack_app.py`(zip·tgz 를 풀면 검사한 파일과 같다), 전체 검증 18단계(두 판 × 두 꼴 두 번 같은 바이트, 폐쇄망판 외부 URL 0), `README_KO.txt` |
| 460~462 | 스모크 폰 폭 셋, 에뮬레이터 캡처(과정 3개·상태 표시줄) |
| 470~473 | `scripts/ci_windows_bundle.py`(Linux 13건), `check_workflows.py`(위반 0)·음성 시험 13가지 — Actions 실행은 1.6절 |
| 480·481 | Phase 4 병합 때(CLAUDE.md 7절 '릴리스') |
| NFR-401 | 1.3 명령 단위(빌드한 APK 를 `aapt2 dump` 로) |
| NFR-402 | `exchange_property.test.js` — 기기 셋(폰·PC·폐쇄망)이 교환 파일(zip)로 무작위 25회씩 오가는 8개 시드: 어느 기기도 줄이 줄지 않음·마지막 왕복 뒤 폰 = PC·폐쇄망 = PC ∪ 폐쇄망 줄·폐쇄망 줄은 밖에 없음·같은 입력 = 같은 zip 바이트. 스모크 합치기 N/N, 전체 검증 15단계(기록 왕복 — 기록 파일) |
| NFR-403 | 1.2 |
| NFR-404·405 | 1.1 18·22단계 |
| NFR-406 | 스모크 perf — 기록 30,000줄 교환 파일(4,799,862 바이트) 열기 + 미리보기 **884 ms**, 합친 기록(35,070줄) 다시 계산 **228 ms**(헤드리스 Chromium 153, 2026-11-10). 브라우저 저장소에 3만 줄을 쓰는 시간은 재지 않았다(localStorage 한도 — 보류 결정 7·8) |
| NFR-407 | 스모크 폰 폭 셋 접근성 0 |
| NFR-408 | 웹 JS 정적 검사(외부 라이브러리·`import` 0), APK `android.jar` 만 |

## 5. 점검

### 5.1 자체 점검(만든 에이전트)

| 본 것 | 결과 |
|---|---|
| 되살리기가 기록을 지운다(유실 0 원칙) | 사용자 확인 + 직전 전체 백업('되살리기 전') + 이 기기 줄은 남김 + 그 백업을 되살리면 돌아옴 — 스모크·`test_storage.py` 로 왕복 확인 |
| 서버가 백업 글을 내주는가(폐쇄망판) | `diff` 는 지금 기록에만 있는 줄과 수만, `restore` 는 서버 안에서 — 폐쇄망판 백업 내려받기 404 그대로(`test_server.py`) |
| 교환 파일 zip 입력(남의 파일) | 이름(`..`·절대·역슬래시·NUL)·암호·zip64·방식·한도·CRC·크기·지역 머리 이름·해시 — `zip.test.js`·`exchange.test.js`. deflate 풀기는 적힌 크기를 넘으면 끊는다 |
| 안드로이드 다리 | 이 앱 주소일 때만, 파일 이름 규칙, `content:` 만, 바이트 상한 64 MiB |
| 강제 종료 뒤 읽기 전용 | 찾아 고침(T-014) |
| 좁은 화면 넘침 | 시험 도구가 놓치던 것을 찾아 고침(7절 6·7) |

### 5.2 독립 점검

2026-11-10 사용자 허락("2 독립 점검 해") — sonnet 1개, 읽기 전용(전용 임시 폴더의 저장소 사본에서만 시험), 대상 커밋 `f085b86`, 12분 40초·토큰 약 24만. 대상: 합치기·되살리기(유실), 교환 파일 zip 입력, 안드로이드 다리. 지적마다 원문(코드)을 다시 읽어 확인한 뒤 받아들였다.

| # | 등급 | 지적 | 확인 | 조치 |
|---|---|---|---|---|
| F-1 | 중 | 이 기기 ID·순번 `MAX_SEQ` 인 줄을 들이면 다음 순번이 한도를 넘어 `record` 가 누를 때마다 던진다(띠 없음·저장 0). 되살리기는 이 기기 줄을 남겨 되돌릴 수 없다. 손으로 만든 파일(이 기기 ID 를 알아야 함)만 가능 | `web/core/log.js` `make`·`web/app/state.js` `record` 원문 — 맞음 | 미리보기 `seq_end`(순번 > `MAX_SEQ` − 2^32) → 화면이 `E-SEQ-END` 로 파일째 거부(FR-437), `record` 는 한도를 넘으면 띠·`false`. 시험 먼저(실패 확인) |
| F-2 | 하 | 날 줄은 64 KiB 안인데 정규형이 넘는 줄(`1e9` → `1000000000`)이 열기를 통과하고, 저장소가 그 덧붙이기 묶음을 통째로 거절해 합치기가 매번 실패 | `exchange.js` `longLines`(날 줄)·`storage.py` `check_line` — 맞음. 아무것도 지우지 않고 실패를 알린다(유실 아님) | 미리보기 `long`(정규형으로 잼) → `E-LINE-LONG` 로 파일째 거부. 길이 검사는 `exchange.tooLong` 하나로 |
| F-3 | 하 | 한도 가까운 교환 파일은 화면을 멈춘다 — 64 MiB `log.jsonl` 열기 8.2초(해시 3.5·나누기 4.3, 점검 에이전트 실측). 256 MiB 는 추정만 | 구조(한 번에 읽고 해시) — 맞음 | **받아들임**: 일부러 만든 파일만. 실제 기록은 KB~MB(3만 줄 미리보기 884 ms — 4절 NFR-406). 한도는 그대로 |
| F-4 | 중 | 다른 탭이 되살려 저장소에서 뺀 줄이, 쓰기를 넘겨받은 탭의 다시 읽기(`reloadLog` = 저장소 ∪ 메모리)로 메모리에 되살아난다 → 그 줄이 든 파일을 합치면 새 줄 0·N/N 맞음인데 저장소에는 없다(서버 모드·두 탭) | `state.js` `leaseTick`·`takeover` → `reloadLog` 원문 — 맞음. P3 는 저장소가 늘기만 해 합집합이어도 같았다 | `reloadLog` = 저장소 + 저장 못 한 줄(`reloadFresh` 와 하나로). 시험 먼저(실패 확인) |
| U-1 | 하 | 폰에서 저장 창을 취소하면 기록 전체가 담긴 임시 파일(`cache/pending-export.bin`)이 남는다 | 점검 에이전트는 미확인 → `MainActivity.finishSave` 원문 — 맞음 | 취소해도 지운다. 시험 없음(Activity — 에뮬레이터 시험에 취소 단계 없음) |
| U-2 | 하 | 합치기가 여러 번에 나눠 보내는 중에 날짜가 바뀌면 `checkDay` 가 다시 읽어(새로 고침) 일부만 들어간다(백업은 있음, 다시 하면 나머지) | 미확인 → `checkDay` 는 `App.saving` 을 보는데 합치기는 올리지 않음 — 맞음 | 합치기·되살리기 동안 `saving` 을 잡는다(`hold()`). 시험 없음(실제 날짜 넘김 — 8절) |

미확인으로 남긴 것(재현하지 않음 — 그대로 둔다): 안드로이드 어댑터 `removeItem` 이 다리의 지우기 실패를 무시(지우기가 실패해야 함), 브라우저 저장소가 되살리기 중간에 가득 차면 키가 반쯤 바뀜(되살리기 전 백업은 있음), `onRenderProcessGone` 뒤 `Kv` 가 둘이 되어 진행 중인 임시 파일을 지움(그 쓰기는 오류를 돌려 다시 보냄), 한 번에 5만 줄 넘는 들여오기는 서버 되살리기 한도(`MAX_LINES`)에 걸림(설계대로).

버틴 것(점검 에이전트가 돌림): 되살리기·들여오기 속성 시험 12회(브라우저·안드로이드 어댑터 — 결과는 늘 백업 ∪ 이 기기 사건, 되살리기를 되돌려도 유실 0), JS·Python 되살리기 400 사례 불일치 0, 변형 zip 6,000개(예외 0·다른 내용 받음 0), deflate 폭탄 300 MiB 10 ms 에 끊김, `Policy` 주소 884개(WHATWG `URL` 과 비교해 다른 출처를 받는 경우 0), 매니페스트 권한 0.

## 6. 첫 사용 재현

README 0절의 Phase 4 명령(폐쇄망 zip·APK 빌드·에뮬레이터 시험)을 적은 그대로 돌렸다(2026-11-10). 결과는 1.2·1.3.

교환 파일 속성 시험(NFR-402)·3만 줄 성능(NFR-406)은 이 세션 끝에 더했다(4절).

## 7. 실패·재작업 내역

| # | 무엇 | 원인 | 조치 |
|---|---|---|---|
| 1 | `PolicyTest` 2건 — 한글 이름 `교환.zip` 이 `zip.zip`, 대문자 확장자 기대값 | 거른 뒤 확장자를 뗐다 · 시험이 틀림 | 확장자를 먼저 떼고 거른다, 기대값 소문자 |
| 2 | 에뮬레이터 컨테이너 종료 139 | SELinux 가 힙 실행을 막아 소프트웨어 GL 이 죽음(T-012) | `-gpu swangle_indirect`·`-feature -ModemSimulator` |
| 3 | 에뮬레이터 시험이 CDP 연결에서 멈춤 | WebView 가 주는 DevTools 주소의 호스트가 비었다(`ws:///devtools/page/…`) | 넘긴 포트에 경로만 |
| 4 | 다시 설치가 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 시험 키를 빌드마다 새로 만든다 — 폰과 같은 규칙(같은 키만 덮어 설치) | 시험 안에서는 지우고 다시 설치 |
| 5 | 에뮬레이터 첫 화면에 읽기 전용 띠 | 강제 종료 뒤 쓰는 탭 임대가 남음(T-014) | 저장 어댑터 `singleWriter` — 앱은 임대를 보지 않는다 |
| 6 | 폰에서 키보드 안내(`Space`·`1~4`) | P3 화면 그대로 | 손가락 화면(`hover: none`·`pointer: coarse`)에서 숨김 |
| 7 | 폴드 344px 스크린샷에서 백업 표의 '되살리기' 열이 잘림 — 스모크는 통과. 690px(펼친 화면)에서는 메뉴 넷(회고·과정·용어·설정)이 가로 스크롤 뒤에 숨음 | 모바일 에뮬레이션이 넓은 내용에 맞춰 레이아웃 폭을 늘려(344 → 411) `innerWidth` 와 비교한 검사가 늘 통과했다. 메뉴 한 줄 규칙은 40rem 이하에만 있었다 | 정한 폭과 비교하고, 스크롤 상자 밖에서 잘린 단추·메뉴 숨음·레이아웃 폭을 본다(고치기 전 상태로 돌려 잡는 것을 확인). 백업 표·과정 표(P3 부터 572px)를 `.table-wrap` 으로, 메뉴 여러 줄 규칙을 60rem 이하로 |
| 8 | 화면 스모크 `#/restore/bad-name` 오류 상자 2건 | 일부러 보이는 오류 상태를 시험이 오류로 셈 | 그 주소는 오류 상자가 있어야 통과 |
| 9 | 웹 JS 정적 검사 — 보이지 않는 글자 U+FEFF 3곳 | 파일 쓰기 도구가 `﻿` 를 글자로(T-013) | 이스케이프로 |
| 10 | `test_verify_tools_p2.py` core 파일 수 15 | core 에 셋을 더함 | 18 로, 렌더러 스모크는 폴더에서 센다 |
| 11 | 등급 A 의 Red → Green → Refactor 를 다 지키지 않았다 — `exchange.js` 는 구현 전 실패를 돌려 보지 않았고, `Policy.java`·`Kv.java` 는 구현을 먼저 썼고, `zip.js` 는 구현 초안을 쓴 뒤에 실패를 봤고, 리팩터 단계는 어느 모듈에도 없었다(CLAUDE.md 3절과 다르다. 처음 적은 이 칸은 `Kv.java` 만 적어 틀렸다) | 순서를 지키지 않음 | 7.1절 — 변이 시험으로 시험이 빨개지는지 사후 확인, 살아남은 결함 3개를 잡는 시험을 보태고, 리팩터를 했다. 다음부터 시험 → 실패 확인 → 구현 → 리팩터 순서와 그 증거(실패 출력)를 남긴다 |

### 7.1 TDD 사후 점검 (2026-11-10)

사용자 질문("red·green·blue 다 했어?")에 이 세션 대화 기록의 도구 호출 시각으로 대조했다.

| 모듈(등급 A) | 시험 먼저 | Red(구현 전 실패) | Green | Refactor |
|---|---|---|---|---|
| `web/core/zip.js` | 예(시험 15:16 → 구현 초안 15:17) | 부분 — 초안을 쓴 뒤, 모듈을 놓기 전에 '모듈 없음' 실패 1건 | 11 통과 | 사후에 했다(아래 표) |
| `web/core/exchange.js` | 예(시험 15:18:02 → 구현 15:18:54) | 아니오 — 돌리지 않음 | 9 통과 | 사후에 했다(아래 표) |
| `web/core/merge.js` | 예 | 예 — '모듈 없음' 실패 | 10 통과 | 사후에 했다(아래 표) |
| `web/store/common.js` 되살리기 | 예 | 예 — 단언 실패 3건 | 21 통과 | 하지 않음(짧아 고칠 곳을 찾지 못함) |
| `mylearner/storage.py` 되살리기(순수 부분) | 예 | 예 — `FAILED (failures=2, errors=3)` | 통과 | 하지 않음(같음) |
| `Policy.java` | 아니오(구현 15:34:26 → 시험 15:35:15) | 아니오 | 95 통과(첫 실행 실패 2건은 7절 1) | 하지 않음(MWL 에서 옮김) |
| `Kv.java` | 아니오(구현 15:34:44 → 시험 15:35:32) | 아니오 | 55 통과 | 하지 않음(MWL 에서 옮김) |

**변이 시험**(시험이 빨개질 수 있나 — 임시 사본에 결함을 하나씩 넣고 그 모듈의 시험을 돌림): 25개 가운데 21개를 잡았다.

| 살아남은 결함 | 뜻 | 조치 |
|---|---|---|
| `exchange.js` 머리에 `log.jsonl` 이 빠졌는지 보는 검사를 지움 | 그 경우의 시험이 없었다(파일만 빠진 경우는 있었다) | 시험 보탬 → 이 결함에서 실패, 원래 코드에서 통과 |
| `exchange.js` 줄 길이 상한 `> LINE_MAX` → `> LINE_MAX + 1` | 경계(65,536·65,537 바이트) 시험이 없었다 | 한글 섞인 줄로 경계 시험 보탬 → 같음 |
| `merge.js` 미래 판정 `>` → `>=` | 경계(오늘 + `FUTURE_DAYS`) 시험이 없었다 | 경계 시험 보탬 → 같음 |
| `Kv.java` 파일 `fsync` 지움 | 단위 시험으로는 볼 수 없다(전원 차단 시험이 필요) | 그대로 — 에뮬레이터의 강제 종료 시험(1.2)은 프로세스 종료만 본다 |

**Refactor**(시험은 그대로 통과, 겉 동작은 같게):

| 모듈 | 바꾼 것 |
|---|---|
| `merge.js` | 미리보기가 같은 합치기(`L.merge`)를 두 번 하던 것을 한 번으로, 줄 키 계산을 함수 하나로 |
| `exchange.js` | 오류 만들기 7곳을 `fail(code, msg)` 로, 과정 ID 를 자릿수 자르기 대신 경로 규칙의 무리로 |
| `zip.js` | 지역 머리·중앙 디렉터리가 같이 쓰는 칸을 함수 하나로, 바이트 잇기를 함수 하나로 |

리팩터 전(HEAD 사본)과 후를 난수 입력 300 회로 맞대 zip 바이트·교환 파일 바이트·열기 결과(정상·잘림·비트 뒤집기)·미리보기·되살리기 계획 2,100건이 같았다. 전체 JS 182건 통과, `check_core_js.py` 위반 0.

## 8. 실행하지 못한 것

| 무엇 | 이유 | 언제 |
|---|---|---|
| 실제 갤럭시 Z 폴드5·S22 울트라(설치 허들·제조사 WebView·카톡 공유·실제 화면 폭) | 기기 없음 — 에뮬레이터(AOSP Android 16)로 대신 | 체크리스트 2 |
| 실제 Windows `MyLearner.cmd`·한국어 콘솔 | VM 은 Linux — Actions 로(러너는 영문 Windows 라 한국어 콘솔은 `PYTHONIOENCODING=cp949` 흉내) | 1.6절 Actions, 체크리스트 3·4 |
| 폰 MWL 진도 들여오기(파일 고르기 창) | 에뮬레이터에 MWL 진도 파일을 넣는 단계를 두지 않았다 — 화면은 PC 와 같은 코드(스모크 통과) | 체크리스트 2-8 |
| 날짜 넘김(밤새) | 시간을 돌리는 시험을 두지 않았다(P3 에서 넘어옴) | 체크리스트 2-7 |

## 9. 화면 확인

`docs/screenshots/P4/` — 헤드리스 Chromium(바뀐 화면만: 설정·합치기 1280·390, 폴드5 추정 폭 344·690 의 오늘·복습·설정·합치기)과 에뮬레이터(1080×2400 — 오늘·복습·가로 통계·내보낸 뒤 설정). 직접 보고 찾은 것은 7절 6·7.

| 화면 | 파일 |
|---|---|
| 합치기 미리보기(같은 파일 다시 — 새 줄 0) | `merge-1280.png`·`merge-390.png`·`fold-merge-344.png`·`fold-merge-690.png` |
| 설정(주고받기·백업 되살리기·화면 폭) | `settings-1280.png`·`settings-390.png`·`fold-settings-344.png`·`fold-settings-690.png` |
| 오늘·복습(폴드 두 폭) | `fold-today-344.png`·`fold-today-690.png`·`fold-review-344.png`·`fold-review-690.png` |
| 안드로이드 에뮬레이터 | `emu-01-today.png`·`emu-03-review.png`·`emu-04-stats-landscape.png`·`emu-06-after-export.png` |
