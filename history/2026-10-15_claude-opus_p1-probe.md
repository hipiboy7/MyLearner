# 2026-10-15 — Phase 1: 폐쇄망 점검 도구 2종 · 검증 체계

- 작업자: Claude Opus 5.5(effort max) / 브랜치: `impl-phase1` / 이전 세션: [`2026-10-15_claude-opus_learn-root-map.md`](2026-10-15_claude-opus_learn-root-map.md)(같은 대화에서 이어 했다)

## 1. 한 일

- 사용자 지시로 Learn 루트 CLAUDE.md 7절과 이 저장소 CLAUDE.md 0절의 디스크 여유를 다시 쟀다(`/` 17G·`/data` 61G, 정정 이력 둘 다)
- Phase 1 4단계 산출: `docs/P1_요구사항정의서_Probe.md`(FR-101~169) → `docs/P1_설계서_Probe.md`(결과 코드 v1·흐름·검증 도구) + `docs/설계서_Architecture.md` → 코드와 시험 → `docs/P1_테스트결과서_Probe.md`
  - `tools/ai_probe.py` — AI 점검(대화형), `--serve-test`(127.0.0.1 시험 서버, 토큰 → 쿠키·CSP·Host 검사), `--decode`(결과 코드 풀이)
  - `tools/browser_probe.html` — localStorage·IndexedDB 용량, 다시 연 뒤 남음, `file://` 사본 공유, `mwl.progress`, fetch·파일 저장 창·클립보드·내려받기, (선택) AI 서버 직접, 서버 모드
  - `scripts/` — `check_env.sh`, `verify.sh`(11단계), `verify_docs.py`·`coverage_lite.py`(MWL `e053470` 에서 옮겨 고침), `check_publish_safety.py`, `check_probe_html.py`, `browser_smoke.py`, `pack_probe.py`, `dev_tools.env`
  - 시험 141건(단위 82·통합 59) + 브라우저 스모크 3단계(`tests/ui/cdp.js` — Node 24 내장 WebSocket 으로 CDP)
- 7단계: README 빠른 시작·문서 목록, `docs/트러블슈팅.md` T-001·T-002, `docs/P1_체크리스트_Probe.md`, `docs/screenshots/P1/`
- CLAUDE.md·scope 에서 'Phase 1 에서 만든다'를 현재형으로(정정 이력)

## 2. 최종 검증

- `bash scripts/verify.sh` → 11단계 통과(출력 원문은 P1 테스트결과서 1.1절). 시험 141건이 Python 3.9.21·3.11.9·3.12.3(Playwright 이미지) 각각에서 통과, 건너뜀 0
- 커버리지 A 450/471 = 95.5%, B 575/593 = 97.0%
- 묶음 `dist/mylearner-probe-v1.tgz` 30,969 B — 두 번 만들어 같음, 외부 URL 0

## 3. 판단·관찰

- 결과 코드는 사람이 손으로 옮겨 적는다고 보고 줄마다 2글자 검사합(CRC-16 하위 10비트, Crockford base32)을 달았다. JS 와 Python 의 검산 값이 같다
- Playwright 이미지(`mcr.microsoft.com/playwright:v1.63.0-noble`, 3.53GB)가 이 VM 에 이미 있어 Phase 1 부터 썼다 — 받지 않았다. 그 안의 Python 3.12 로 시험을 한 번 더 돌리고, Node 24 로 CDP 를 몰았다(npm 없음)
- 헤드리스 Chromium 153 의 `file://`: classic script 만 돈다(module 안 돎, Worker `SecurityError`), 자기 파일 fetch 막힘, `isSecureContext` 참, 사본끼리 저장소 공유 → 설계서_Architecture 6절. 폐쇄망 Chrome 150 은 결과 코드로 다시 본다
- 자체 점검에서 키 유출 한 가지를 찾아 고쳤다 — 프록시의 HTML 401·403 차단 화면에 키를 다시 보내던 것(테스트결과서 5절 1). 기본 시간 제한 180 → 300초
- 독립 점검(키 유출)은 CLAUDE.md 12절대로 쓰기 전에 사용자 승인을 받는다 — 이 세션 끝의 확인 요청
- VM 은 거의 매일 밤 꺼진다(이전 history) — 긴 작업은 낮에 한다

## 4. 다음 단계

1. 사용자 답 기다림: ① 독립 점검 서브에이전트 1개(sonnet, 키 유출) 승인 ② `python:3.14-slim` 이미지를 받아 3.14 에서도 시험할지
2. 승인되면: 독립 점검 → 지적을 원문으로 확인 → 고침 → `bash scripts/verify.sh` → 테스트결과서 5·8절 갱신 → `python3 scripts/pack_probe.py` 로 묶음을 다시 만들어 사용자에게 체크리스트 위치를 알린다(그전에는 반입하지 않는다)
3. 사용자가 폐쇄망 결과 코드를 전하면: `python3 tools/ai_probe.py --decode "<줄>" …` → 테스트결과서 10절, CLAUDE.md 1절 보류 결정 7 을 닫고, scope 13절 '확인할 사실'을 고친다. 체크리스트 피드백(MWL 을 여는 방식 등)은 테스트결과서나 P2 인터뷰결과서로 옮긴다
4. Phase 1 끝: 사용자가 병합을 요청하면 종료 루틴(CLAUDE.md 1절 9단계 — 전체 검증 → history → 커밋 → `merge --no-ff` → push)
