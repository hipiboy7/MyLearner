# P1 설계서 — Probe (폐쇄망 점검 도구 2종 · 검증 체계)

- 작성 2026-10-15 / 대응 요구사항: [`P1_요구사항정의서_Probe.md`](P1_요구사항정의서_Probe.md) FR-101~169, NFR-101~107 / 상위 문서: [`설계서_Architecture.md`](설계서_Architecture.md)
- 코드: `tools/ai_probe.py`, `tools/browser_probe.html`, `scripts/` / 시험: `tests/unit/py/`, `tests/integration/py/`
- 정정 이력: 2026-10-15 — Python 3.14 시험 이미지(4절), 스모크 방식을 `--dump-dom` 에서 CDP 로 바로잡음(2·3.6절, 트러블슈팅 T-001), `verify.sh` 단계 표 위치
- 정정 이력: 2026-10-15 — 2절 표에 `scripts/usage_cost.py`(비용 보고, 사용자 지시)
- 정정 이력: 2026-10-15 — 독립 점검(P1 테스트결과서 5.2절)을 받아 키를 보내는 조건(3.3절 '키 정책'), 자유 글 거르기(3.1·3.2절), 새 값 `q=k`·`e=!p`·`!e`·이름 `?`, 줄·칸 길이 상한, 예상 밖 오류 처리(5절), 시험 서버 비교·결과 줄(3.4절)

## 1. 데이터 흐름

```
[개발 VM]                                         [폐쇄망 PC]
 tools/ai_probe.py ┐                               ① tar -xzf mylearner-probe-v1.tgz
 tools/browser_probe.html ┼─ scripts/pack_probe.py ─▶ .tgz 반입 ─▶ ② py -3 ai_probe.py      → 사내 AI 서버(하나씩 호출)
 README_KO.txt(묶음 안내) ┘   (같은 입력 = 같은 바이트)          ③ browser_probe.html 더블클릭(file://)
                                                    ④ py -3 ai_probe.py --serve-test   → http://127.0.0.1 에서 같은 페이지
                                                         │
                                                         ▼ 화면의 결과 코드(줄마다 검사합) — 주소·키·포트 없음
 python3 tools/ai_probe.py --decode ◀── 사용자가 옮겨 적어 대화로 전한다 ◀──┘
   → 검사합 확인 + 뜻 풀이 → P1 테스트결과서 · 보류 결정 7 · Phase 6 설계 입력
```

## 2. 모듈 구성

| 파일 | 책임 | 등급 |
|---|---|---|
| `tools/ai_probe.py` | AI 점검(대화형)·`--serve-test`·`--decode`. 파일 하나 — 폐쇄망에 그대로 들고 간다 | 판정·코드 함수 A, 나머지 B(함수 단위 배정 — 3.6절) |
| `tools/browser_probe.html` | 브라우저 점검. 인라인 CSS·JS, 외부 자원 0 | C |
| `scripts/check_env.sh` | 0단계 환경 확인 → `READY` | C |
| `scripts/verify.sh` | 전체 검증 명령(단계는 그 파일 머리, 실행 결과는 테스트결과서 1.1절) | C |
| `scripts/verify_docs.py` + `verify_docs_planned.txt` | 문서의 링크·경로·명령 검사 | C(음성 시험 있음) |
| `scripts/coverage_lite.py` + `coverage_grades.json` | 표준 라이브러리 줄 커버리지, 파일·함수 단위 등급 | C(음성 시험 있음) |
| `scripts/check_publish_safety.py` | 추적·새 파일의 IP·토큰·메일·금지 파일 | C(음성 시험 있음) |
| `scripts/check_probe_html.py` | `browser_probe.html` 정적 검사(외부 자원 0·접근성 기초·필수 요소) | C |
| `scripts/browser_smoke.py` + `tests/ui/cdp.js` | 헤드리스 Chromium(Playwright 이미지)으로 `file://`·`http://127.0.0.1` 실행. `cdp.js` 는 그 이미지의 Node 내장 WebSocket 으로 CDP 를 몬다(외부 패키지 없음) | C |
| `scripts/pack_probe.py` | 반입 묶음(재현 가능한 tar.gz) + 외부 URL 검사 | C |
| `scripts/usage_cost.py` + `usage_prices.json` | Claude Code 사용 비용 누적(API 정가 $) — 세션마다 남는 cost-state + 진행 중 세션 추정, 기록 `history/usage_ledger.json`(CLAUDE.md 11절 '비용 보고'). 제품 코드가 아니라 개발 보고용 | C(시험 `test_usage_cost.py`) |
| `scripts/dev_tools.env` | 개발 전용 도구 판 고정(이미지 이름) — 셸·파이썬이 함께 읽는다 | — |
| `tests/integration/py/fakes.py` | 가짜 AI 서버(vLLM 꼴·Ollama 꼴·게이트웨이 꼴 — 글·빈 본문·BOM 차단 화면, 깨진 Location, 깊은 JSON, 큰 수)와 정방향 프록시 꼴(`CaptureProxy` — 받은 요청을 남기고 스스로 답한다) | 시험 지원 |

MWL 에서 복사해 고친 것(기준 커밋 `e053470`): `verify_docs.py`(대상 문서 두 묶음·코드 블록 안 명령 검사 추가), `coverage_lite.py`(측정 폴더 설정·함수 단위 등급 추가), `check_publish_safety.py`(사설 IP 도 막도록 판정 바꿈, 새 파일 포함), `fake_ai.py` 의 응답 모양(`fakes.py`), `aiserver.py` 의 사용량 읽기(`usage_of`).

## 3. 인터페이스

### 3.1 결과 코드 v1 (FR-140·142·169) — A

폐쇄망과 개발 VM 사이의 유일한 통로다. 사람이 손으로 옮겨 적는다고 보고 짧게, 틀리면 드러나게 만든다.

| 규칙 | 값 |
|---|---|
| 줄 모양 | `<표지> <칸> <칸> … /<검사합>` — 칸은 `글자=값`(모델 줄만 표지 뒤에 모델 이름 하나) |
| 글자 | ASCII 소문자·숫자·`. _ / ! : -`. 대문자로 적어도 소문자로 바꿔 읽는다 |
| 검사합 | 내용(마지막 ` /` 앞)을 소문자·공백 하나로 맞춘 뒤 UTF-8 바이트의 CRC-16/CCITT-FALSE(다항식 0x1021, 초기값 0xFFFF) 하위 10비트 → Crockford base32 소문자 2글자(`0123456789abcdefghjkmnpqrstvwxyz`, 읽을 때 `i`·`l`→`1`, `o`→`0`). 검산 값: `123456789` → CRC `0x29b1` → `dh` |
| 공통 값 | `-` 해당 없음·안 함, `?` 판정 못 함 또는 가림, `!t` 시간 초과, `!c` 연결 안 됨, `!x` TLS 오류, `!r` 리다이렉트, `!a` 401·403, `!n` 404, `!l` 길이 초과 400, `!4` 그 밖 4xx, `!5` 5xx, `!h` HTML 답(게이트웨이 화면 — 401·403 이면 JSON 이 아닌 모든 답), `!j` JSON 아님·모양 다름, `!q` 호출 상한, `!s` 멈춤·앞 단계 실패로 건너뜀, `!p` 키를 보내지 않음(평문 http 가 프록시를 거치고 직접은 닿지 않음), `!e` 예상 밖 오류(이름만 화면에) |
| 넣지 않는 것 | 주소·IP·포트·키·경로. 모델 이름은 마지막 `/` 뒤 조각을 `[a-z0-9._-]` 32자 이내로. 서버가 준 자유 글(모델 이름·Server 헤더·판)이 주소처럼 보이면(IPv4, IPv6, 호스트 이름 꼴 — 점으로 이은 영문 칸 셋, `.local`·`.internal`·`.corp` 등) 또는 입력한 호스트·키가 보이면(대소문자·기호를 뺀 영문·숫자 8글자가 이어지면 — 잘리거나 바뀐 것 포함) `?` 로 싣는다(`leaks`) |
| 길이 | 한 줄 600자, 한 칸 64자까지 읽는다(넘으면 '읽지 못한 줄') |

**`e` 줄 — 환경**: `e v=1 p=3.14.0 o=w10.0.26100 q=r a=n s=2 /..`

| 칸 | 뜻 |
|---|---|
| `v` | 코드 판(1) |
| `p` | Python 판 |
| `o` | OS — `w`+Windows 판(`platform.version()`), `l`+Linux 커널 앞 두 자리, `m` macOS |
| `q` | 프록시 설정 — `n` 없음, `e` 환경 변수, `r` Windows 레지스트리, `b` 둘 다 |
| `a` | PAC(`AutoConfigURL`) — `y`/`n` |
| `s` | 점검한 서버 수(빠진 줄을 알아보는 데 쓴다) |

**`s<번호>` 줄 — 서버**: `s1 k=vllm/0.9.2 h=uvicorn n=2 m=2 a=y x=n q=d l=h d=n /..`

| 칸 | 뜻 |
|---|---|
| `k` | 종류/판 — `vllm/<판>`(모델의 `owned_by=vllm` 또는 `/version`), `ollama/<판>`(`/api/version`), `v/<판>`(그 밖의 `/version`), `-`. 판은 숫자 모양의 앞부분만(`0.10.2rc2.dev36+g…` → `0.10.2rc2`, IP 꼴이면 버린다) |
| `h` | `Server` 헤더의 첫 낱말이 `제품/판` 모양일 때만(`uvicorn`, `nginx/1.24.0` — 제품 이름은 영문·`-`·`_`, 판은 숫자로 시작), 아니면 `?`, 없으면 `-` |
| `n`·`m` | 목록의 모델 수·시험한 모델 수 |
| `a` | 키가 필요한가 — 키 없이 부른 `/v1/models` 가 401·403 이면 `y`, 200 이면 `n` |
| `x` | CORS 추정(`file://` 의 `Origin: null` + `Authorization`) — `y` 됨, `p` 출처는 되나 `authorization` 이 허용 헤더에 없음(`*` 만 있음 포함), `n` 안 됨, `?` |
| `q` | 경로 — `d` 프록시 없이, `p` 프록시로, `f` 프록시 실패 → 직접 됨, `k` 평문 http 에 프록시가 걸려 키를 보내기 전에 직접 연결로 바꿈 |
| `l` | 전송 — `h` http, `s` https 검증됨, `i` https 검증 없이(`--insecure`), `!x` |
| `d` | 리다이렉트 — `n` 없음, `s` 같은 호스트, `o` 다른 호스트, `t` https 로 |
| `e` | 서버 단계 치명 오류(목록을 못 받음, `!h`·`!p`·`!e` 포함). 있으면 모델 줄이 없다 |

**`s<번호>m<번호>` 줄 — 모델**: `s1m1 gpt-oss-120b c=131072m t=1.62 p=2400 d=38 k=n r=40/910t f=c h=n z=- j=y o=y /..`

| 칸 | 뜻 |
|---|---|
| `c` | 문맥 길이 + 출처 — `m` `/v1/models`, `t` `/tokenize`, `e` 400 메시지, `o` Ollama `/api/show`, 못 찾으면 `?` |
| `w` | Ollama 의 실제 창 `num_ctx`(있을 때만) |
| `t` | 글자/토큰(긴 한국어 질문, 소수 둘째 자리) |
| `p` | 입력 처리 속도(토큰/초, 대략 — 긴 질문 시간에서 답 생성 몫을 뺀 값) |
| `d` | 생성 속도(토큰/초 — 추론 high 호출) |
| `k` | 조용한 잘림 — `n` 앞·끝 표지 모두, `y` 앞 표지만 사라짐(앞쪽 잘림), `e` 끝 표지가 없음, `b` 둘 다 없음 |
| `r` | 추론 강도 `<low>/<high><출처>` — 출처 `t` 추론 토큰(usage), `c` 추론 글자 수, `o` 답 토큰. 정보가 없으면 `-` |
| `f` | 추론이 오는 칸 — `c` `reasoning_content`, `r` `reasoning`, `n` 없음 |
| `h` | 본문 누출 — `n` 없음, `t` `<think>`, `g` harmony 표지(`<\|`), `b` 둘 다 |
| `z` | `enable_thinking=false` — `y` 추론이 사라짐, `n` 그대로, `-` 원래 추론이 없음 |
| `j` | `json_schema` — `y` 맞음, `f` 코드 울타리 안에서 맞음, `s` JSON 이지만 스키마 다름, `x` JSON 아님 |
| `o` | Responses API — `y` 됨, `x` 200 이지만 모양이 다름 |

판정(풀이 때 계산): 추론 반영 = high ≥ low × 1.5 이고 차이가 토큰 50(글자는 200) 이상.

**`b` 줄 — 브라우저**: `b v=1 c=c150 g=f l=5119 o=0 i=64/3072 e=y u=y p=n s=y m=n f=n w=y k=y d=y r=yy t=- a=- z=0 /..`

| 칸 | 뜻 |
|---|---|
| `c` | 브라우저와 큰 판 — `c` Chrome, `e` Edge, `h` HeadlessChrome, `x` 그 밖 |
| `g` | 연 방식 — `f` `file://`, `h` `http://127.0.0.1`, `o` 그 밖 |
| `l`·`o` | localStorage 용량·시험 전에 쓰인 양(1,024글자 단위). 못 쓰면 `!u` |
| `i` | IndexedDB `<써 본 MB>/<할당량 MB>`. 못 쓰면 `!u` |
| `e`·`u`·`p` | `isSecureContext`·`crypto.randomUUID`·`storage.persisted()` — `y`/`n` |
| `s` | `file://` 사본끼리 저장소 공유 — `y` 두 경로 이상을 봄, `?` 아직 한 경로만, `-` http |
| `m` | `mwl.progress` — `n` 없음, `y<KB>` 있음과 크기 |
| `f`·`w` | 자기 파일 `fetch`·`showSaveFilePicker` — `y`/`n` |
| `k` | 클립보드 쓰기 — `y` 비동기 API, `e` `execCommand` 만, `n` 안 됨, `-` 안 함 |
| `d` | 내려받기(사용자 확인) — `y`/`n`/`-` |
| `r` | 다시 연 뒤 남음 `<localStorage><IndexedDB>` — `yy`·`yn`·`ny`·`nn`, `-` 아직 |
| `t` | 서버 모드 `<쿠키><큰 POST>` — `yy` 등, `-` `file://` |
| `a` | AI 서버에 브라우저가 직접 — `c` 사전 요청까지 됨, `p` 단순 요청만, `b` 닿지만 CORS 막힘, `n` 닿지 않음, `-` 안 함 |
| `z` | 잡힌 스크립트 오류 수(0 이어야 한다) |

### 3.2 `ai_probe.py` 판정 함수 — A

| 함수 | 입력 → 출력 |
|---|---|
| `normalize_base(text)` | 입력 주소 → `(root, v1)`. `…/v1/chat/completions`·`…/v1/responses`·`…/v1`·뒤 `/` 를 정리. http(s) 가 아니거나, `@`(계정 정보)·ASCII 가 아닌 호스트·63자 넘는 칸이 있으면 `ValueError`(정해진 글 — 입력을 싣지 않는다) |
| `clean_key(text)` | 키 → 앞뒤 빈칸·`Bearer ` 를 뗀 키, 비면 `''`, 헤더에 실을 수 없는 글자(인쇄 가능한 ASCII 밖)면 `None` |
| `auth_challenge(status, headers, body)` | 401·403 → `json`(본문이 JSON 객체, BOM 허용) / `page`(HTML·XML·글·빈 본문·그 밖). 다른 상태 `''` |
| `leaks(text, secrets)`·`scrub(value, secrets)`·`model_label(id, secrets)` | 자유 글이 주소·키처럼 보이는가 / 그러면 `?` / 모델 이름(줄이기 전 조각으로도 본다) |
| `secrets_of(url, key)`·`redact(text, secrets)` | 가릴 값(호스트·`호스트:포트`·`:포트`·키) → 글에서 `<서버>`·`<키>` 로 바꿈 |
| `classify_redirect(src, location)` | `s`·`o`·`t` |
| `proxy_kind(env_proxies, reg)`·`proxy_applies(url, proxies, bypass)` | 프록시 설정 종류, 이 주소에 프록시가 걸리는지 |
| `ctx_from_model_entry(d)`·`ctx_from_tokenize(d)`·`ctx_from_error(text)`·`ctx_from_ollama_show(d)` | 문맥 길이(없으면 `None`). 400 메시지는 `maximum context length is N`·`must be <= N` 꼴 |
| `server_kind(models, version, api_version, server_header)` | `k`·`h` 칸 값(판은 `_ver`, 헤더는 `_server_token` 의 정해진 모양만) |
| `cors_verdict(preflight, actual)` | 헤더 → `y`·`p`·`n`·`?` |
| `make_long_prompt(n)` | 결정적인 한국어 글(가상 매뉴얼, 앞·끝 표지) → `(prompt, start, end)` |
| `chat_parts(data)`·`usage_of(data)` | 답 본문·추론 글·끝난 이유, 사용량 `{input, output, reasoning}` |
| `judge_cut`·`reasoning_pair`·`judge_reasoning`·`judge_leak`·`reasoning_field`·`judge_think_off`·`judge_json`·`judge_responses` | 3.1 의 칸 값 |
| `http_error_code(status, kind)` | 상태·오류 종류 → `!…` |
| `checksum(text)`·`make_line(tag, fields)`·`parse_line(text)` | 검사합, 줄 만들기, 줄 읽기(검사합 확인) |
| `env_line`·`server_line`·`model_line` | 결과 dict → 줄 |
| `explain(parsed)`·`render_summary(lines)` | 줄 → 한국어 풀이(화면·결과 파일·`--decode` 가 같은 함수) |
| `safe_text(text)` | cp949 로 못 찍는 글자를 `?` 로 |

### 3.3 `ai_probe.py` 호출·흐름 — B

| 함수·클래스 | 책임 |
|---|---|
| `Resp` | `status`·`headers`(소문자 키)·`body`·`data`(JSON)·`seconds`·`error`(`!…`)·`redirect`(`s`/`o`/`t`) |
| `Client(base, key, timeout, ssl_ctx, budget, direct)` | 호출 하나: 3xx 처리기를 끄고(`http_error_30x` → `None` — `redirect_request` 만 끄면 그 앞에서 Location 을 읽다 `ValueError`, T-003), 본문 상한 8 MiB, 예외를 `!…` 로 바꾼다(`ValueError`·`UnicodeError` → `!c`, 깊은 JSON → `!j`). 키는 `key_on` 이고 `use_key=True` 일 때만 `Authorization: Bearer` 로. `secrets` = 이 서버의 가릴 값 |
| `Budget(max_calls)` | 호출 수 세기 — 넘으면 네트워크에 나가지 않고 `!q` |
| `probe_env(env, reg)` | `e` 줄 재료 |
| `probe_server(client, io, label, insecure, s)` | 키 없이 목록 → 연결 실패 + 프록시가 걸리면 직접 한 번 → 아래 '키 정책' → `/version`·`/api/version` → OPTIONS 사전 요청 → `k`·`h` 를 가려(`scrub`) 화면과 결과에 같이 쓴다. `s` 에 차례로 채운다 |
| `probe_model(client, entry, kind, io)` | 문맥 길이(목록 → `/tokenize` → 400 → `/api/show`) → 긴 질문 → 추론 low·high → 생각 끄기 → json_schema → Responses |
| `run(argv, io)` | 인자 읽기(줄임 안 받음, 오류 글에 값을 싣지 않음) → 환경 → 서버 반복(`read_key` → `Client` → `probe_server` → 모델마다 `probe_model`, 각각 예상 밖 오류는 `!e` 로 두고 다음으로) → 요약·코드·결과 파일 → 멈춤. Ctrl+C 면 남은 단계를 `!s` 로 두고 요약한다. `--cafile` 을 못 읽으면 알리고 종료 코드 2 |
| `read_key(args, io, interactive)` | `clean_key` 로 정리. 대화형이면 쓸 수 없는 글자일 때 세 번까지 다시 묻는다. `--key-env` 의 이름은 찍지 않는다 |
| `IO` | `ask`·`secret`·`say`·`pause` — 시험이 바꿔 끼운다. `secret` 은 `GetPassWarning`(가릴 수 없는 창)을 오류로 받아 키를 받지 않는다. 서버를 받은 뒤 `say` 와 결과 파일은 `redact` 를 지난다(마지막 그물) |
| `read_registry_proxy()` | Windows 레지스트리(`winreg`)의 `ProxyEnable`·`ProxyServer`·`ProxyOverride`·`AutoConfigURL`. 값은 화면에 찍지 않는다 |
| `serve_test(...)`·`ProbeHandler` | 3.4 |

모델 점검의 호출(모델 하나에 6~9번):

| 단계 | 요청 | 최대 답 |
|---|---|---|
| 문맥 길이 | 목록에 없으면 `POST /tokenize {"model","prompt":"가"}` → 없으면 `max_tokens=10000000` 인 짧은 채팅(400 메시지를 읽는다) → Ollama 면 `POST /api/show` | — |
| 긴 질문 | 9,000자 한국어 + "시작 표지·끝 표지를 `시작=…, 끝=…` 로" | 4096 |
| 추론 low·high | 작은 셈 문제 + `reasoning_effort` | 2048·8192 |
| 생각 끄기 | 같은 문제 + `chat_template_kwargs: {"enable_thinking": false}` | 2048 |
| json_schema | `response_format: {"type":"json_schema", …, "strict": true}` (`answer` 정수·`unit` 글자) | 1024 |
| Responses | `POST /v1/responses {"input", "max_output_tokens", "reasoning":{"effort":"low"}}` | 1024 |

**키 정책**(독립 점검 F-01·F-02·F-04 — Phase 6 의 AI 대리 호출도 따른다, 설계서_Architecture 6절):

| 키 없이 부른 목록의 답 | 경로 | 키 | 결과 |
|---|---|---|---|
| 200 | 아무것 | 보내지 않는다(그 서버의 모든 호출) | `a=n` |
| 401·403, 본문이 JSON 객체 | https, 또는 프록시 없음 | 보낸다 | `a=y` |
| 같음 | 평문 http + 프록시가 걸림 | 먼저 프록시 없이 키 없이 다시 — 닿으면 직접 연결로 보낸다, 안 닿으면 보내지 않는다 | `q=k` / `e=!p` |
| 401·403, 그 밖(HTML·XML·글·빈 본문·BOM 붙은 화면) | 아무것 | 보내지 않는다 | `e=!h` |
| 3xx | 아무것 | 따르지 않고 보내지 않는다 | `d=…`, `e=!r` |

- JSON 객체면 `Content-Type` 이 `text/plain` 이어도 API 로 본다(Go 의 `http.Error` 처럼 글 형식으로 JSON 을 보내는 서버가 있다). HTML·XML 형식이면 본문이 JSON 이어도 화면으로 본다
- 프록시 판정은 urllib 와 같다(`getproxies`·`proxy_bypass` — `NO_PROXY` 의 CIDR·`*`·`;` 목록은 urllib 가 읽지 못한다, T-004). 판정이 틀려도 평문 키는 프록시로 가지 않는다 — 키를 보내는 호출은 직접 연결이다

### 3.4 `--serve-test` — B

| 경로 | 동작 |
|---|---|
| `GET /?t=<토큰>` | 토큰이 맞으면 `Set-Cookie: mlprobe=<토큰>; HttpOnly; SameSite=Strict; Path=/` 와 303 → `/probe`. 틀리면 403 |
| `GET /probe` | `browser_probe.html`(같은 폴더). CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self' http: https:; base-uri 'none'; form-action 'none'`, `Cache-Control: no-store` |
| `GET /probe/ping` | 쿠키가 맞으면 200 `{"ok":true,"py":"…"}`, 아니면 403 |
| `POST /probe/echo` | 쿠키 필요. 본문 8 MiB 까지(넘으면 413, 길이 없으면 411) → `{"bytes":N}` |
| `POST /probe/result` | 쿠키 필요. 2 KB 이하의 `b …` 한 줄(인쇄 가능한 ASCII 만 — 콘솔 제어 글자를 받지 않는다) → 콘솔에 찍고 기억 |
| 모든 요청 | `Host` 가 `127.0.0.1:<포트>`·`localhost:<포트>` 가 아니면 403. 127.0.0.1 에만 묶는다. 토큰·쿠키는 바이트로 비교한다(ASCII 가 아닌 값에 `TypeError` 가 나지 않게) |

포트 기본값은 8770(MWL 서버 8765 와 다르게). 쓰는 중이면 다음 10개를 차례로 본다. `--port 0` 은 빈 포트.

### 3.5 `browser_probe.html` — C

| 단계 | 자동/손 | 내용 |
|---|---|---|
| 정리 | 자동 | 지난 시험 키(`mlprobe.cap.*`)를 지운다 |
| 환경 | 자동 | UA 의 브랜드·판, `isSecureContext`, `crypto.randomUUID`, `storage.persisted()`·`estimate()` |
| 경로 기록 | 자동 | `mlprobe.paths` 에 이 페이지 경로의 해시를 더한다 → 두 개 이상이면 공유 |
| MWL | 자동 | `mwl.progress` 있음·크기(내용은 읽지 않는다). 있으면 용량 시험 앞에 "MWL 을 닫았다" 단추 |
| fetch | 자동 | `fetch(location.href)` |
| 용량 | 자동 | localStorage 256K 글자 조각 → 16K → 1K 로 줄여 가며 채움(`finally` 에서 지움), IndexedDB 1 MB 조각을 목표(16·64·256 MB 고름)까지 |
| 표지 | 자동 | 처음이면 `mlprobe.keep`(localStorage·IndexedDB) |
| 서버 | 자동(http) | `/probe/ping`(쿠키), `/probe/echo` 1·4 MiB, 끝나면 `/probe/result` |
| 다시 연 뒤 | 손 | "크롬을 모두 닫았다 다시 열었다" 단추 → 표지 확인 |
| 클립보드·내려받기 | 손 | 단추. 내려받기는 "받아졌다/안 받아졌다" 로 사용자가 답 |
| AI 서버 | 손(선택) | 주소 입력 → `no-cors` → `cors` → 가짜 `Authorization` 사전 요청 |
| 흔적 지우기 | 손 | `mlprobe.*` 키와 시험 DB 를 지운다 |

`#selftest`(`&ai=<주소>`, `&idb=<MB>`) 는 손 단계 가운데 자동으로 할 수 있는 것(표지 확인·클립보드·AI 서버)을 돌리고, 끝나면 `<body data-done="1">` 과 `<pre id="selftest">`(검사합 검산 값·코드·오류 수 JSON)를 남긴다.

### 3.6 검증 도구

| 도구 | 인터페이스 |
|---|---|
| `verify_docs.py [--release] [--quiet]` | 대상 = 늘(README·`docs/트러블슈팅.md`·`docs/P*_체크리스트_*.md`·`docs/P*_테스트결과서_*.md`·`docs/guide/*.md`) + `--release`(CLAUDE.md·scope·Architecture·인터뷰결과서·요구사항정의서·설계서). BRIEF·history 는 보지 않는다. 검사 = 상대 링크, 백틱 안 저장소 경로, 백틱·코드 블록 안 명령(`python3 scripts/…`·`bash scripts/…`·`python3 tools/…`·`python3 -m mylearner`). `dist/` 는 생성물이라 건너뛴다 |
| `coverage_lite.py [--enforce] [--json F]` | `coverage_grades.json`: `roots`(측정 폴더), `A`·`B`(경로 앞부분 또는 `경로::함수이름패턴`), `exclude`, `thresholds`. 함수 단위 항목은 그 최상위 함수의 줄을, 나머지 줄은 파일 단위 항목을 따른다. 등급이 없는 줄이 있으면 `--enforce` 에서 실패 |
| `check_publish_safety.py` | 대상 = `git ls-files --cached --others --exclude-standard`. 막음 = IPv4(127/8·0.0.0.0·RFC 5737 세 대역 빼고, 줄에 `ip-ok` 가 있으면 뺌)·토큰 꼴(`gh?_`·`sk-`·`AKIA`·개인 키 머리·JWT)·메일(예시 도메인·`noreply@anthropic.com` 빼고)·금지 파일(`.env`·`*.key`·`*.pem`·`*.jks`·`*.keystore`·`secrets/`·`ai_probe_result*.txt`) |
| `check_probe_html.py` | 파일 하나·크기·`lang="ko"`·`charset`·외부 자원 0(`src`·`href`·`@import`·`url()`)·`<script src>` 없음·입력마다 라벨·단추마다 글·필수 요소 id |
| `browser_smoke.py [--shots DIR]` | Playwright 이미지의 `chrome-headless-shell` 을 `tests/ui/cdp.js` 가 CDP 로 몬다 — `body[data-done="1"]` 까지 기다린다(`--dump-dom` 은 비동기 작업 전에 끝나 쓰지 않는다, T-001). ① `file://` 두 경로(같은 프로필, 프로세스를 다시 띄움 — 공유·다시 연 뒤 남음까지) ② `--serve-test`(호스트 네트워크) ③ 가짜 AI 서버 두 가지(CORS 있음·없음). 검사 = `data-done`, 코드 검사합(Python 과 같은지), 검산 값, 오류 0, 기대 칸 값 |
| `pack_probe.py [--out DIR]` | `dist/mylearner-probe-v<판>.tgz`. 이름순·mtime 고정·uid/gid 0·gzip mtime 0 → 같은 입력이면 같은 바이트. 묶음 안 외부 URL 검사(루프백·RFC 5737 만 허용) |

## 4. 설정 — 외부화한 값과 기본값

| 값 | 기본 | 바꾸는 곳 |
|---|---|---|
| 호출 상한 | 80 | `--max-calls` |
| 호출마다 시간 제한 | 300초(400 메시지를 읽는 호출은 60초까지) | `--timeout` |
| 시험할 모델 | 전부(대화형에서 번호로 고름) | 대화형 입력, `--models` |
| 사내 인증서 | 시스템 저장소 | `--cafile`, `--insecure` |
| 시험 서버 포트 | 8770 | `--port` |
| 브라우저 IndexedDB 목표 | 64 MB | 화면의 고르기(16·64·256) |
| 긴 질문 길이 | 9,000자 | 상수 `LONG_CHARS`(바꾸면 코드 판을 올린다) |
| 개발 이미지 | 스모크·Python 3.12: `mcr.microsoft.com/playwright:v1.63.0-noble`, Python 3.14: `python:3.14.8-slim` | `scripts/dev_tools.env` |

대화형 입력을 쓰지 않는 실행(시험용): `--server URL`(여러 번), `--key-env 이름`(키를 환경 변수에서), `--no-pause`, `--out-dir`.

## 5. 오류 처리

| 상황 | 처리 |
|---|---|
| 연결 안 됨·시간 초과·TLS·HTTP 오류 | 예외를 밖으로 내지 않고 `!…` 로 그 칸에 남긴다. 다음 단계로 간다 |
| 서버 목록을 못 받음 | 서버 줄에 `e=!…`, 그 서버의 모델 점검은 건너뛴다 |
| 호출 상한 | 그 뒤 단계는 `!q` |
| Ctrl+C | 남은 단계 `!s`, 요약·코드·결과 파일을 낸다 |
| 예상 밖 예외 | 서버·모델 하나에서 나면 이름만 찍고 그 칸을 `!e` 로 두고 다음으로 간다 — 결과 코드는 끝까지 낸다. 그 밖(시작 전)에서 나면 이름만 찍고 창을 연 채 둔다 |
| `--cafile` 을 못 읽음 | 알리고 종료 코드 2(서버를 부르기 전) |
| 인자 오류 | 정해진 글만 찍고 종료 코드 2 — argparse 의 오류 글은 받은 값을 되풀이한다(키를 명령줄에 잘못 줬을 수 있다) |
| 출력 인코딩 | `sys.stdout.reconfigure(errors="replace")`, 글은 `safe_text` 로 |
| 오류 문구의 주소·키 | 주소를 읽지 못한 까닭은 정해진 글로만. 서버를 받은 뒤 화면 글과 결과 파일은 모두 `redact` 를 지난다(`IO.say`) |

## 6. 요구사항 추적

| FR | 코드 | 시험 |
|---|---|---|
| 101 | `scripts/check_env.sh` | verify 0단계 |
| 102 | `scripts/verify.sh` | 실행 자체 |
| 103 | `scripts/verify_docs.py` | `test_verify_tools.py` |
| 104 | `scripts/coverage_lite.py` | `test_verify_tools.py` |
| 105 | `scripts/check_publish_safety.py` | `test_verify_tools.py` |
| 106 | `scripts/pack_probe.py` | verify 묶음 단계, `test_verify_tools.py` |
| 110 | `ai_probe.py` 전체 | `test_ai_probe_static.py`(3.9 문법·제거된 모듈) |
| 111 | `probe_env`·`read_registry_proxy`·`proxy_kind` | 단위·통합 |
| 112 | `run`·`normalize_base`·`clean_key`·`read_key`·`IO.secret`·`_Parser` | 단위·통합(`test_ai_probe_keyleak.py` 두 벌) |
| 113 | `Budget`·`Client`·`run`(Ctrl+C) | 통합 |
| 114 | `Client`(리다이렉트)·`classify_redirect` | 통합(키 미전달)·단위 |
| 115 | `probe_server`·`proxy_applies` | 통합(죽은 프록시 → 직접, 가짜 프록시 `CaptureProxy` — 키를 못 봄) |
| 116 | `make_ssl_context`·`Client` | 통합(자체 서명 인증서) |
| 120~123 | `probe_server`·`auth_challenge`·`server_kind`·`ctx_from_*`·`cors_verdict` | 단위·통합 |
| 130~136 | `probe_model`·`make_long_prompt`·`judge_*` | 단위·통합 |
| 140~142 | `checksum`·`make_line`·`parse_line`·`*_line`·`explain`·`render_summary`·`leaks`·`scrub`·`model_label`·`--decode` | 단위·통합 |
| 143 | `safe_text`, 소스의 모든 글자 cp949 검사 | 단위 |
| 144 | `IO.pause`·`run` | 통합 |
| 150 | `serve_test`·`ProbeHandler` | 통합, 스모크 |
| 160~169 | `browser_probe.html` | `check_probe_html.py`, `browser_smoke.py` |

## 7. 아직 정하지 않은 것

| 것 | 어디로 |
|---|---|
| 브라우저 저장 방식과 한도 | 보류 결정 7 — 이 Phase 의 결과 코드로 Phase 3 시작 때 정한다(폐쇄망 실행은 보류 결정 8, 2026-10-15) |
| ~~Python 3.14 실행 시험~~ | → 전체 검증 4단계(`python:3.14.8-slim`, 사용자 승인 2026-10-15) |

## 8. 화면 — `browser_probe.html`

- 한 단 배치(폭 720px 까지, 휴대폰 폭에서도 한 단). 위에서부터 ① 제목과 한 줄 안내 ② **결과 코드 상자**(고정폭 큰 글자, "이 줄을 그대로 옮겨 적어 주세요") ③ 자동 점검 표(항목·결과·뜻) ④ 손으로 하는 점검 네 가지(단추) ⑤ 오류 상자(있을 때만) ⑥ 흔적 지우기
- 기본 단추는 화면마다 하나만 강조한다: 처음 열면 없음(자동), 다시 열었을 때는 "다시 열었다 — 남았는지 확인"
- 상태는 글로 말한다: `됨`·`안 됨`·`모름`·`안 함`(색은 거들기만). 빈 화면 = "점검 중…"(진행 줄), 오류 = 오류 상자에 메시지와 단계 이름
- 이 페이지는 MyLearner 화면 토큰(`web/styles.css`, Phase 3)보다 먼저 나오는 단독 도구라 인라인 CSS 를 쓴다(설계서_Architecture "화면 기준"의 예외)
