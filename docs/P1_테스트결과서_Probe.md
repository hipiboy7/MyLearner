# P1 테스트결과서 — Probe (폐쇄망 점검 도구 2종 · 검증 체계)

- 실행 일자 2026-10-15 / 브랜치 `impl-phase1` / 실행한 곳: 개발 VM(RHEL 9.6, Python 3.9.21·3.11.9, Docker 29.6.1 — 이미지의 Python 3.12.3·3.14.8)
- 대응 요구사항: [`P1_요구사항정의서_Probe.md`](P1_요구사항정의서_Probe.md) FR-101~169, NFR-101~107 / 대응 설계서: [`P1_설계서_Probe.md`](P1_설계서_Probe.md)
- 정정 이력: 2026-10-15 오후 — Python 3.14 시험(전체 검증 4단계)과 독립 점검(5.2절)을 반영해 1~4·5·7·8절을 다시 쟀다. 오전 판의 수치(11단계, 141건, A 95.5%·B 97.0%, 묶음 `8c046ecb…`)는 이 판으로 바뀌었다
- 정정 이력: 2026-10-15 16시 — 비용 보고 도구 시험 11건 추가(179 → 190건). 커버리지·묶음 값은 그대로(`scripts/` 는 측정 폴더 밖, 묶음 sha256 `9193c63e…` 같음)
- 정정 이력: 2026-10-15 17시 — 체크리스트 0절 '나'(GitHub 에서 세 파일)의 해시 앞자리 시험 1건 추가(190 → 191건), 10절에 처음 받은 결과 코드
- **확인한 것**: 전체 검증 12단계 통과, 시험 191건(Python 3.9·3.11·3.12·3.14 각각, 건너뜀 0), 커버리지 A 96.2%·B 97.6%, 헤드리스 Chromium 153 에서 `file://`·`http://127.0.0.1` 스모크, 묶음 재현(세 판), 독립 점검(키 유출) — 지적 7건·관찰 5건 가운데 11건 고침·1건 둠
- **확인하지 못한 것**: 사내 AI 실호출, Windows·Chrome 150(폐쇄망 PC — 사용자가 체크리스트로) — 8절

## 1. 실행 증거

### 1.1 전체 검증 — `bash scripts/verify.sh`

```text
== MyLearner 전체 검증 2026-10-15 14:29
  0 환경 확인                통과   0s
  1 시험 Python 3.9            통과   11s
  2 시험 Python 3.11           통과   10s
  3 시험 Python 3.12(Docker)   통과   11s
  4 시험 Python 3.14(Docker)   통과   12s
  5 3.9 문법(ai_probe)         통과   0s
  6 커버리지(A>=90 B>=70)    통과   12s
  7 문서 검사                통과   0s
  8 공개 전 점검            통과   0s
  9 브라우저 점검 정적 검사 통과   0s
  10 브라우저 스모크(Chromium) 통과   8s
  11 반입 묶음 재현·외부 URL 0 통과   0s
전체 통과 (12단계)
```

- 4단계는 `python:3.14.8-slim`(사용자 승인 2026-10-15, `scripts/dev_tools.env`)에서 `PYTHONWARNINGS=error::DeprecationWarning` 으로 돈다 — 다음 판에서 없어질 API 를 일찍 잡는다. 이 설정이 실제로 잡는지 `datetime.datetime.utcnow()` 한 줄로 확인했다(`DeprecationWarning: datetime.datetime.utcnow() is deprecated …`, 종료 코드 1)
- 통합 시험의 가짜 서버가 닫힐 때 0.5초씩 기다리던 것을 0.05초로 줄였다(`serve_forever(poll_interval=…)`) — 판마다 약 27초 → 11초

### 1.2 AI 점검 — 가짜 vLLM·Ollama 서버에 실제 명령으로(2026-10-15 14:26, 고친 뒤)

`tests/integration/py/fakes.py` 의 가짜 서버 두 대(vLLM 꼴: 키 필요·`max_model_len`·추론 토큰, Ollama 꼴: 키 없음·`num_ctx 4096` 에서 앞을 조용히 자름)에 `python3 tools/ai_probe.py --server … --server … --key-env DEMO_KEY --no-pause` 로 돌린 화면의 끝(속도는 가짜 서버가 바로 답해 큰 값이다):

```text
=== 결과 코드 - 이 줄들을 그대로 옮겨 적어 전해 주세요 ===
e v=1 p=3.9.21 o=l5.14 q=n a=n s=2 /c4
s1 k=vllm/0.9.2 h=uvicorn n=1 m=1 a=y x=n q=d l=h d=n /7h
s1m1 gpt-oss-120b c=131072m t=1.60 p=3910435 d=682050 k=n r=40/900t f=c h=n z=y j=y o=y /he
s2 k=ollama/0.12.3 h=- n=1 m=1 a=n x=n q=d l=h d=n /gn
s2m1 qwen3_8b c=40960o w=4096 t=2.20 p=29456352 d=2212 k=y r=3/3o f=n h=n z=- j=f o=!n /a0
결과를 남겼습니다: ai_probe_result_20261015_142634.txt (주소와 키는 들어 있지 않습니다)

rc 0 key-in-output: False host-in-output: False port-in-output: False
vLLM requests 10 (keyed 8), Ollama requests 11 (keyed 0)
```

- 키는 키가 필요한 vLLM 의 호출 8건에만 실렸다(키 없는 첫 목록과 OPTIONS 는 빼고). 키가 필요 없는 Ollama 에는 0건 — 오전 판은 여기에도 실었다(5.2절 F-04)
- 풀이의 일부(같은 실행): `추론 강도 low/high: low 40 -> high 900 (추론 토큰) = 반영됨`, `조용한 잘림(약 6k 토큰): 있음 - 앞부분이 잘림`, `JSON 스키마 응답: 코드 울타리(```)로 감싸 옴`, `Responses API: 없음(404)`

### 1.3 브라우저 점검 — 헤드리스 Chromium(`python3 scripts/browser_smoke.py`)

```text
브라우저 3단계 7.7초
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

- `python3 scripts/pack_probe.py` → `만듦: /data/projects/MyLearner/dist/mylearner-probe-v1.tgz (34694 바이트, sha256 9193c63e104e16734b5ec6009e26f4aab680f0b879065e45df178cd5aa670263)`. 같은 소스로 Python 3.11.9 와 3.14.8(이미지)이 만든 묶음의 sha256 이 같았다
- 풀어서 실행: `tar -xzf mylearner-probe-v1.tgz` → 세 파일, `README_KO.txt` 머리 `ef bb bf`(BOM), 그 폴더에서 `python3 ai_probe.py --serve-test --no-browser --serve-seconds 2 --no-pause --port 0` → `크롬에서 이 주소를 여세요: http://127.0.0.1:44163/?t=<토큰>`. `python3 ai_probe.py --key sk-x` → `인자를 읽지 못했습니다. 키는 명령줄에 쓰지 않고 물을 때 적습니다(도움말: ai_probe.py --help).`, 종료 코드 2
- `python3 tools/ai_probe.py --decode` 에 브라우저 줄(`… /hr`)을 주면 `검사합 맞음`, 서버 줄의 검사합 한 글자를 바꾸면(`/gn` → `/gm`) `!! 검사합이 맞지 않습니다(적은 것 gm, 계산 gn)` 와 종료 코드 1

## 2. 테스트 구성

| 파일 | 건수 | 등급 | 먼저 썼나 |
|---|---|---|---|
| `tests/unit/py/test_ai_probe_code.py` | 27 | A | 예 — 구현 전 실행 `Ran 3 tests … FAILED (errors=3)`(불러오기 오류) |
| `tests/unit/py/test_ai_probe_judge.py` | 48 | A | 예(같음) |
| `tests/unit/py/test_ai_probe_static.py` | 7 | A | 예(같음) |
| `tests/unit/py/test_ai_probe_keyleak.py` | 20 | A | 예 — 독립 점검 지적을 고치기 전 실행 `Ran 20 tests … FAILED (failures=10, errors=7)` |
| `tests/integration/py/test_ai_probe_flow.py` | 31 | B | 구현 뒤 |
| `tests/integration/py/test_ai_probe_serve.py` | 15 | B | 구현 뒤 |
| `tests/integration/py/test_ai_probe_keyleak.py` | 18 | B | 고친 뒤 — 고치기 전 코드(`db954a9` 의 `tools/ai_probe.py`)에 돌리면 `Ran 18 tests … FAILED (failures=17, errors=1)` |
| `tests/integration/py/test_verify_tools.py` | 14 | C 도구의 음성 시험, 체크리스트 해시 앞자리 | 구현 뒤(해시 시험은 틀린 값으로 실패를 먼저 봄) |
| `tests/integration/py/test_usage_cost.py` | 11 | C 개발 보고 도구(비용 누적, CLAUDE.md 11절) | 예 — 스크립트 없이 먼저 돌려 `FileNotFoundError` 확인 |
| 브라우저 스모크(`scripts/browser_smoke.py` + `tests/ui/cdp.js`) | 3단계 | C | — |

합계 191건(단위 102 + 통합 89 — 2026-10-15 17시 체크리스트 해시 시험 1건을 더해 다시 돌림, 전체 검증 12단계 통과). 네 판 모두 같은 수가 돌았다(3.12 는 Playwright 이미지의 Python 3.12.3, 3.14 는 `python:3.14.8-slim`, 건너뜀 0 — TLS 시험 포함). 독립 점검 지적을 고치며 기존 시험 두 곳의 기대값을 바꿨다: `proxy_applies` 가 `all` 을 쓴다는 것(urllib 는 쓰지 않는다), 판 `2.4 rc` → `v/2.4_rc`(이제 숫자 모양만 → `v/2.4`).

## 3. 커버리지 — `python3 scripts/coverage_lite.py --enforce`

| 파일 | 등급 | 줄 | 실행 | 커버 |
|---|---|---|---|---|
| `tools/ai_probe.py`(판정·결과 코드 함수 50묶음) | A | 532 | 512 | 96.2% |
| `tools/ai_probe.py`(호출·흐름·시험 서버) | B | 664 | 648 | 97.6% |

기준 A ≥ 90%, B ≥ 70% 통과. 등급 배정은 `scripts/coverage_grades.json`(함수 단위 — 이번에 `_skeleton`·`leaks`·`model_label`·`clean_key`·`auth_challenge`·`_server_token` 을 A 에 더했다). `browser_probe.html` 과 `scripts/` 는 등급 C 라 재지 않는다.

## 4. 요구사항별 검증

| FR | 확인 방법 | 결과 |
|---|---|---|
| 101 | `bash scripts/check_env.sh` | READY(10항목 — 3.14 이미지 포함) |
| 102 | `bash scripts/verify.sh` | 12단계 통과(1.1) |
| 103 | `test_verify_tools.VerifyDocsTest` 3건(깨진 링크·없는 경로·코드 블록 안 명령·모듈·예정 경로·release 범위·MWL 접두·`#앵커`) + 저장소 실물 | 통과, 위반 0 |
| 104 | `CoverageLiteTest` 2건 + 실측 | 통과, 3절 |
| 105 | `PublishSafetyTest` 3건(IP·토큰 5종·메일·금지 파일, 허용 대역·`ip-ok`) + 실물 | 통과, 막은 것 0(7절 — 새 시험의 고정값을 한 번 막았다) |
| 106 | `PackProbeTest` 3건 + 두 번 만들어 같음 + 외부 URL 0 | 통과 |
| 110 | `test_ai_probe_static`(3.9 문법·없어진 모듈·허용 모듈만) + 3.9/3.11/3.12/3.14 실행 | 통과 |
| 111 | `test_pac_and_insecure_notes`·레지스트리 가짜 `winreg`·`os_tag` | 통과(값은 찍지 않음) |
| 112 | 주소 꼴 7가지·`http://` 없음·잘못된 주소 건너뜀·대화형 흐름 + `@` 계정 정보·한글 호스트·64자 칸·NFKC·닫히지 않은 IPv6 를 정해진 글로 거절(입력이 글에 없다), 키 정리(`Bearer `·빈칸·한글·줄바꿈), 쓸 수 없는 키를 세 번까지 다시 물음, `GetPassWarning` 이면 키를 받지 않음, `--key` 줄임 거절(값을 찍지 않음), 빈 `--key-env` 알림(이름을 찍지 않음) | 통과 |
| 113 | 호출 상한(`--max-calls 6` → 뒤 단계 `!q`), 시간 초과(`!t`), Ctrl+C(종료 130, 요약 나옴), 서버·모델 하나의 예상 밖 오류 → `!e` 로 두고 다음으로(결과 코드 나옴) | 통과 |
| 114 | 307 로 다른 포트에 보냄 → 대상 서버 요청 0건, `d=o`, 키 헤더 없음. 닫히지 않은 IPv6 `Location` → `d=o e=!r`(멈추지 않음) | 통과 |
| 115 | 죽은 프록시(`HTTP_PROXY=…:9`) → 직접 다시 → `q=f`. 가짜 프록시(`CaptureProxy`) 아래 평문 http → 키 없는 첫 목록만 프록시로, 키는 직접 연결로(`q=k`), 직접이 안 되면 키를 보내지 않음(`e=!p`), `ALL_PROXY` 만이면 직접(`q=d`) | 통과 — 프록시가 키를 본 요청 0건 |
| 116 | 자체 서명 인증서: 기본 `!x`, `--insecure` `i`, `--cafile` `s`. 없는 `--cafile` → 알림·종료 코드 2 | 통과 |
| 120~123 | vLLM·Ollama 가짜로 끝까지, `/tokenize`·400 메시지·`/api/show`, CORS 없음·`*`·전체. 401·403 이 글·빈 본문·BOM 붙은 HTML·HTML 이면 키 없음(`e=!h`), 키 없이 200 인 서버는 모든 호출에 키 없음 | 통과 |
| 130~136 | 잘림(앞 표지 사라짐 `y`), 추론 반영(`40/900t`), 생각 끄기, JSON(`y`·`f`), 누출, Responses(`y`·`!n`), 속도, 사용량 10**400 은 버림(멈추지 않음) | 통과(가짜 서버 기준 — 실제 값은 폐쇄망) |
| 140~142 | 검사합 검산 값, 대소문자·`i/l/o` 바꿔 적기, 오타 검출, 주소·포트·키가 화면·결과 파일에 없음, `--decode`. 서버가 Server 헤더·판·모델 이름으로 입력한 호스트·포트·키·다른 호스트 이름·IP 를 되돌려 줘도 코드·화면·결과 파일에 없음(`?`), 진행 줄도 같은 값(`[S1M1 ?]`), 줄 600자·칸 64자 넘는 `--decode` 입력은 읽지 못한 줄 | 통과 |
| 143 | 소스의 모든 글자 cp949 인코딩, `safe_text` | 통과 |
| 144 | 대화형이면 끝·오류 뒤 엔터 대기, `--no-pause` | 통과 |
| 150 | 토큰 → 쿠키(303), 틀린 토큰 403, CSP·`no-store`, `Host` 검사, 411·413·400, 결과 줄 받음, 포트가 쓰이면 다음 번호. ASCII 가 아닌 토큰·쿠키 → 403(stderr 빔), ESC·CR·한글이 든 결과 줄 → 400 | 통과 + 스모크 단계 3 |
| 160~169 | `check_probe_html.py`(외부 자원 0·classic script·라벨·단추·필수 요소·Python 풀이와 칸 순서·검사합 글자·판) + 스모크 3단계 | 통과 |

## 5. 점검

### 5.1 자체 점검(만든 에이전트)

| # | 찾은 것 | 심각도 | 조치 |
|---|---|---|---|
| 1 | 프록시·게이트웨이가 키 없는 첫 요청에 **HTML 차단 화면(401·403)** 으로 답하면 '키가 필요하다'로 보고 키를 실어 다시 보냈다 — http 대상이면 그 프록시가 키를 본다 | 높음 | 고침: HTML 401·403 은 `e=!h` 로 멈추고 키를 보내지 않는다(`probe_server`). 시험 `test_html_block_page_gets_no_key`. FR-120·설계서 3.3 갱신 → 독립 점검이 HTML 밖의 경우를 더 찾았다(5.2 F-01) |
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
| 13 | Python 3.14 에서 `HTTPError` 를 닫지 않아 `ResourceWarning` 7종(`-X dev`) | 낮음 | `Client.call` 이 읽은 뒤 닫는다. DeprecationWarning 은 0 — 4단계가 오류로 본다 |
| 14 | 설계서 3.6절이 스모크를 아직 `--dump-dom` 으로 적었다(T-001 뒤 갱신 누락) | 낮음 | 고침(정정 이력) |

### 5.2 독립 점검 — 키 유출(CLAUDE.md 12절, 2026-10-15)

- 누가·어떻게: 만든 에이전트가 아닌 서브에이전트 1개(sonnet — 사용자 승인), 읽기 전용. 저장소를 세션 임시 폴더에 복사해 루프백(127.0.0.1)만으로 시험했고, 사내 프록시 환경 변수는 지운 채 자기가 띄운 가짜 프록시만 썼다. 지시 4가지(전용 임시 폴더, 저장소 파일 안 바꿈, 시험으로 확인한 것만, 찾는 대로 적기)를 지켰다. 약 44만 토큰·40분, 실험 스크립트 35개(e01~e19)
- 채택 절차: 지적마다 원문(코드 줄)을 읽고 같은 스크립트를 메인 에이전트가 다시 돌려 재현했다 → 고쳤다 → 같은 스크립트를 고친 코드에 다시 돌렸다(아래 '고친 뒤'). 실험 스크립트와 기록은 세션 임시 폴더에만 있다(커밋하지 않는다)

| # | 지적 | 심각도 | 고치기 전(재현) | 조치 | 고친 뒤(같은 스크립트) |
|---|---|---|---|---|---|
| F-01 | 키 없는 첫 요청의 401·403 이 HTML 만 아니면(글 `RBAC: access denied`, 빈 본문, `Negotiate`, BOM 붙은 HTML, UTF-16 화면, 8 MiB 앞 공백) 키를 실어 다시 보냈다 | 중간 | 게이트웨이 답 22가지 중 13가지에 키(JSON 본문 2가지 포함) | 본문이 JSON 객체일 때만 키(`auth_challenge`, BOM 허용). HTML·XML 형식이면 본문이 JSON 이어도 화면으로 본다. 나머지 `e=!h` | 22가지 중 2가지(JSON 객체 본문 — 실제 API 와 `text/plain` 으로 온 JSON, 의도)만 키 |
| F-02 | `HTTP_PROXY` 아래 평문 http 에서 urllib 가 `NO_PROXY` 의 CIDR·`*`·`;`·빈칸 목록·`<local>`·대괄호 없는 IPv6 를 읽지 못해 키가 프록시로 갔다. 경고도 없었다. `ALL_PROXY` 는 urllib 가 안 쓰는데 `q=p` | 중간 | `NO_PROXY` 변형 28가지 중 15가지에서 프록시가 키를 봄 | 평문 http 에 프록시가 걸리면 키를 보내기 전에 직접 연결로(`q=k`), 안 닿으면 보내지 않음(`e=!p`). 첫 호출 전에 화면에 알림. `proxy_applies` 에서 `all` 뺌(T-004) | 28가지 모두 프록시가 키를 못 봄. Windows `ProxyOverride` 흉내(6가지)도 0 |
| F-03 | 결과 코드 거르기가 잘림(16·24·32자)·글자 바꿈·IPv6·다른 호스트 이름을 놓쳤다. 진행 줄(서버 종류·모델 이름)은 거르지 않았다. `redact()` 는 흐름에서 불리지 않았다 | 낮음(서버가 되돌려 줄 때만) | Server 헤더·`/version`·모델 이름으로 호스트 앞부분, 키 앞 16·24자, 기호 섞인 15자 키 전체, IPv6, 다른 호스트가 코드 줄에 | Server 헤더는 `제품/판` 모양만(`_server_token`), 판은 숫자 모양만(`_ver`), 자유 글은 `leaks`(IPv4·IPv6·호스트 꼴·비밀값의 영문·숫자 8글자)로 `?`, 진행 줄도 같은 값, 서버를 받은 뒤 `IO.say`·결과 파일은 `redact` | e04 4종: 화면·풀이·결과 파일·코드 줄에서 걸린 것 0 |
| F-04 | 키 없이 목록이 되는(200) 서버에도 그 뒤 호출에 키를 실었다 | 낮음 | 9건 중 7건에 키 | 키 없이 JSON 401·403 을 받은 서버에만 키(`Client.key_on`) | 0건 |
| F-05 | 주소의 `사용자:비밀번호@` 를 받아, 프록시로 가는 요청 줄과 `Host` 에 계정 정보가 실렸다 | 낮음 | 프록시가 계정 정보를 받음 | 받지 않는다(정해진 글) | 요청 0건 |
| F-06 | 주소를 읽지 못한 까닭으로 urllib 의 오류 글(입력한 주소 전체)을 찍었다 | 낮음(정보) | `netloc 'svc:SECRETPW@…' contains invalid characters under NFKC normalization` | 정해진 글만 | `주소 모양이 올바르지 않습니다(대괄호, 쓸 수 없는 글자)` |
| F-07 | `--key <키>` 가 `--key-env` 의 줄임으로 받아들여져 조용히 키 없이 돌았다(키가 셸 기록·프로세스 목록에 남는다) | 낮음 | 종료 코드 0, 경고 없음 | 줄임을 받지 않고(`allow_abbrev=False`) 인자 오류 글에 값을 싣지 않는다. 빈 `--key-env` 는 알린다(이름은 찍지 않는다) | 종료 코드 2, 정해진 글 |
| O-1 | 닫히지 않은 IPv6 `Location`·깊은 JSON·한글 키·줄바꿈이 든 키·63자 넘는 칸·10**400·없는 `--cafile`(e11 7가지)과 IDN 호스트(e04d)에서 실행 전체가 멈추고 결과 코드가 없었다 | 중간(결과를 잃음) | 8가지 모두 종료 코드 2, 코드 없음 | 3xx 처리기 자체를 끔(T-003), 깊은 JSON `!j`, 키 정리(`clean_key`), 호스트 검사(ASCII·63자), 큰 수 버림, `--cafile` 알림, 서버·모델마다 `!e` 안전망 | 7가지 종료 코드 0·코드 있음(IDN 은 '주소를 읽지 못했습니다'로 건너뜀), `--cafile` 은 알림과 종료 코드 2 |
| O-2 | 시험 서버: `/?t=%C3%A9` 에서 `hmac.compare_digest` 가 `TypeError` — 콘솔에 traceback | 낮음 | traceback | 바이트로 비교 | 403, stderr 빔 |
| O-3 | 시험 서버: 결과 줄의 ESC·CR 을 콘솔에 그대로 찍었다(쿠키가 있어야 한다) | 낮음 | 콘솔 지우기·덮어쓰기 | 인쇄 가능한 ASCII 한 줄만 받는다 | 400 |
| O-4 | `--decode`: 4,300자리가 넘는 칸에서 traceback(개발 쪽) | 낮음 | traceback | 줄 600자·칸 64자 상한 | 읽지 못한 줄, traceback 없음 |
| O-5 | 시험 서버 토큰이 한 번 쓰고 버리는 것이 아니고 쿠키 값이 토큰과 같다 | 정보 | — | **두었다**: 이 PC 의 127.0.0.1 시험용이고 AI 비밀이 아니다. 새로 고침에 콘솔의 주소를 다시 쓸 수 있어야 한다 | — |

- 확인하지 못한 의심 4(IDLE 처럼 키를 가릴 수 없는 창에서 `getpass` 가 글자를 보이게 받는다)도 막았다 — `GetPassWarning` 이면 키를 받지 않는다(`IO.secret`, 시험 있음)
- 점검이 안전하다고 본 시나리오(17묶음)의 스크립트 12개를 고친 코드로 다시 돌려 그대로임을 확인했다(e01·e05·e05b·e06·e06b·e07·e08·e10·e13·e15·e17·e18): 리다이렉트 5종 × `Location` 9꼴 × 9개 끝점(405번, 대상 연결 0·키 0), 요청 전수(키는 `Authorization` 에만), 대화형(pty, Ctrl+C), 서버 둘·키 둘, 레지스트리·프록시 값 안 찍음, 죽은 프록시 → 직접(대상에 `Proxy-Authorization` 없음), TLS(검증 실패면 요청 0), https 프록시(헤더 없는 CONNECT 만), 주소의 질의·조각 안 보냄, 경고 0(3.9·3.11 × 4가지), 찍지 않는 칸의 되돌림, 200 의 여러 모양. 브라우저 쪽(e14 — `browser_probe.html` 에 입력한 AI 주소가 어디에도 남지 않음)은 그 파일을 바꾸지 않아 다시 돌리지 않았다
- 받아들인 판단: JSON 객체 본문이면 `Content-Type` 이 `text/plain` 이어도 키를 보낸다(Go 의 `http.Error` 꼴 API) — 평문 http 프록시 경로는 위 F-02 규칙으로 막혀 있다

남은 위험(이 도구로는 막지 못하거나 폐쇄망에서만 보이는 것):

- Windows 실기의 레지스트리·WinINET 우회 판정은 CPython 판정을 Linux 에서 흉내 내 본 것뿐이다(T-004 ⚠️). 평문 키는 판정과 무관하게 직접 연결로만 가므로 키 유출로 이어지지는 않는다
- TLS 를 들여다보는 사내 프록시(Windows 인증서 저장소로 신뢰)라면 https 키도 프록시가 본다 — 다른 클라이언트도 같다
- 이름이 같은 채 DNS 답이 바뀌면(키 없는 호출과 키 호출 사이) 키가 다른 IP 로 갈 수 있다 — 이름 기반 클라이언트의 공통 한계
- 숫자·점이 없는 짧은 호스트 이름 조각(예: `aigw`)을 Server 헤더로 되돌려 주면 거르지 못한다 — 제품 이름과 구별되지 않는다
- 응답 모양은 공개 API 에 기댄 가짜 서버로만 시험했다. 두 번째 서버의 서빙 방식은 모른다 — 결과 코드에 원 숫자를 실어 두었다

## 6. 첫 사용 재현

사람 리뷰를 하는 Phase 라 해당하지 않는다. 다만 1.4 처럼 묶음을 풀어 VM 에서 같은 순서를 돌렸다.

## 7. 실패·재작업 내역

| 무엇 | 내용 |
|---|---|
| 스모크 방식 | `--dump-dom` → CDP(T-001) |
| 화면 | 1차 스크린샷에서 5.1절 4·5·6 을 보고 고쳤다 |
| 키 유출 | 자체 점검에서 5.1절 1 을, 독립 점검에서 5.2절 F-01~F-07·O-1~O-4 를 찾아 고쳤다 |
| 묶음 검사 | 고친 코드의 주석에 든 예시(`http://[::1`)를 외부 URL 로 잡았다 → 주석을 글로 바꿨다(검사는 그대로) |
| 공개 전 점검 | 새 시험의 고정값(사설 IP `10.x`, `sk-` 꼴 가짜 키) 8건을 막았다 → 문서용 대역(RFC 5737)과 다른 꼴의 가짜 키로 바꿨다 |
| 시험 하나 | 키 앞 7글자(`bearer_` + 9자)를 가리라고 한 기대가 지나쳤다 — 8글자 창 규칙에 맞춰 시험 값을 12자로 |

## 8. 실행하지 못한 것

| 것 | 이유 | 영향 | 다시 할 것 |
|---|---|---|---|
| 사내 AI 실호출 | 개발 에이전트는 폐쇄망에 닿지 못한다 | 문맥 길이·속도·추론·CORS 의 실제 값 없음 | 사용자가 체크리스트 2절 → 10절에 기록 |
| Windows·Chrome 150·한국어 콘솔 | 이 VM 에 없다 | `py` 실행기, 레지스트리 프록시, cp949 콘솔, 기업 정책 | 체크리스트 전체 |
| `verify_docs.py --release` | 설계 문서에 앞으로 만들 경로가 있다(배포 전에만 본다) | 없음(지금은 늘 검사 대상만) | Phase 7 |
| axe-core 접근성 검사 | npm 받기 확인 전 — 정적 검사(라벨·단추 글·`lang`)로 대신 | 대비 등은 사람이 화면으로 봄 | Phase 3 |

## 9. 화면 확인

| 폭 | 파일 |
|---|---|
| PC 1280px | [`screenshots/P1/browser_probe_1280.png`](screenshots/P1/browser_probe_1280.png) |
| 휴대폰 390px | [`screenshots/P1/browser_probe_390.png`](screenshots/P1/browser_probe_390.png) |

- 직접 보고 고친 것: 5.1절 4·5·6. 기본 단추(파랑)는 화면에 하나만 — 표지가 보일 때 '다시 열었다'
- 접근성 자동 검사: `scripts/check_probe_html.py` — `lang="ko"`, 입력마다 라벨, 단추마다 글과 `type="button"`, 상태는 글로(색은 거들기만). 대비 계산은 Phase 3 의 앱 화면부터
- 이번 고침은 `browser_probe.html` 을 바꾸지 않았다 — 스크린샷은 그대로다

## 10. 폐쇄망 점검 결과

사용자가 체크리스트대로 돌려 전한 결과 코드를 여기에 옮기고 `--decode` 로 검사합을 확인한다. **받는 중** — 아래 한 줄을 받았고 `e`·`s…`·`b`(file://)는 아직이다.

| 받은 날 | 줄 | 풀이(`python3 tools/ai_probe.py --decode`) |
|---|---|---|
| 2026-10-15 | `b v=1 c=c155 g=h l=5119/5119 o=0 i=64/10240 e=y u=y p=n s=n m=n f=y w=y k=y d=y r=nn t=yy a=- z=0 /57` | 검사합 맞음. Chrome 155, `http://127.0.0.1`(`--serve-test`), localStorage 영문·한글 약 5119K 글자, IndexedDB 64 MB 써짐·할당량 10240 MB, 보안 문맥·`randomUUID` 됨, `persisted` 안 됨, 자기 파일 fetch·저장 창·클립보드·내려받기 됨, 다시 연 뒤 localStorage·IndexedDB 표지 없음, 서버 모드 쿠키·큰 POST 됨, 스크립트 오류 0 |

- ⚠️ 어느 PC 인지 확인 중: Chrome 155 는 CLAUDE.md 0절의 폐쇄망 Chrome 150 과 다르다
- ⚠️ `s=n`(사본끼리 따로 씀)은 http 페이지에서는 뜻이 없다 — `file://` 전용 단추를 누르면 http 페이지에서도 값이 생긴다(`tools/browser_probe.html` 의 `btn-copy`). `r=nn` 은 이 출처(포트 8770)에서 크롬을 다시 연 뒤 누른 것인지 사용자에게 묻는 중 — 그렇다면 '크롬을 닫으면 지움' 정책일 수 있다
