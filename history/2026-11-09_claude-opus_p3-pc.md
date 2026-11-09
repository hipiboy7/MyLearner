# 2026-11-09 — Phase 3(PC 에서 배우기) 착수·구현 · Phase 2 병합 · 안드로이드 빌드 이미지

- 작업자: Claude Opus 5.5(effort xhigh — 환경 변수) / 브랜치: `main`(Phase 2 병합) → `impl-phase3` / 이전 세션: [`2026-11-09_claude-opus_p2-verify-fix.md`](2026-11-09_claude-opus_p2-verify-fix.md)(같은 대화)

## 1. 한 일

- Phase 2 종료 루틴: 전체 검증 18단계 통과 → `main` 에 `merge --no-ff`(`30b7b82`) → `main`·`impl-phase2` push(사용자 요청)
- 안드로이드 빌드 이미지(사용자 요청): `ghcr.io/cirruslabs/android-sdk:36@sha256:f9b3ea9ed2b5…`(압축 1.09 GB, 풀면 3.83 GB — JDK 21.0.9·build-tools 36.0.0·android-36, Gradle 없음)를 받았다. Docker 데이터는 `/data` 에 있다(`/etc/fstab` bind mount). `--network none` 에서 WebView 최소 APK 를 빌드·서명·검증(권한 0). 압축 백업은 이 계정의 `/data` 개인 폴더 `docker-images/`(sha256 확인). `/data` 여유 52G → 46G. 지운 것 없음. `scripts/dev_tools.env` `ANDROID_IMAGE`, `check_env.sh` 참고 줄, CLAUDE.md 0·11절, Architecture 7절
- Phase 3 인터뷰(묶어서 한 번 — 보류 결정 1·2·7 + 내 PC): 통계 BRIEF 5.4 전부 ①~⑥ 순서 / MWL **병행** / 저장 잠정(서버=파일, file://=localStorage 달별 키 + IndexedDB) / 내 PC = 폐쇄망 PC 범위. 사용자 지시: 체크리스트를 기다리지 않는다 → [`docs/P3_인터뷰결과서_PC.md`](../docs/P3_인터뷰결과서_PC.md), CLAUDE.md 보류 결정 표 1·2 닫음·7 잠정·8 트리거 갱신
- 요구사항(FR-301~364)·설계서 → 코드(시험 먼저: `checkup.js`·`stats.js` 넓히기·`markdown.js` `allowLink`·`store/common.js`, 구현 뒤: 어댑터·서버·Learn 변환기·묶음)·화면(MWL 골격 이식) → 화면 스모크·접근성·스크린샷

## 2. 검증 상태

- `bash scripts/verify.sh`(전체) → 20단계 통과(2026-11-09, 커밋 직전 — 출력은 `docs/P3_테스트결과서_PC.md` 1.1). 새 단계 18 앱 묶음 재현·판별, 19 화면 스모크
- JS 시험 131건(`web/core`·`web/store` 줄 100%·분기 87.81%), Python 248건(A 96.6%·B 95.7%)
- 화면 스모크: file://(폐쇄망판)·서버 모드(인터넷판) 문제 0 — 접근성 위반 0, 브라우저 오류 0, 다시 연 뒤 사라진 사건 0, 서버 데이터 폴더에 없는 줄 0, MWL 들여오기 변환 일치 30/30·두 번째 새 줄 0, 사건 5,054줄 첫 화면 383 ms·복습 한 장 133 ms
- 묶음: `dist/mylearner-closed-v0.3.0.tgz`(2,368,482 B)·`mylearner-internet-v0.3.0.tgz`·`.zip` — 두 번 같은 바이트, 폐쇄망판 앱 파일 외부 URL 0. 푼 폴더에서 서버가 뜬다
- 스크린샷 18장 `docs/screenshots/P3/` — 직접 봤다(테스트결과서 9절)

## 3. 다음 단계

1. **사용자 확인 요청(결과 보고에서 물었다)**: ① 독립 점검(저장 어댑터·로컬 서버 — 기록 유실·토큰·경로, CLAUDE.md 12절) 서브에이전트 승인 ② 묶음 검사 '외부 URL 0' 을 앱 파일에만 적용하고 과정 자료 안 주소는 세기만 하는 판단 재확인 ③ `impl-phase3` push 여부
2. 승인되면 독립 점검 → 지적을 원문으로 확인 → 반영 → 테스트결과서 5.2절
3. 사람 리뷰: 체크리스트 [`docs/P3_체크리스트_PC.md`](../docs/P3_체크리스트_PC.md) — 내 PC(인터넷판 ZIP)·폐쇄망 PC(폐쇄망판 .tgz, MWL 진도 들여오기). 피드백은 기다리지 않는다
4. 사용자가 병합을 요청하면 종료 루틴(CLAUDE.md 1절 9단계)
5. 보류 결정 8(폐쇄망 점검 결과 코드)이 오면 보류 결정 7 을 확정하고 P3 인터뷰결과서에 덧붙인다
6. Phase 4 입력: 안드로이드 빌드 이미지 준비됨(`ANDROID_IMAGE`, Gradle 없이 aapt2·d8·apksigner 로 빌드 확인), 보류 결정 3(패키지 이름·서명 키), 합치기 화면(미리보기·백업·되돌리기 — 백업 목록은 Phase 3 에 있음), 안드로이드 저장 어댑터(같은 인터페이스 — `docs/P3_설계서_PC.md` 3.2절)

## 4. 판단·관찰

- `file://` 에서 메타 CSP `'self'` 는 같은 폴더 스크립트(정적·동적)·스타일시트·localStorage·IndexedDB 를 막지 않고 인라인 `style` 속성만 막는다(헤드리스 Chromium 153, 2026-11-09) — 진행 막대 폭은 CSSOM 으로
- 화면 스모크가 잡은 것: 쓰는 탭 임대가 다시 연 탭을 6초 읽기 전용으로 둠(T-010 — 닫을 때 놓기), 스크린샷이 수십 초 늦거나 멈춤(T-011 — 경주 타이머 unref·창 늘려 찍기), 그 고침이 만든 간헐 실패(브라우저 끝 기다림 — T-009 의 보호 문구가 잡음), 제목 단계 건너뜀(h1→h3)
- 스크린샷을 직접 보고 찾은 것: 390px 에서 통계 차트 글자 약 5px(FR-347) → 좁은 화면 폭으로 그리기
- 묶음의 '외부 URL 0': 과정 자료(MWL·Learn 글)에는 문서 주소 101종이 있다. 앱 파일에만 0 을 걸고 폐쇄망판은 강의 링크를 글로만 보인다 — 사용자 재확인 대기
- 비용: 누적 $140.44(API 정가, `python3 scripts/usage_cost.py --record` 커밋 직전)
