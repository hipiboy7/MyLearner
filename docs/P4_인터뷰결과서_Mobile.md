# P4 인터뷰결과서 — 폰에서 배우기 + 합치기

- 정정 이력: 2026-11-10 — 5절(저장소 public 전환·GitHub Actions 시험 2종·커밋 메일)을 덧붙이고, 2절 7번의 'private' 에 그 뜻을 달았다
- 인터뷰 일자: 2026-11-10 / 대상: 사용자 / 진행: Claude Opus 5.5 · effort xhigh(환경 변수)
- 상위 문서: [`BRIEF.md`](BRIEF.md) 5.2·5.3-2·5.9, [`scope-definition.md`](scope-definition.md) 2·8·9절, [`P3_인터뷰결과서_PC.md`](P3_인터뷰결과서_PC.md), [`P3_설계서_PC.md`](P3_설계서_PC.md) 3.2·7절 / 반영할 곳: `P4_요구사항정의서_Mobile.md`·`P4_설계서_Mobile.md`(만들 것)
- 방식: BRIEF·P3 산출물, MWL `main` 의 안드로이드 시제품(MWL `mobile/android/`, MWL `docs/설계서_Architecture.md` 6.6)을 먼저 읽었다. Phase 4 가 트리거인 보류 결정 3 과 합치기·폐쇄망 반입·폰 과정·폰 MWL·폰 판·받는 길을 한 번에 물었다(CLAUDE.md 1절 1단계)

## 1. 요약

- 패키지 이름은 사용자 답 `MyLearningPlatform` 이다. 안드로이드 패키지 이름은 점으로 나눈 꼴이어야 해서 `io.github.hipiboy7.mylearningplatform`(앱 이름 `MyLearningPlatform`)으로 제안했다 — **사용자 재확인 대기**(보류 결정 3). 서명 키는 추천대로 새로 만든다
- 폐쇄망 PC(인터넷 없는 Windows)에는 **zip** 으로 들여와 풀어 쓴다. 2026-10-15 의 '`.tgz` 반입'이 바뀌었다 — 폐쇄망판 묶음과 기록 반입 파일을 zip 으로 낸다
- 폰은 안드로이드 — **갤럭시 Z 폴드5 · 갤럭시 S22 울트라** 두 대. APK 는 GitHub 앱(내 계정) → 저장소 → MyLearner → 릴리스에서 받는다(CLAUDE.md 7절 '릴리스')
- 쓰는 곳은 셋 — 폰 · 폐쇄망 · 인터넷망(내 PC). 폰에서 MWL(미들웨어 과정)을 쓸 수 있게 한다
- 지원 판 Android 8.0(minSdk 26) 이상 · targetSdk 36, 에뮬레이터 시스템 이미지를 받아 시험해도 된다

## 2. 문답

| # | 질문 | 사용자의 답 | 정한 것 |
|---|---|---|---|
| 1 | 보류 결정 3 — 패키지 이름(추천 `io.github.hipiboy7.mylearner`) | "MyLearningPlatform" | 패키지 이름 `io.github.hipiboy7.mylearningplatform` · 앱 이름 `MyLearningPlatform` 으로 제안 — 사용자 재확인 뒤 확정(한 번 정하면 바꿀 수 없다: 바꾸면 다른 앱이 되어 앱 안 기록이 이어지지 않는다) |
| 2 | 보류 결정 3 — 서명 키 보관·백업(추천: 새 키, 이 계정 홈 + `/data` 개인 폴더 사본 + VM 밖 한 부) | "추천대로" | 새 키(RSA 3072·PKCS12). 원본 이 VM 계정 `~/.config/mylearner/`(키 파일 + 비밀번호 파일, 권한 600, 저장소 밖), 사본 이 계정 `/data` 개인 폴더(700), VM 밖 한 부는 사용자가 보관. MWL 키는 다시 쓰지 않는다. 키 값·비밀번호는 어디에도 적지 않는다 |
| 3 | 폐쇄망 반입 꼴과 경로 | "폐쇄망은 인터넷이 안되는 윈도우 OS 환경에 zip 파일 형태로 들여와서 압축을 풀고 사용 예정" | 폐쇄망판 묶음을 `.zip` 으로 낸다(`.tgz` 도 함께 — 사용자 재확인). 인터넷판이 만드는 '폐쇄망 반입 파일'(기록 + 사용자 과정)도 `.zip` 이고 폐쇄망 앱이 풀지 않고 바로 읽는다. 경로는 폰 → 내 PC(인터넷망) → 폐쇄망 PC |
| 4 | 폰에 넣을 과정(추천: PC 묶음과 같은 셋) | (따로 답하지 않음 — 5번 "MWL 앱을 폰에서 쓸 수 있게") | PC 묶음과 같은 셋(미들웨어 과정 · MWM 미들웨어관리소 학습 · llm-chat-agent 학습). S6(Learn 자료를 폰에서 복습) |
| 5 | 폰에서 MWL 앱을 쓰는지 · 폰에서 MWL 진도 들여오기 | "폰과 폐쇄망, 인터넷망 3군대에서 사용할 거야. MWL 앱을 폰에서 쓸 수 있게 개발해" | 폰 앱에 미들웨어 과정을 싣고, 폰에서도 'MWL 진도 들여오기'(파일 고르기 — PC 와 같은 화면)를 쓸 수 있게 한다. MWL 저장소의 앱을 고치는 것은 아니다(사용자 재확인) |
| 6 | (a) 폰 안드로이드 판 (b) 에뮬레이터 시스템 이미지 받기(약 1.5 GB ⚠️) | "추천대로" · 폰은 갤럭시 Z 폴드5 · S22 울트라(4번 답) | minSdk 26 · targetSdk 36(빌드 이미지 `ANDROID_IMAGE` 의 android-36). 에뮬레이터 시스템 이미지를 `/data` 에 받아 설치·누르기·강제 종료 뒤 기록 남음을 시험한다(CLAUDE.md 11절 허락받은 것). 폴드5 는 접은 화면(좁음)·펼친 화면(넓음)을 모두 화면 확인에 넣는다 — 폭 값은 설계서에서 기기 사양으로 정한다 |
| 7 | APK 를 폰에 받는 길 | "github 앱 로그인 > 상위리포지토리 > mylearner 리포지토리 > 릴리스" | 이 저장소(그때 private — 5절에서 작업 완료까지 public)의 GitHub Release. 받는 곳용 저장소는 따로 두지 않는다. 절차는 CLAUDE.md 7절 '릴리스' — 첫 릴리스 `v0.3.0`(Phase 3 묶음, 2026-11-10) |

## 3. 에이전트가 정한 기본값 (2026-11-10 질문과 함께 알렸다 — 사용자 이견 없음)

| 정한 것 | 이유 |
|---|---|
| 폰 저장 = 앱 전용 파일(`log.jsonl`)에 브리지로 원자적 덧붙이기. 저장 어댑터 인터페이스 그대로(`docs/P3_설계서_PC.md` 3.2절) | MWL 시제품은 WebView localStorage 가 쓰기를 몇 초 모아 디스크에 적어, 그 사이 강제 종료하면 마지막 채점이 사라졌다(MWL 6.6 '진도 저장') |
| 폰 ⇄ 내 PC 옮기기 = 폰 '공유'(카톡 나에게·메일·드라이브 앱) + '파일로 저장'(위치 고르기), PC 는 내려받기 + 파일 고르기 | 앱은 인터넷 권한 0 그대로 — 보내는 것은 넘겨받은 앱이다 |
| 교환 파일 = 모든 기기 기록 + 사용자 과정(`mwl-notes`)을 한 파일에 | 받은 쪽에 과정 없는 카드 기록이 생기지 않게 |
| 합치기 = 미리보기(새 줄 수 — 기기·과정·날짜 범위, 충돌·모르는 종류·미래 날짜 수) → 확인 → 자동 백업 → 합침 | 기록 유실 0(S3) — 가져오기 전에 백업(CLAUDE.md 13절) |
| 되돌리기 = 그 들여오기로 새로 들어온 줄만 뺀다. 백업에서 통째로 되살리기는 따로(그 뒤 쓴 기록을 다시 얹는다) | 잘못 들여온 파일을 되돌려도 그 뒤 이 기기에서 쓴 기록은 남게 |
| 마지막 내보내기가 7일 넘으면 '오늘' 위에 띠 | 앱을 지우면 앱 안 기록이 사라진다(안드로이드 규칙) |
| 폰 화면 = PC 와 같은 화면 · 손가락 기준 · AI 없음 · 강의 외부 링크는 물어본 뒤 폰 브라우저로 | BRIEF 5.2(모바일판 AI 없음)·MWL 6.6 |
| 폐쇄망판은 지금처럼 내보내기 없음 — 들여오기·되돌리기만 | 폐쇄망은 들여오기만(CLAUDE.md 0절) |

## 4. 남은 확인 (사용자 재확인 — 다음 대화)

| # | 무엇 | 제안 |
|---|---|---|
| 1 | 패키지 이름의 꼴 | `io.github.hipiboy7.mylearningplatform` + 앱 이름 `MyLearningPlatform` |
| 2 | 폐쇄망판 `.tgz` 도 계속 낼지 | zip 을 기본으로 안내하고 `.tgz` 도 함께 낸다 |
| 3 | 5번 '폰에서 MWL' 의 뜻 | MyLearner 폰 앱에서 미들웨어 과정 + MWL 진도 들여오기(MWL 저장소의 앱은 고치지 않는다) |

## 5. 덧붙인 문답 — 저장소 public 전환과 GitHub Actions (2026-11-10)

사용자가 "작업 완료될때까지 public으로 작업하고 다시 private으로 돌리려고 해", 이유는 "Actions 분 수 · artifact 한도 때문에 필요해"라고 했다. 에이전트가 사실(아래)과 공개되는 것 넷을 알리고 세 가지를 물었고, 답은 "1 추천대로, 2 추천대로, 3 그 순서로 진행해"다.

| # | 질문 | 답 | 정한 것 |
|---|---|---|---|
| 1 | Actions 로 무엇을 돌리나(추천: Windows 실기 시험 · 안드로이드 에뮬레이터 시험 — VM 에서 못 하는 것) | 추천대로 | Phase 4 요구사항정의서에 CI FR 둘: Windows 러너의 묶음 실기(`MyLearner.cmd`·`py -3`), Linux 러너의 에뮬레이터 시험(설치·누르기·강제 종료 뒤 기록 남음). 규칙은 CLAUDE.md 7절 'GitHub Actions' |
| 2 | 공개되는 것 넷을 받아들이나 — 커밋 작성자 메일, Release 의 과정 자료(미들웨어 과정·Learn 자료 둘), MWL 에서 옮긴 코드·시험 자료, 사내 환경 설명(모델 이름·폐쇄망 규칙 — 주소·IP·계정·키는 없음). 커밋 메일은 추천: 앞으로의 커밋만 GitHub noreply, 이력은 그대로 | 추천대로 | 넷 다 받아들인다. 이 저장소 `user.email` = GitHub noreply(CLAUDE.md 11절 '커밋 메일'). 그 전 커밋(28개)은 이력 재작성하지 않는다 |
| 3 | 진행 순서: CLAUDE.md 규칙 고치기 → 전체 검증 → `impl-phase4` push → `gh repo edit hipiboy7/MyLearner --visibility public --accept-visibility-change-consequences` | 그 순서로 | 되돌리기는 CLAUDE.md 보류 결정 10(트리거: 작업 완료) |

알린 사실(GitHub 문서, 2026-11-10 읽음 — [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) · [Product usage included](https://docs.github.com/en/billing/reference/product-usage-included)):

- public 저장소의 표준 GitHub 러너는 무료다. 큰 러너는 public 이어도 유료
- 무료 플랜의 private 는 월 $12 상당 실행 시간(Linux 단가 $0.006/분이면 약 2,000분 — 단가로 계산한 값), artifact 저장 500 MB(Packages 와 함께), cache 저장소마다 10 GB. 이 계정의 플랜은 확인하지 못했다(`gh` 토큰에 `user` 권한 없음) ⚠️
- public 저장소의 artifact 저장 한도는 문서에 따로 없었다 ⚠️. Release 파일은 Actions artifact 와 따로 센다
- 공개 전 점검(2026-11-10): 모든 브랜치 이력에서 RFC 5737·루프백 밖 IPv4 0, 키·토큰 꼴 0, 실제 사내 호스트 0(시험의 `*.corp.example`·`*.internal` 은 가짜 값), 커밋된 비밀 파일 0
