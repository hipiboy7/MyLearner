# 2026-10-15 — Phase 1: Python 3.14 시험 · 키 유출 독립 점검과 고침

- 작업자: Claude Opus 5.5(effort max — `~/.bashrc` 의 `CLAUDE_CODE_EFFORT_LEVEL=max` 가 사용자의 `/effort xhigh` 를 덮었다) / 브랜치: `impl-phase1` / 이전 세션: [`2026-10-15_claude-opus_p1-probe.md`](2026-10-15_claude-opus_p1-probe.md)(`/clear` 뒤 새 대화)

## 1. 한 일

- 사용자 답(이전 history 4절 1번): ① 독립 점검 서브에이전트 1개(sonnet) 승인 ② `python:3.14-slim` 받기 승인
- Python 3.14: `python:3.14-slim` 을 받아(`/data` 여유 61G 확인 뒤, 내려받기 45.7MB·디스크 177MB) `python:3.14.8-slim` 으로 판을 고정했다(같은 digest `sha256:a2b82f3c4855…`). `scripts/dev_tools.env`·`check_env.sh`·`verify.sh`(새 4단계, `PYTHONWARNINGS=error::DeprecationWarning` — 막는지 음성 확인함) → 전체 검증 12단계. CLAUDE.md 0·7·11절, 요구사항·설계·Architecture 갱신
- 독립 점검(키 유출): 서브에이전트가 저장소 사본에서 루프백만으로 실험 35개 — 지적 7건(중간 2)·관찰 5건·안전 17묶음·확인 못 한 의심 7. 메인이 원문 코드와 같은 스크립트로 모두 재현한 뒤 채택했다. 결과 표는 [`P1_테스트결과서_Probe.md`](../docs/P1_테스트결과서_Probe.md) 5.2절
- 고친 것(`tools/ai_probe.py`): 키는 JSON 객체 401·403 뒤에만(`auth_challenge`), 키 없이 200 이면 그 서버에 키 없음(`Client.key_on`), 평문 http 에 프록시가 걸리면 직접 연결로만 키(`q=k`) — 안 닿으면 안 보냄(`e=!p`), 서버가 준 글은 정해진 모양만(`_server_token`·`_ver`·`leaks`·`model_label`), 화면·결과 파일 `redact`, 주소의 `@`·한글 호스트·63자 칸 거절(정해진 글), 키 정리(`clean_key`·`read_key`), `GetPassWarning` 이면 키를 받지 않음, 인자 줄임·인자 오류 글의 값 되풀이 막음, 3xx 처리기 자체를 끔(T-003), 서버·모델마다 `!e` 안전망, 큰 수·깊은 JSON, 시험 서버 바이트 비교·결과 줄 ASCII, `--decode` 길이 상한, `HTTPError` 닫기
- 시험 38건 추가(단위 `test_ai_probe_keyleak.py` 20 — 먼저 써서 `FAILED (failures=10, errors=7)` 확인, 통합 같은 이름 18 — 고치기 전 코드에 돌리면 17 실패·1 오류), `fakes.py` 에 차단 화면 3종·깨진 Location·깊은 JSON·큰 수·`CaptureProxy`. 가짜 서버 닫힘 대기 0.5 → 0.05초(통합 27 → 11초)
- 문서: 요구사항정의서(FR-112·113·115·120·140·150, NFR-102), 설계서(3.1·3.2·3.3 '키 정책'·3.4·5·6절, 3.6절 `--dump-dom` 누락 바로잡음), Architecture 6절 '비밀'(Phase 6 도 따를 키 조건), 트러블슈팅 T-003·T-004, 테스트결과서(1~5·7·8절), 체크리스트 2절(새로 보일 수 있는 줄), `tools/README_KO.txt`, README, CLAUDE.md 11절(effort 환경 변수)
- 사용자가 GitHub `main` 에서 체크리스트를 찾지 못했다 — push 하지 않았기 때문(지난 보고에 "push 안 함"만 쓰고 GitHub 에서 못 본다는 것을 알리지 않음). 사용자 결정: ① `impl-phase1` 브랜치만 push(`main` 병합은 Phase 1 끝) ② 체크리스트는 묶음에 넣지 않는다 — 인터넷 PC·폰에서 GitHub 로 보며 따라 한다(묶음 `9193c63e` 그대로). push 전에 공개 전 점검 규칙으로 올라갈 커밋 4개의 파일 판 68개·커밋 메시지까지 훑어 0건. CLAUDE.md 1절 8단계에 '체크리스트를 알릴 때 브랜치 push 여부를 함께 묻는다', README 상태 줄, 체크리스트 0절에 GitHub 주소
- 사용자 지시: 작업 전·후 보고에 누적 비용($)을 적고 refresh 요청 전까지 누적한다 → `scripts/usage_cost.py`(Claude Code 가 세션마다 남기는 cost-state = `/cost` 값 + 진행 중 세션 나머지 추정)·`scripts/usage_prices.json`(가격 페이지 2026-10-15 확인: Opus 5.5 입력 $4·1시간 캐시 쓰기 $8·캐시 읽기 $0.20·출력 $20, Sonnet 5.5 $2·$4·$0.10·$10)·`history/usage_ledger.json`, 시험 11건(`tests/integration/py/test_usage_cost.py`, 먼저 써서 실패 확인), CLAUDE.md 11절 '비용 보고'. 응답 기록의 usage 는 서브에이전트 출력 토큰이 스트리밍 중간 값으로 남아(1,576 대 cost-state 249,587) 그대로 더하면 모자란다 — cost-state 를 기준으로 삼았다
- 17시: 사용자가 GitHub 에서 받는 곳을 물음 → 체크리스트 0절에 '나. GitHub `tools/` 에서 세 파일'(`ai_probe.py`·`browser_probe.html` 은 묶음 안 것과 바이트가 같고 `README_KO.txt` 는 BOM 만 다름, `certutil` 해시 앞자리 — 문서와 도구가 어긋나면 `test_verify_tools.py` 가 잡는다). 사용자 승인으로 브랜치 다시 push
- 처음 받은 결과 코드(`b`, `g=h`): 검사합 맞음, Chrome 155. 사용자 답으로 인터넷 PC 시험이었고 `r`·`s` 는 뜻 없는 값 — 폐쇄망 결과는 아직(P1 테스트결과서 10절)
- 18시: 사용자 결정 — "폐쇄망에서 돌려보는건 나중에하자. 체크리스트도 나중에 몰아서 할게." 확인 요청 세 가지를 추천안대로 승인: ① Phase 1 은 검증 통과로 병합, 폐쇄망 실행은 보류 결정 8(늦어도 Phase 3 시작) ② 보류 결정 7 트리거 Phase 2 → Phase 3 시작(저장 어댑터가 Phase 3) ③ 앞으로도 체크리스트는 위치만 알리고 피드백을 기다리지 않는다. CLAUDE.md 1절(Phase 표·8단계·보류 결정 7·8), scope 5·8·11·13절, P1 인터뷰결과서 5절, P1 요구사항 6절 기준 7, P1 설계서 7절, P1 테스트결과서 8·10절, README 상태 줄을 고침. 종료 루틴으로 `main` 에 병합·push
- effort: 16:05(KST) `/model` 뒤 응답부터 기록이 `max` → `xhigh` 로 바뀌었다(이 세션 133개 중 마지막 24개). 그전에는 `~/.bashrc` 의 환경 변수 때문에 `/effort xhigh` 가 안 먹었다. `/model` 화면이 effort 도 바꾼 것으로 보이나 원인은 확인하지 않았다

## 2. 최종 검증

- `bash scripts/verify.sh` → 12단계 통과(출력 원문은 P1 테스트결과서 1.1절). 시험 179건(단위 102 + 통합 77)이 Python 3.9.21·3.11.9·3.12.3·3.14.8 각각에서 통과, 건너뜀 0
- 커버리지 A 512/532 = 96.2%, B 648/664 = 97.6%
- 묶음 `dist/mylearner-probe-v1.tgz` 34,694 B, sha256 `9193c63e104e16734b5ec6009e26f4aab680f0b879065e45df178cd5aa670263` — Python 3.9·3.11·3.14 가 만든 것이 같음, 외부 URL 0
- 점검 스크립트를 고친 코드에 다시 돌림: 게이트웨이 답 22가지 중 키 13 → 2(JSON 객체 본문만), `NO_PROXY` 변형 28가지 중 프록시가 키를 봄 15 → 0, 되돌림 4종 걸림 0, 키 필요 없는 서버의 키 7/9 → 0, 멈춤 8가지 → 결과 코드 나옴

## 3. 판단·관찰

- JSON 객체 본문이면 `Content-Type: text/plain` 이어도 API 로 보고 키를 보낸다(Go 의 `http.Error` 꼴). 평문 프록시 경로는 F-02 규칙이 따로 막는다
- 평문 http 서버가 프록시로만 닿으면 그 서버는 `e=!p` 로 남고 모델 값을 못 잰다 — 그때 사용자와 정한다: `NO_PROXY` 에 그 호스트를 정확히(쉼표 목록) 넣고 다시 돌릴지, 프록시로 키를 보내도 되는지. Phase 6 로컬 서버의 AI 대리 호출 설계 입력이기도 하다(Architecture 6절)
- O-5(시험 서버 토큰이 한 번 쓰고 버리는 것이 아님)는 두었다 — 127.0.0.1 시험용, AI 비밀 아님, 새로 고침에 주소를 다시 써야 한다
- 결과 코드 판은 1 그대로 두고 값만 더했다(`q=k`, `e=!p`, `!e`, 이름 `?`) — 아직 폐쇄망에서 받은 코드가 없어 옛 판과 섞일 일이 없다
- 공개 전 점검이 새 시험의 사설 IP·`sk-` 꼴 고정값을 막았다 — 시험 고정값도 문서용 대역(RFC 5737)과 토큰 꼴이 아닌 가짜 키를 쓴다
- `/effort xhigh` 는 이 세션에 적용되지 않았다(`CLAUDE_CODE_EFFORT_LEVEL=max overrides this session`). 원인은 `~/.bashrc` 31줄 — 고치지 않았다(사용자 설정)

## 4. 다음 단계

0. ~~`impl-phase1` push · 받은 `b` 줄 풀이 · Phase 1 병합~~ → 2026-10-15 끝. `main` 에 `--no-ff` 병합하고 `main`·`impl-phase1` 을 push 했다(브랜치는 남긴다)
1. **Phase 2 시작**(코어, 화면 없음 — CLAUDE.md 1절): 0단계 `bash scripts/check_env.sh` → 0-1단계 보류 결정 표(Phase 2 가 트리거인 것은 없다 — 7·8 은 Phase 3 시작) → `main` 에서 브랜치 `impl-phase2` → 1단계 요구사항 도출: BRIEF 5.3(특히 5.3-2 사건 기록·늦은 복습 규칙·5.3-4 렌더러·5.3-5 저장)·5.9, scope, `설계서_Architecture.md`(6절 파일 형식·상수 위치·JS 시험), P1 산출물을 읽고 모자란 것만 **묶어서 한 번에** 묻는다 → `docs/P2_인터뷰결과서_<Topic>.md`
2. Phase 2 에서 받을 것: Docker `node:22-alpine`(JS 시험, 사용자 승인 2026-10-15 — 받기 전 `/data` 여유를 잰다, 태그를 `scripts/dev_tools.env` 에 고정). MWL 기준 커밋을 다시 본다(2026-10-15 `e053470`, 골든 벡터 `tests/fixtures/srs_vectors.json`·`scheduler_cases.json`)
3. Phase 2 독립 점검(CLAUDE.md 12절): 기록 합치기·늦은 복습 규칙(유실), 렌더러(XSS) — 쓰기 전에 수와 예상 토큰을 계산해 사용자에게 묻는다. effort 는 핵심 설계라 xhigh(11절)
4. 보류 결정 8(폐쇄망 실행)은 사용자가 결과 코드를 가져올 때: `python3 tools/ai_probe.py --decode "<줄>" …` → P1 테스트결과서 10절(`g=h` 줄의 `s` 는 무시, `r` 은 크롬을 다시 연 뒤 누른 것만), 보류 결정 7·8 을 닫고 scope 13절을 고친다. 묶음은 `dist/mylearner-probe-v1.tgz`(sha256 앞 8글자 `9193c63e`) 또는 GitHub `tools/` 세 파일(체크리스트 0절 '나'). `e=!p` 가 있으면 3절 둘째 줄대로 사용자와 정한다. 체크리스트 피드백은 그때의 테스트결과서나 다음 인터뷰결과서로
