# 설계서_Architecture — MyLearner 전체 골격

- 작성 2026-10-15(Phase 1) / 상위 문서: [`scope-definition.md`](scope-definition.md) / 기획 원문: [`BRIEF.md`](BRIEF.md) / 규칙: [`../CLAUDE.md`](../CLAUDE.md)
- 계속 고치는 문서다. Phase 마다 정한 것을 해당 절에 더하고, 아직 정하지 않은 것은 "Phase N 에서 정한다"로 남긴다
- 정정 이력: 2026-10-15 — 7절 시험(Python)에 3.14(`python:3.14.8-slim`)를 더했다(사용자 승인)
- 정정 이력: 2026-10-15 — 6절 '비밀'에 AI 키를 보내는 조건을 더했다(P1 독립 점검 — Phase 6 의 AI 대리 호출도 따른다)
- 정정 이력: 2026-11-10 — 8절에 받는 길(이 저장소 GitHub Release → 폰의 GitHub 앱, CLAUDE.md 7절 '릴리스')을 더했다(사용자 지시)
- 정정 이력: 2026-11-09 — Phase 3 에서 정한 것: 2절 판 설정 경로, 3절 화면·저장 어댑터·서버·Learn 변환기 행, 7절 접근성 검사·안드로이드 빌드 이미지, 8절 앱 묶음, 11절 디렉토리, 12절 추적성, 13절 접근성 검사 방법
- 정정 이력: 2026-10-15 — Phase 2 에서 정한 것: 3절(MWL 변환기는 Phase 2), 5절 형식 값, 6절 JS 파일 꼴·상수 위치 확정, 7·9절 JS 시험(Node 22.23.3·내장 커버리지), 11절 디렉토리, 12절 추적성

## 1. 범위 문서와의 경계

| 문서 | 무엇 |
|---|---|
| scope-definition | 무엇을·왜, 완성의 정의 S1~S7, Phase 로드맵, In/Out |
| BRIEF 5절 | 설계 제안의 원문(계산 JS 한 벌, 사건 기록, 늦은 복습 규칙, 저장, 렌더러, 판별 차이). 여기서 되풀이하지 않고 절 번호로 가리킨다 |
| **이 문서** | 그 제안을 어떤 폴더·모듈·규약·시험으로 구현하는가. 기능을 더할 때 어디를 고치는가 |
| `P{N}_설계서_*` | 그 Phase 기능의 인터페이스·흐름(동결) |

## 2. 아키텍처 개요

```
                 ┌──────────────── 브라우저(Chrome · 안드로이드 WebView) ────────────────┐
 과정 파일 ───▶  │ web/ — 화면(app.js) + 계산 한 벌(core/*.js: SM-2·하루 계획·숙련도·        │
 기록 파일 ◀──▶  │       사건 기록·합치기·통계·렌더러·과정 검사)                               │
                 │ 저장 어댑터: 파일(서버 모드) · 브라우저 저장소(file://) · 안드로이드 저장소 │
                 └───────────────┬──────────────────────────────────────────────────────────┘
                                 │ 서버 모드만: http://127.0.0.1 (토큰 → 쿠키, CSP)
                 ┌───────────────▼──────────────┐
                 │ mylearner/ (Python 3.9+ 표준 라이브러리) │── AI 대리 호출 ──▶ 사내 AI 서버 여러 대 · 외부 AI
                 │ 정적 파일 · 파일 저장 · 문서 텍스트 뽑기 │   (키는 서버만, 리다이렉트 안 따름)
                 └──────────────────────────────┘
 tools/ — 단독 도구(폐쇄망 점검 2종, Phase 1)      scripts/ — 검증·포장(개발 VM)
```

- 판(폐쇄망·인터넷·모바일) = 설정. 코드 분기는 없다(BRIEF 5.2). 판 설정은 `config/editions/<판>.json` — 묶을 때 `web/config.js`·묶음의 `config.json` 이 된다(`docs/P3_설계서_PC.md` 3.1절)
- 계산은 JS 한 벌이고 Python 은 서버·도구만 한다(BRIEF 5.3-1). 예외: 비밀값 가리기 규칙은 JSON 한 파일을 두 언어가 같이 읽는다(BRIEF 5.3-1, Phase 5~6)

## 3. 모듈 구조

| 모듈 | 언어 | 책임 | 등급 | 만드는 Phase |
|---|---|---|---|---|
| `tools/ai_probe.py` | Python | 폐쇄망 AI 점검·`--serve-test`·`--decode` | A(판정·코드)·B(흐름) | 1 |
| `tools/browser_probe.html` | HTML+JS | 폐쇄망 Chrome 점검 | C | 1 |
| `web/core/` | JS | SM-2·하루 계획·숙련도, 사건 기록·늦은 복습 규칙·합치기, 렌더러 이스케이프, 과정 검사, 통계 계산, 채점, MWL 진도 변환 — 파일 14개와 싣는 순서는 `docs/P2_설계서_Core.md` 2절 | A | 2 |
| `web/index.html`·`boot.js`·`config.js`·`styles.css`·`app/*.js` | JS·CSS | 화면(오늘·복습·강의·실습·드릴·퀴즈·점검·통계·과정·설정·MWL 들여오기) — MWL 골격 이식, 파일과 싣는 순서는 `docs/P3_설계서_PC.md` 2절 | C | 3 |
| `web/store/` | JS | 저장 어댑터 — `common.js`(순수, A)·`browser.js`(localStorage 달별 키 + IndexedDB)·`server.js`(로컬 서버)·`idb.js`, 안드로이드는 Phase 4. 같은 인터페이스(DIP, `docs/P3_설계서_PC.md` 3.2절) | A·B | 3·4 |
| `mylearner/` | Python | 로컬 서버(`server.py` — 정적 파일·기록·과정·백업 API, 토큰, 보안 헤더), 데이터 폴더(`storage.py`), CLI `python -m mylearner serve`(`__main__.py`). AI 대리 호출은 Phase 6 | B(순수 함수 A) | 3 |
| `mylearner/convert/` | Python | MWL 과정(`mwl.py`, Phase 2)·Learn 자료(`learn.py`, Phase 3) → 과정 파일 변환 | B | 2·3 |
| `mylearner/extract/` | Python | DOCX·HWPX·PPTX 텍스트 뽑기 | A | 6 |
| `mylearner/ai/` | Python | 서버×모델 프로필, 긴 자료 처리 단계 | B | 6 |
| `mobile/android/` | Java | APK 껍데기(인터넷 권한 0) | B | 4 |
| `scripts/pack_app.py` | Python | 과정 자료 JS 감싸기·판 설정·반입 묶음(.tgz·.zip, 재현·판별 검사) | B(측정 폴더 밖 — 시험만) | 3 |
| `scripts/app_smoke.py` + `tests/ui/app_check.js`·`a11y.js` | Python·JS | 화면 스모크(Chromium, `file://`·서버 모드)·접근성·스크린샷 | C | 3 |

- 가장 바뀌기 쉬운 두 축은 **저장 어댑터**와 **AI 연결**이다(CLAUDE.md 2절) — 상위 로직은 그 인터페이스에만 기댄다

## 4. 외부 서비스 연동

| 상대 | 누가 부르나 | 규약 | 근거·확인 |
|---|---|---|---|
| 사내 AI 서버(vLLM 1대 + 서빙 방식 모르는 1대) | 로컬 서버(Phase 6). Phase 1 은 `ai_probe.py` 가 잰다 | OpenAI 호환 `/v1/chat/completions`·`/v1/models`(+ 있으면 `/v1/responses`) · 리다이렉트 안 따름 · 서버별 동시 호출 1~2 · 취소하면 상류도 끊음 | 개발 에이전트는 닿지 못한다. 사실은 사용자가 전한 결과 코드(P1 테스트결과서)로 정한다 |
| 외부 AI(Anthropic·OpenAI) | 로컬 서버(Phase 6, 인터넷판만) | 키는 서버 파일에만 | 보류 결정 5 |
| GitHub | 개발 VM 의 git | `origin` HTTPS + `gh` 인증(CLAUDE.md 0절) | 2026-10-15 `git ls-remote` |
| Docker 이미지 | 개발 VM 의 시험 | 판 고정 — `scripts/dev_tools.env` | 7절 |

## 5. 데이터 흐름

- 과정: 원본(MWL `content/`·Learn `content/`·사용자 자료) → 변환·만들기 → **과정 파일**(머리 `{format, version, min_reader}`) → 브라우저가 읽어 그린다. 원본 → 산출물 단방향, 산출물을 손으로 고치지 않는다(CLAUDE.md 6절)
- 기록: 브라우저가 사건을 덧붙인다 → 저장 어댑터 → 기록 파일(JSONL)·하루 스냅숏. 기기 사이는 파일로 합친다(합집합). 폐쇄망은 들여오기만
- 형식: 과정 파일 `mylearner-course` v1, 기록 파일 `mylearner-log` v1(첫 줄 머리 + 사건 한 줄씩), 사건 봉투 `{v, dev, seq, t, day, type}` — 값과 규칙은 `docs/P2_설계서_Core.md` 3.2·3.3절, 상수는 `web/core/constants.js` 의 `SHARED`

## 6. 공통 규약

| 규약 | 내용 |
|---|---|
| 파일 머리 | 코드 파일 첫 주석·docstring 에 입력·출력·트리거·대응 문서(요구사항·설계서 경로)를 적는다(CLAUDE.md 4·6절) |
| 도메인 상수 | Python 은 `mylearner/constants.py`, JS 는 `web/core/constants.js` 한 곳. 두 언어가 함께 쓰는 값은 `SHARED` 묶음으로 두고 `tests/unit/py/test_constants_shared.py` 가 같은지 본다. **예외**: `tools/` 의 단독 도구는 들고 다니는 파일 하나라 자기 상수를 머리에 둔다 |
| 판별 설정 | `config/*.json`(AI 프리셋·허용 행선지·저장 어댑터·포장). 코드 분기 없음 |
| 비밀 | 키는 로컬 서버가 읽는 파일에만, 커밋은 `*.example` 만. 화면·로그·결과 요약에 주소·키를 찍지 않는다. **AI 키를 보내는 조건**(P1 독립 점검, `docs/P1_설계서_Probe.md` 3.3절 '키 정책'): 리다이렉트를 따르지 않는다(3xx 처리기 자체를 끈다 — T-003), 서버가 JSON 401·403 으로 요구할 때만, 평문 http 는 프록시를 지나지 않게(urllib 의 `NO_PROXY` 판정을 믿지 않는다 — T-004). 서버가 준 글(Server 헤더·판·모델 이름)은 정해진 모양만 화면·결과로 낸다 |
| 브라우저 JS | **classic script 만 쓴다** — `file://` 에서 `<script type="module">` 은 돌지 않고 `new Worker()` 는 `SecurityError` 다(2026-10-15 헤드리스 Chromium 153 으로 확인, 폐쇄망 Chrome 150 은 `browser_probe.html` 결과로 다시 본다). 파일마다 즉시 실행 함수로 감싸 전역 이름 하나(`MyLearner`)에만 붙이고, Node 시험을 위해 `module.exports` 도 둔다(2026-10-15 확정 — 꼴은 `docs/P2_설계서_Core.md` 3.1절, 실제 Chromium `file://` 확인은 `scripts/render_smoke.py`, 규칙 검사는 `scripts/check_core_js.py`) |
| 자기 파일 읽기 | `file://` 에서 `fetch` 가 막힌다(같은 확인) → 데이터는 `<script>` 로 싣는 묶음 파일 또는 사용자가 고른 파일로 읽는다(Phase 3) |
| 콘솔 출력 | cp949 로 나타낼 수 있는 글자만(한국어 Windows). 이모지·특수 기호를 쓰지 않는다 |
| Python 판 | 3.9 문법·표준 라이브러리. 3.12~3.14 에서 없어진 모듈(`distutils`·`imp`·`cgi`·`asyncore` 등)을 쓰지 않는다 |
| 날짜·시각 | 사건에는 UTC 시각(`toISOString` 꼴)과 그 기기의 학습일(`day`)을 함께 둔다(BRIEF 5.3-2). 학습일은 `day_start_hour`(기본 0 — 자정, P2 인터뷰 2번)에 바뀐다 |
| 소스 글자 | JS·HTML 소스에 보이지 않는 글자(제어·서식·사용자 영역·U+2028/2029)를 날것으로 두지 않고 `\uXXXX` 로 쓴다(트러블슈팅 T-005, `scripts/check_core_js.py`) |

## 7. 기술 스택

| 쓰임 | 무엇 | 판 고정 |
|---|---|---|
| 런타임 서버·도구 | Python 표준 라이브러리 | 3.9 이상(폐쇄망 PC 3.14·3.12·3.9) |
| 런타임 화면 | 바닐라 JS + 토큰 CSS, 외부 라이브러리 0 | Chrome 150 기준 |
| 안드로이드 | WebView 껍데기(MWL 시제품 이식) | Phase 4. 빌드 이미지 `ghcr.io/cirruslabs/android-sdk:36`(digest `f9b3ea9ed2b5…`, 2026-11-09 받음) — JDK 21.0.9·build-tools 36.0.0·android-36, Gradle 없음. 이 이미지로 WebView 최소 APK 빌드·서명을 `--network none` 에서 확인(권한 0) |
| 시험(Python) | `unittest` + `scripts/coverage_lite.py` | 개발 VM 3.9.21·3.11.9, Playwright 이미지의 3.12.3, `python:3.14.8-slim` 의 3.14.8(2026-10-15 받음 — DeprecationWarning 은 실패) |
| 시험(JS) | Node 내장 시험 실행기 + 내장 커버리지(`--experimental-test-coverage`, `web/core` 줄 90%·분기 80% — `scripts/run_js_tests.sh`) | `node:22.23.3-alpine`(2026-10-15 받음, digest `0a7108bf6c7b…`) |
| 화면 확인 | Playwright 이미지의 Chromium(헤드리스) | `mcr.microsoft.com/playwright:v1.63.0-noble` — Chromium 153.0.8010.12, 이 VM 에 이미 있다(2026-10-15). 접근성은 `tests/ui/a11y.js` 를 DevTools 평가로 넣어 본다(npm 받지 않음 — Phase 3) |

개발 전용 도구의 판은 `scripts/dev_tools.env` 한 곳에 적고 스크립트가 거기서 읽는다(CLAUDE.md 7절).

## 8. 배포 구성

| 묶음 | 내용 | 만드는 것 | Phase |
|---|---|---|---|
| 점검 묶음 `dist/mylearner-probe-v<판>.tgz` | `ai_probe.py`·`browser_probe.html`·`README_KO.txt` | `python3 scripts/pack_probe.py` | 1 |
| 폐쇄망 `dist/mylearner-closed-v<판>.tgz` / 인터넷판 `dist/mylearner-internet-v<판>.tgz`·`.zip` | 앱 전체(웹·서버·과정 자료 — 같은 묶음, 판 설정만 다름) | `python3 scripts/pack_app.py --edition closed\|internet` | 3 — 폐쇄망 `.zip` 은 4(폐쇄망 반입은 zip, P4 인터뷰 3번) |
| APK | 새 패키지 이름·서명 키 | Phase 4 | 4 |

모든 묶음과 APK 는 이 저장소의 GitHub Release(`v<판>`)로 내고, 사용자는 폰의 GitHub 앱(내 계정)에서 받는다 — 절차는 CLAUDE.md 7절 '릴리스'(첫 릴리스 `v0.3.0`, 2026-11-10).

모든 묶음은 같은 입력이면 같은 바이트이고, 폐쇄망 묶음에는 외부 URL 이 없다(CLAUDE.md 5·13절) — 검사는 전체 검증에 있다.

## 9. 테스트 전략

| 등급 | Python | JS | 실행 |
|---|---|---|---|
| A 핵심 순수 로직 | `tests/unit/py/` | `tests/unit/js/` | 시험 먼저 |
| B 오케스트레이션·통합 | `tests/integration/py/`(가짜 서버) | `tests/integration/js/` | 구현 뒤 |
| 실제 외부 호출 | `tests/e2e/`(기본 실행 제외) | — | 손으로 |
| C 화면·콘텐츠·도구 | 산출물 검사 스크립트(`scripts/check_*.py`)·헤드리스 스모크(`scripts/browser_smoke.py`) | — | 전체 검증 |

- Python 시험 실행: `python3 -m unittest discover -s tests/unit/py -t .` (통합은 `tests/integration/py`). 시험 파일은 `tests/` 를 패키지로 두고 저장소 루트에서 돈다
- 커버리지: `python3 scripts/coverage_lite.py --enforce` — 표준 라이브러리 `sys.settrace` 줄 커버리지. 등급은 `scripts/coverage_grades.json` 에서 파일 단위 또는 `경로::함수이름패턴` 단위로 배정한다(한 파일 안에 판정 함수 A 와 흐름 B 가 같이 있는 단독 도구 때문). 기준 A ≥ 90%, B ≥ 70%
- 전체 검증: `bash scripts/verify.sh`(단계는 그 파일 머리와 P1 테스트결과서). 종료 코드 0 일 때만 커밋·병합한다

## 10. 기능을 더할 때 손대는 곳

| 하고 싶은 것 | 고칠 곳 | 함께 고칠 것 |
|---|---|---|
| 점검 도구에 시험 하나 더하기 | `tools/ai_probe.py` 의 `probe_model`(또는 `browser_probe.html`) + 결과 코드 칸 | P1 설계서 3.1 칸 표, `explain` 의 풀이, 코드 판(`v`)을 올린다, 시험 |
| 검증 단계 더하기 | `scripts/verify.sh` 의 단계 목록 | P{N} 테스트결과서의 단계 표 |
| 개발 도구 판 바꾸기 | `scripts/dev_tools.env` | 이 문서 7절 |
| 새 문서 종류 | `scripts/verify_docs.py` 대상 묶음 | CLAUDE.md 9절 |
| 계산 규칙 | `web/core/*.js` + 골든 벡터(`tests/fixtures/mwl/`) | 그 Phase 설계서 |
| core JS 파일 더하기 | `web/core/<이름>.js`(3.1절 꼴) | 싣는 순서 — `tests/unit/js/umd.test.js` 의 `ORDER`, `tests/ui/render_check.html`, `scripts/render_smoke.py` 의 수 |
| MWL 기준 커밋 바꾸기 | `mylearner/constants.py` 의 `MWL_COMMIT` → `python3 scripts/import_mwl_fixtures.py` | CLAUDE.md 0절, 옮긴 코드의 머리 주석 |

## 11. 디렉토리 구조

```
MyLearner/
├── README.md · CLAUDE.md · .gitignore
├── tools/                  단독 도구 — 폐쇄망에 들고 간다(파일 하나씩)
│   ├── ai_probe.py
│   └── browser_probe.html
├── web/                    화면(Phase 3): index.html · boot.js · config.js(생성물) · styles.css · app/ · store/ · data/(생성물, 커밋 안 함)
│   └── core/               계산 한 벌(JS, classic script) — Phase 2(+ checkup.js Phase 3)
├── mylearner/              Python 패키지: constants · server · storage · __main__(serve) · convert/(mwl·learn)
├── config/                 판 설정 editions/(closed·internet) · 묶음 안내 bundle/
├── scripts/                검증·포장(개발 VM). dev_tools.env 에 도구 판
├── tests/
│   ├── unit/py/ · unit/js/             등급 A
│   ├── integration/py/ · integration/js/  등급 B — fakes.py 가짜 AI 서버
│   ├── fixtures/           고정 자료 — mwl/(MWL 골든 벡터 복사본·기준 커밋 source.json), XSS 사례, 렌더러 입력
│   ├── realdata/           MWL 실데이터 대조(Node)
│   ├── ui/                 CDP 로 Chromium 을 몬다(cdp.js), 렌더러 점검 페이지
│   └── e2e/                실제 외부 호출(기본 실행 제외, 아직 없음)
├── docs/                   scope·Architecture·P{N} 문서·트러블슈팅 (+ screenshots/P{N}/)
├── history/                세션 기록
├── dist/                   생성물(커밋하지 않음 — 바꾼 MWL 과정 파일도)
│   (Phase 4~) mobile/
```

## 12. 문서 간 추적성

| 묶음 | 요구사항 | 설계 | 코드 | 결과 |
|---|---|---|---|---|
| Phase 1 Probe | [`P1_요구사항정의서_Probe.md`](P1_요구사항정의서_Probe.md) FR-101~169 | [`P1_설계서_Probe.md`](P1_설계서_Probe.md) 6절 표 | `tools/`, `scripts/` | [`P1_테스트결과서_Probe.md`](P1_테스트결과서_Probe.md) 4절 |
| Phase 2 Core | [`P2_요구사항정의서_Core.md`](P2_요구사항정의서_Core.md) FR-201~263 | [`P2_설계서_Core.md`](P2_설계서_Core.md) 6절 표 | `web/core/`, `mylearner/`, `scripts/` | [`P2_테스트결과서_Core.md`](P2_테스트결과서_Core.md) 4절 |
| Phase 3 PC | [`P3_요구사항정의서_PC.md`](P3_요구사항정의서_PC.md) FR-301~364 | [`P3_설계서_PC.md`](P3_설계서_PC.md) 6절 표 | `web/`, `mylearner/`, `config/`, `scripts/` | [`P3_테스트결과서_PC.md`](P3_테스트결과서_PC.md) 4절 |

코드 머리 주석이 요구사항·설계서 경로를 가리키고, 설계서 6절이 FR → 코드·시험을 가리킨다.

## 13. 화면 기준

- **원칙**: MWL 화면 원칙 다섯을 잇는다 — 한 화면 기본 버튼 하나, '오늘'은 순서 목록, 본문 먼저, 상태는 한눈에(색만으로 말하지 않는다), 메뉴는 묶어서(BRIEF 5.1, MWL `docs/설계서_Architecture.md` 6.3 v1.6.0, 기준 커밋 `e053470`)
- **토큰 파일**: `web/styles.css` 한 곳(Phase 3 에서 MWL 것을 옮겨 온다). 색은 파랑 한 계열 + 중립 회색 + 상태 3색, 글자색은 WCAG AA(본문 4.5:1)를 계산해 고른다(MWL 6.3 '색과 차트')
- **UI 라이브러리**: 없음 — 바닐라 JS + 토큰 CSS(사용자 결정 2026-10-15, 폐쇄망·`file://`·외부 자원 0). 차트는 인라인 SVG
- **공통 컴포넌트**: MWL `web/app.js` 의 골격(메뉴 세 묶음·오늘 순서 목록·강의 리더·복습·통계·화면 설정·`esc()`·날짜 넘김)을 옮겨 고친다(Phase 3)
- **참고 사례**: 어워드 수상작은 쓰지 않는다 — 사용자가 MWL 골격을 고름(인터뷰 10번). MWL 이 참고한 외부 사례는 MWL `docs/internal/P0_검토서_외부비교.md` 9절
- **지키는 제약**: 외부 자원 0, 새 CSS 기능(`:has`·중첩·`color-mix`·컨테이너 쿼리) 쓰지 않음(MWL 6.3 — Chrome 150 에서 다시 정할 수 있다, Phase 3), 화면마다 빈 화면·로딩·오류 상태
- **예외**: `tools/browser_probe.html` 은 토큰 파일보다 먼저 나오는 단독 도구라 인라인 CSS 를 쓴다(P1 설계서 8절)
- **확인**: 화면을 바꾼 Phase 는 PC(1280px)·휴대폰(390px) 폭 스크린샷을 `docs/screenshots/P{N}/` 에 두고 테스트결과서 "화면 확인"에 남긴다. 접근성 자동 검사는 Phase 1 은 정적 검사(`scripts/check_probe_html.py`), 앱 화면(Phase 3)은 `tests/ui/a11y.js`(이름 없는 조작 요소·`lang`·제목 순서·양수 tabindex·중복 id·글자 대비 — npm 을 받지 않고 CDP 로 넣는다, `scripts/app_smoke.py`)
