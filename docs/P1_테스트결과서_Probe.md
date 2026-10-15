# P1 테스트결과서 — Probe (폐쇄망 점검 도구 2종 · 검증 체계)

- 실행 일자 2026-10-15 / 브랜치 `impl-phase1` / 실행한 곳: 개발 VM(RHEL 9.6, Python 3.9.21·3.11.9, Docker 29.6.1)
- 대응 요구사항: [`P1_요구사항정의서_Probe.md`](P1_요구사항정의서_Probe.md) FR-101~169, NFR-101~107 / 대응 설계서: [`P1_설계서_Probe.md`](P1_설계서_Probe.md)
- **확인한 것**: 전체 검증 11단계 통과, 시험 141건(Python 3.9·3.11·3.12 각각), 커버리지 A 95.5%·B 97.0%, 헤드리스 Chromium 153 에서 `file://`·`http://127.0.0.1` 스모크, 묶음 재현
- **확인하지 못한 것**: 사내 AI 실호출, Windows·Chrome 150(폐쇄망 PC — 사용자가 체크리스트로), Python 3.14, 독립 점검(사용자 승인 대기) — 8절

## 1. 실행 증거

### 1.1 전체 검증 — `bash scripts/verify.sh`

```text
== MyLearner 전체 검증 2026-10-15 11:27
  0 환경 확인                통과   0s
  1 시험 Python 3.9            통과   18s
  2 시험 Python 3.11           통과   17s
  3 시험 Python 3.12(Docker)   통과   18s
  4 3.9 문법(ai_probe)         통과   0s
  5 커버리지(A>=90 B>=70)    통과   18s
  6 문서 검사                통과   0s
  7 공개 전 점검            통과   0s
  8 브라우저 점검 정적 검사 통과   0s
  9 브라우저 스모크(Chromium) 통과   8s
  10 반입 묶음 재현·외부 URL 0 통과   0s
전체 통과 (11단계)
```

### 1.2 AI 점검 — 가짜 vLLM·Ollama 서버에 실제 명령으로(2026-10-15)

`tests/integration/py/fakes.py` 의 가짜 서버 두 대(vLLM 꼴: 키 필요·`max_model_len`·추론 토큰, Ollama 꼴: `num_ctx 4096` 에서 앞을 조용히 자름)에 `python3 tools/ai_probe.py --server … --server … --key-env DEMO_KEY --no-pause` 로 돌린 화면의 끝(속도는 가짜 서버가 바로 답해 큰 값이다):

```text
=== 결과 코드 - 이 줄들을 그대로 옮겨 적어 전해 주세요 ===
e v=1 p=3.9.21 o=l5.14 q=n a=n s=2 /c4
s1 k=vllm/0.9.2 h=uvicorn n=1 m=1 a=y x=n q=d l=h d=n /7h
s1m1 gpt-oss-120b c=131072m t=1.60 p=4054520 d=718022 k=n r=40/900t f=c h=n z=y j=y o=y /yw
s2 k=ollama/0.12.3 h=- n=1 m=1 a=n x=n q=d l=h d=n /gn
s2m1 qwen3_8b c=40960o w=4096 t=2.20 p=32364735 d=2441 k=y r=3/3o f=n h=n z=- j=f o=!n /vn
결과를 남겼습니다: ai_probe_result_20261015_111906.txt (주소와 키는 들어 있지 않습니다)

rc 0 key-in-output: False host-in-output: False port-in-output: False
```

풀이의 일부(같은 실행): `추론 강도 low/high: low 40 -> high 900 (추론 토큰) = 반영됨`, `조용한 잘림(약 6k 토큰): 있음 - 앞부분이 잘림`, `JSON 스키마 응답: 코드 울타리로 감싸 옴`, `Responses API: 없음(404)`.

### 1.3 브라우저 점검 — 헤드리스 Chromium(`python3 scripts/browser_smoke.py`)

```text
브라우저 3단계 7.0초
  1 file://          b v=1 c=h153 g=f l=5119/5119 o=0 i=16/10240 e=y u=y p=n s=n m=n f=n w=y k=n d=- r=nn t=- a=c z=0 /p3
  2 file:// 사본       b v=1 c=h153 g=f l=5119/5119 o=0 i=16/10240 e=y u=y p=n s=y m=n f=n w=y k=n d=- r=yy t=- a=b z=0 /92
  3 http://127.0.0.1 b v=1 c=h153 g=h l=5119/5119 o=0 i=16/10240 e=y u=y p=n s=- m=n f=y w=y k=n d=- r=nn t=yy a=- z=0 /hr
스모크 통과
```

- 단계 2 는 같은 프로필로 브라우저 프로세스를 새로 띄운 것이다 → `r=yy`(다시 연 뒤 남음), 다른 폴더의 사본 → `s=y`
- 단계 1·2 의 `a` 는 CORS 를 주는 가짜 AI(`c`)와 주지 않는 가짜 AI(`b`)
- 단계 3 은 `--serve-test` 가 띄운 서버 — 쿠키·1·4 MiB POST(`t=yy`), 시험 서버 콘솔에 같은 줄이 찍힘
- JS 와 Python 의 검사합 검산 값이 같다(`123456789` → `dh` 등 4개)
- 이 VM 의 Chromium 153 실측(폐쇄망 Chrome 150 에서 다시 잰다): localStorage 는 영문·한글 모두 약 5,119K 글자, `file://` 에서 `isSecureContext`·`crypto.randomUUID` 됨, 자기 파일 `fetch` 막힘, `file://` 사본끼리 저장소 공유, `<script type="module">` 안 돌고 `new Worker()` 는 `SecurityError`(설계서_Architecture 6절)

### 1.4 묶음과 결과 코드 풀이

- `python3 scripts/pack_probe.py` → `만듦: /data/projects/MyLearner/dist/mylearner-probe-v1.tgz (30969 바이트, sha256 8c046ecbbe0b864ca5df04b0dd914325b01107cd9f1f97f488ce7a09a990fe5c)`. 같은 소스로 Python 3.9 와 3.11 이 만든 묶음의 sha256 이 같았다(11:05 판 `2f4d7153…`)
- 풀어서 실행: `tar -xzf mylearner-probe-v1.tgz` → 세 파일, `README_KO.txt` 머리 `ef bb bf`(BOM), 그 폴더에서 `python3 ai_probe.py --serve-test --no-browser --serve-seconds 2 --no-pause --port 0` → `크롬에서 이 주소를 여세요: http://127.0.0.1:45987/?t=<토큰>`
- `python3 tools/ai_probe.py --decode` 에 브라우저 줄(`… /hr`)을 주면 `검사합 맞음`, 서버 줄의 검사합 한 글자를 바꾸면(`/gn` → `/gm`) `!! 검사합이 맞지 않습니다(적은 것 gm, 계산 gn)` 와 종료 코드 1

## 2. 테스트 구성

| 파일 | 건수 | 등급 | 먼저 썼나 |
|---|---|---|---|
| `tests/unit/py/test_ai_probe_code.py` | 27 | A | 예 — 구현 전 실행 `Ran 3 tests … FAILED (errors=3)`(불러오기 오류) |
| `tests/unit/py/test_ai_probe_judge.py` | 48 | A | 예(같음) |
| `tests/unit/py/test_ai_probe_static.py` | 7 | A | 예(같음) |
| `tests/integration/py/test_ai_probe_flow.py` | 31 | B | 구현 뒤 |
| `tests/integration/py/test_ai_probe_serve.py` | 15 | B | 구현 뒤 |
| `tests/integration/py/test_verify_tools.py` | 13 | C 도구의 음성 시험 | 구현 뒤 |
| 브라우저 스모크(`scripts/browser_smoke.py` + `tests/ui/cdp.js`) | 3단계 | C | — |

합계 141건(단위 82 + 통합 59). 세 판 모두 같은 수가 돌았다(3.12 는 Playwright 이미지의 Python 3.12.3, 건너뜀 0 — TLS 시험 포함).

## 3. 커버리지 — `python3 scripts/coverage_lite.py --enforce`

| 파일 | 등급 | 줄 | 실행 | 커버 |
|---|---|---|---|---|
| `tools/ai_probe.py`(판정·결과 코드 함수 44묶음) | A | 471 | 450 | 95.5% |
| `tools/ai_probe.py`(호출·흐름·시험 서버) | B | 593 | 575 | 97.0% |

기준 A ≥ 90%, B ≥ 70% 통과. 등급 배정은 `scripts/coverage_grades.json`(함수 단위). `browser_probe.html` 과 `scripts/` 는 등급 C 라 재지 않는다.

## 4. 요구사항별 검증

| FR | 확인 방법 | 결과 |
|---|---|---|
| 101 | `bash scripts/check_env.sh` | READY(9항목) |
| 102 | `bash scripts/verify.sh` | 11단계 통과(1.1) |
| 103 | `test_verify_tools.VerifyDocsTest` 3건(깨진 링크·없는 경로·코드 블록 안 명령·모듈·예정 경로·release 범위·MWL 접두·`#앵커`) + 저장소 실물 | 통과, 위반 0 |
| 104 | `CoverageLiteTest` 2건 + 실측 | 통과, 3절 |
| 105 | `PublishSafetyTest` 3건(IP·토큰 5종·메일·금지 파일, 허용 대역·`ip-ok`) + 실물 | 통과, 막은 것 0 |
| 106 | `PackProbeTest` 3건 + 두 번 만들어 같음 + 외부 URL 0 | 통과 |
| 110 | `test_ai_probe_static`(3.9 문법·없어진 모듈·허용 모듈만) + 3.9/3.11/3.12 실행 | 통과 |
| 111 | `test_pac_and_insecure_notes`·레지스트리 가짜 `winreg`·`os_tag` | 통과(값은 찍지 않음) |
| 112 | 주소 꼴 7가지·`http://` 없음·잘못된 주소 건너뜀·대화형 흐름 | 통과 |
| 113 | 호출 상한(`--max-calls 6` → 뒤 단계 `!q`), 시간 초과(`!t`), Ctrl+C(종료 130, 요약 나옴) | 통과 |
| 114 | 307 로 다른 포트에 보냄 → 대상 서버 요청 0건, `d=o`, 키 헤더 없음 | 통과 |
| 115 | 죽은 프록시(`HTTP_PROXY=…:9`) → 직접 다시 → `q=f` | 통과 |
| 116 | 자체 서명 인증서: 기본 `!x`, `--insecure` `i`, `--cafile` `s` | 통과 |
| 120~123 | vLLM·Ollama 가짜로 끝까지, `/tokenize`·400 메시지·`/api/show`, CORS 없음·`*`·전체 | 통과 |
| 130~136 | 잘림(앞 표지 사라짐 `y`), 추론 반영(`40/900t`), 생각 끄기, JSON(`y`·`f`), 누출, Responses(`y`·`!n`), 속도 | 통과(가짜 서버 기준 — 실제 값은 폐쇄망) |
| 140~142 | 검사합 검산 값, 대소문자·`i/l/o` 바꿔 적기, 오타 검출, 주소·포트·키가 화면·결과 파일에 없음, `--decode` | 통과 |
| 143 | 소스의 모든 글자 cp949 인코딩, `safe_text` | 통과 |
| 144 | 대화형이면 끝·오류 뒤 엔터 대기, `--no-pause` | 통과 |
| 150 | 토큰 → 쿠키(303), 틀린 토큰 403, CSP·`no-store`, `Host` 검사, 411·413·400, 결과 줄 받음, 포트가 쓰이면 다음 번호 | 통과 + 스모크 단계 3 |
| 160~169 | `check_probe_html.py`(외부 자원 0·classic script·라벨·단추·필수 요소·Python 풀이와 칸 순서·검사합 글자·판) + 스모크 3단계 | 통과 |

## 5. 자체 점검

| # | 찾은 것 | 심각도 | 조치 |
|---|---|---|---|
| 1 | 프록시·게이트웨이가 키 없는 첫 요청에 **HTML 차단 화면(401·403)** 으로 답하면 '키가 필요하다'로 보고 키를 실어 다시 보냈다 — http 대상이면 그 프록시가 키를 본다 | 높음 | 고침: HTML 401·403 은 `e=!h` 로 멈추고 키를 보내지 않는다(`probe_server`). 시험 `test_html_block_page_gets_no_key`. FR-120·설계서 3.3 갱신 |
| 2 | 호출마다 시간 제한 180초 — 공유 GPU 에서 추론 high(답 상한 8192)는 넘을 수 있다 | 중간 | 기본 300초로. 400 메시지를 읽으려 `max_tokens` 를 크게 보내는 호출은 60초까지(받아들이면 생성이 길어질 수 있다). FR-113·설계서 4절 |
| 3 | 긴 질문의 답 상한 2048 — 추론 모델이 추론에 다 쓰면 표지 판정이 틀린다 | 중간 | 4096 으로. 추론 글에서도 표지를 찾는다 |
| 4 | 브라우저 페이지: 오류 0건이 빨간색(JS 에서 `"0"` 은 참) | 낮음 | 고침 |
| 5 | 390px 에서 표의 셋째 칸이 화면 밖으로 넘치고, 결과 코드가 칸 중간(`o=` / `0`)에서 줄이 바뀌었다 | 중간(옮겨 적기 실수) | 좁은 화면은 칸을 쌓고, 코드는 빈칸에서 줄을 바꾼다. 9절 |
| 6 | `storage.persisted` 가 '안 됨'(빨강) — 보통 값이라 실패처럼 보인다 | 낮음 | '보호 안 됨'(회색) |
| 7 | 반입 묶음 검사가 예시 주소 뒤 쉼표까지 호스트로 읽어 외부 URL 로 잡았다 | 낮음(검사 오류) | 트러블슈팅 T-002, 음성 시험 추가 |
| 8 | 문서 검사가 `파일#앵커` 를 없는 경로로 잡았다 | 낮음(검사 오류) | `#` 뒤를 떼고 본다, 음성 시험 추가 |
| 9 | 공개 전 점검이 history 의 `ssh -T git@github.com` 을 메일로 잡았다 | 낮음 | 허용 목록에 더함(SSH 주소) |
| 10 | 요구사항정의서가 묶음 도구를 `pack_probe.sh` 로 적었다(설계·코드는 `.py`) | 낮음 | 고침(grep) |
| 11 | 묶음 파일 시각이 2025-10-15 — 고정 시각 상수가 1년 어긋났다 | 낮음 | `1792022400`(2026-10-15) |
| 12 | `--dump-dom` 이 비동기 작업 전에 끝나 스모크가 아무것도 못 봤다 | 중간(시험 공백) | CDP 하네스로 바꿈 — 트러블슈팅 T-001 |

남은 위험(보류·다음 단계로):

- **독립 점검**(키 유출 — CLAUDE.md 12절): 만든 에이전트가 아닌 에이전트의 읽기 전용 점검은 사용자 승인 뒤 한다. 끝나기 전에는 묶음을 반입하지 않는다
- 응답 모양은 공개 API 에 기댄 가짜 서버로만 시험했다. 두 번째 서버의 서빙 방식은 모른다 — 결과 코드에 원 숫자를 실어 두었다
- 프록시가 실제 경로인 http 서버라면 키는 그 프록시를 지난다(다른 클라이언트도 같다). https 는 CONNECT 터널이라 보지 못한다

## 6. 첫 사용 재현

사람 리뷰를 하는 Phase 라 해당하지 않는다. 다만 1.4 처럼 묶음을 풀어 VM 에서 같은 순서를 돌렸다.

## 7. 실패·재작업 내역

| 무엇 | 내용 |
|---|---|
| 스모크 방식 | `--dump-dom` → CDP(T-001) |
| 화면 | 1차 스크린샷에서 5절 4·5·6 을 보고 고쳤다 |
| 키 유출 | 자체 점검에서 5절 1 을 찾아 고쳤다 |

## 8. 실행하지 못한 것

| 것 | 이유 | 영향 | 다시 할 것 |
|---|---|---|---|
| 사내 AI 실호출 | 개발 에이전트는 폐쇄망에 닿지 못한다 | 문맥 길이·속도·추론·CORS 의 실제 값 없음 | 사용자가 체크리스트 2절 → 10절에 기록 |
| Windows·Chrome 150·한국어 콘솔 | 이 VM 에 없다 | `py` 실행기, 레지스트리 프록시, cp949 콘솔, 기업 정책 | 체크리스트 전체 |
| Python 3.14 | 이 VM 에 없다(3.9·3.11·3.12 만) | 폐쇄망 PC 의 기본 판에서 미확인 | `python:3.14-slim` 이미지를 받아 시험할지 사용자에게 묻는다 |
| 독립 점검 | 서브에이전트는 사용자 승인 뒤(CLAUDE.md 12절) | 키 유출 2차 확인 없음 | 승인 뒤 |
| `verify_docs.py --release` | 설계 문서에 앞으로 만들 경로가 있다(배포 전에만 본다) | 없음(지금은 늘 검사 대상만) | Phase 7 |
| axe-core 접근성 검사 | npm 받기 확인 전 — 정적 검사(라벨·단추 글·`lang`)로 대신 | 대비 등은 사람이 화면으로 봄 | Phase 3 |

## 9. 화면 확인

| 폭 | 파일 |
|---|---|
| PC 1280px | [`screenshots/P1/browser_probe_1280.png`](screenshots/P1/browser_probe_1280.png) |
| 휴대폰 390px | [`screenshots/P1/browser_probe_390.png`](screenshots/P1/browser_probe_390.png) |

- 직접 보고 고친 것: 5절 4·5·6. 기본 단추(파랑)는 화면에 하나만 — 표지가 보일 때 '다시 열었다'
- 접근성 자동 검사: `scripts/check_probe_html.py` — `lang="ko"`, 입력마다 라벨, 단추마다 글과 `type="button"`, 상태는 글로(색은 거들기만). 대비 계산은 Phase 3 의 앱 화면부터

## 10. 폐쇄망 점검 결과

사용자가 체크리스트대로 돌려 전한 결과 코드를 여기에 옮기고 `--decode` 로 검사합을 확인한다. **대기 중.**
