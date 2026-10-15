# 2026-10-15 — Phase 2: 코어(화면 없음) — 만드는 중, WIP

- 작업자: Claude Opus 5.5(effort xhigh — 환경 변수) / 브랜치: `impl-phase2`(WIP 커밋 `5f77ec4`) / 이전 세션: [`2026-10-15_claude-opus_p1-review.md`](2026-10-15_claude-opus_p1-review.md)(`/clear` 뒤 새 대화)

## 1. 한 일

- 0-1절 순서대로 읽고 `check_env` READY·`verify.sh` 12단계 통과 확인 → `main` 에서 `impl-phase2`
- 인터뷰(묶어서 한 번): 1 여러 과정의 '오늘' = A(복습·새 카드 합침, 새 강의는 주 과정 하나), 2 학습일 경계 자정, 3 독립 점검 서브에이전트 2개(sonnet) 승인, 4 MWL 진도 파일 없음 → [`docs/P2_인터뷰결과서_Core.md`](../docs/P2_인터뷰결과서_Core.md)
- 4단계 산출: [`P2_요구사항정의서_Core.md`](../docs/P2_요구사항정의서_Core.md)(FR-201~263) → [`P2_설계서_Core.md`](../docs/P2_설계서_Core.md) → 코드·시험 → [`P2_테스트결과서_Core.md`](../docs/P2_테스트결과서_Core.md)(초안 — 5.2② 비어 있음)
  - `web/core/*.js` 13개(classic script, 전역 `MyLearner`): constants·dates·hash(SHA-256)·srs·grade·course(검사·색인)·log(사건·기록 파일·합치기)·replay(늦은 복습 규칙)·plan·mastery·stats·markdown·mwl_import
  - `mylearner/constants.py`·`mylearner/convert/mwl.py`(`python3 -m mylearner.convert.mwl`) — MWL 과정 변환기를 Phase 3 에서 당겼다
  - MWL `e55b9c0` 골든 벡터 복사본 `tests/fixtures/mwl/`(SM-2 12·계획 19·숙련도 2·통계 2 + MWL `markdown.py` 로 그린 렌더러 39가지) — `python3 scripts/import_mwl_fixtures.py [--check]`
  - 새 검증 단계 6개(전체 18단계): 12 JS 시험(Node 22, 줄 90·분기 80) · 13 `check_core_js.py` · 14 골든 복사본 · 15 기록 왕복 `check_log_roundtrip.js` · 16 MWL 실데이터 `check_mwl_real.py` · 17 렌더러 Chromium `render_smoke.py`
  - Docker `node:22.23.3-alpine` 받음(60MB, 사용자 승인 2026-10-15) — `scripts/dev_tools.env` 에 `NODE_IMAGE`·`MWL_REPO`
- 결과(커밋 `d0fd77e` 기준): MWL 실과정 강의 135·카드 1,350·실습 91·드릴 24·퀴즈 55·용어 350·진단 35, 과정 검사 오류 0, 렌더 135/135·91/91·192/192 첫 실행에 일치, 두 번 변환 같은 바이트(4,505,095 B), 기록 왕복 유실 0, 사건 5만 줄 합치기+다시 계산 약 0.55초
- 독립 점검 ①(기록 합치기·늦은 복습 규칙, sonnet 12분) 지적 11건을 메인이 재현한 뒤 모두 처리(커밋 `5f77ec4`) — 표는 테스트결과서 5.2①. 굵은 것: MWL 스냅숏 두 번 들여오기의 이중 계산(F6) → 가상 기기를 설치마다 하나·기록마다 정해진 순번·세션 그날 합계, 해석하지 못한 줄은 글자 그대로(F4), 상속 이름 ID 로 전역 `Object` 에 쓰던 것(F5)
- 문서: CLAUDE.md(0절 MWL 커밋·Node·핵심 상수, 1절 Phase 2 산출물, 정정 이력), scope 8·11절, Architecture(3·5·6·7·9·10·11·12절), 트러블슈팅 T-005(보이지 않는 글자가 날것으로 들어가 정규식 깨짐)·T-006(cp949 에 `—` 없음), README 상태·빠른 시작, 체크리스트 [`P2_체크리스트_Core.md`](../docs/P2_체크리스트_Core.md)(초안)
- 사용자 지시(22:33): WIP 커밋·history·`impl-phase2` push 뒤 멈춘다

## 2. 검증 상태

- `bash scripts/verify.sh --quick` → 18단계 통과(3·4·10·17 건너뜀, 2026-10-15 22:31, WIP 커밋 직전). 전체(`--quick` 없이)는 `d0fd77e` 에서 마지막으로 통과 — **`5f77ec4` 에서는 아직 안 돌렸다**
- JS 시험 92건 통과, `web/core` 줄 100%·분기 85.34%. Python 210건, A 96.3%·B 93.8%(변환기 84.3%)

## 3. 독립 점검 ② — 렌더러 XSS (진행 중, 이 세션에서 결과를 받지 못함)

- 서브에이전트(sonnet)가 `d0fd77e` 사본을 `/tmp/claude-1006/-data-projects-MyLearner/76219164-d1c7-4533-8ca8-25fbd9405b82/scratchpad/review-xss/` 에서 보는 중이었다(재현 스크립트 `t/*.js`, `t/chrome_fuzz.html`). 임시 폴더라 VM 이 꺼지면 사라진다
- 22:33 의 `findings.md` 내용(점검자 글 그대로, 메인 재현 전):

  ```
  ## Setup notes
  - Copy at repo/ (git archive d0fd77e). Node harness t/*.js run in node:22.23.3-alpine; Chromium via playwright image + repo/tests/ui/cdp.js.
  - SAFE (confirmed): 300k grammar-fuzz renders in Node (html_allow.check) and 40k renders in real headless Chromium (DOM allowlist, window.__xss) => 0 problems.
  - SAFE: placeholder inside link href ([x](http://a/![b](c))): final PLACE replace is single pass, nested placeholder text is NOT expanded; output href="http://a/<U+E000>0<U+E001>" (garbage chars in href, functional glitch only, no attribute breakout).

  ## DoS (ReDoS) — in progress
  - heading regex: '# a' + ' '*20000 + 'x' did not finish in 10 minutes (cubic).
  - strip_ws_run: 'a'+' '*20000+'b' = 1125 ms (quadratic).
  ```

- 뜻: 지금까지 실행되는 XSS 는 0(Node 30만·Chromium 4만 퍼징). 대신 **서비스 거부**가 둘 — 제목 정규식 `^(#{1,6})WS+(.*?)WS*#*WS*$` 가 공백이 긴 줄에서 끝나지 않는다(3제곱), `strip` 의 `WS+$` 가 공백 사이에 글자가 있으면 2제곱. 남이 만든 과정 파일 하나로 화면이 멈출 수 있다. MWL `markdown.py` 의 정규식도 같은 꼴이다(⚠️ Python 에서 재지 않았다)

## 4. 다음 단계

1. **독립 점검 ② 결과 반영**: 이 대화에서 결과가 오면 지적마다 원문 코드로 재현한 뒤 고친다. 결과가 없으면(세션이 끝남) **다시 돌린다** — 사용자 승인 범위 안(인터뷰 3번, 1개 sonnet). 지시문은 테스트결과서 5.2 머리의 방식 + 이 history 3절의 대상 파일(`web/core/markdown.js`·`grade.js`(`unsafeRegex`·`checkLab`)·`course.js` E-REGEX, 시험 `tests/fixtures/xss_cases.js`·`tests/unit/js/html_allow.js`·`tests/ui/render_check.html`·`scripts/render_smoke.py`), 대상 커밋은 그때의 HEAD, 임시 폴더 `…/scratchpad/review-xss2/`
   - 이미 보인 DoS 두 건은 결과와 상관없이 고친다: 제목·목록·표 구분 줄의 `WS*…WS*$` 겹침을 정규식 대신 손으로(뒤 공백·`#` 떼기) 처리하거나 줄 길이에 맞는 상한을 둔다. **MWL 패리티를 지킨다** — 렌더러 39가지(`tests/fixtures/mwl/markdown_parity.json`)·135과 대조(`python3 scripts/check_mwl_real.py`)가 그대로 통과해야 한다. 회귀 시험: 공백 2만 칸 줄이 1초 안에 끝난다(`markdown.test.js` '깊이·크기')
2. **테스트결과서 5.2② 채우기**(①과 같은 표: 지적·메인 재현·처리), 1.1(전체 검증 출력)·2(시험 수)·3(커버리지 — 지금 JS 92건·분기 85.34%)을 마지막 실행 값으로
3. **기록 왕복 숫자 다시 맞추기**: 왕복 명령에 새 판·읽을 수 없는 줄·충돌을 넣어 난수 소비가 바뀌었다 — 체크리스트 3절·테스트결과서 1.3절의 시드 7 출력을 다시 돌려 복사한다(`docker run --rm -v "$PWD:/w:ro" -w /w node:22.23.3-alpine node scripts/check_log_roundtrip.js --rounds 365 --seed 7`). 22:2x 에 돌린 값: 마지막 파일 집 PC 3254 · 폰 3254 · 폐쇄망 5012줄, 새 판 32 · 읽을 수 없는 줄 27 · 같은 순번 다른 줄 24
4. **전체 검증** `bash scripts/verify.sh`(quick 아님) → 종료 코드 0 이면 커밋. 테스트결과서 1.1 에 출력 원문
5. Phase 2 마무리(CLAUDE.md 1절 7·8단계): 체크리스트 위치 알림(브랜치는 push 했다 — GitHub `impl-phase2` 에서 보인다), 결과 보고에 알릴 것 — MWL `web/engine.js` `checkLab` 이 `(?i)` 실습 문항 5개를 늘 오답으로 낸다(MWL 결함, 읽기만 하므로 고치지 않음 — 사용자가 MWL 세션에 전할지), 보류 결정 2(MWL 이관 시점)에 '같은 설치 스냅숏은 다시 들여와도 겹치지 않음'을 입력으로. 사용자가 병합을 요청하면 종료 루틴(1절 9단계)
6. 보류 결정 8(폐쇄망 실행)은 그대로 — 늦어도 Phase 3 시작

## 5. 판단·관찰

- 늦은 복습 규칙을 하나 다듬었다: 같은 날 두 기기의 again 은 한 번만 반영(ef 를 두 번 깎지 않는다) — scope 11절, 설계서 3.4절 6b
- MWL 은 한 카드를 하루 한 번만 복습한다(복습 대기열 = 그날 계획의 due·새 카드, MWL `web/app.js` 297줄) → 같은 날 다른 상태의 스냅숏은 생기지 않는다(F7 을 고치지 않은 까닭)
- 파일 쓰기 도구가 ` `·`﻿`·`` 이스케이프를 날것으로 쓴 일이 있었다(T-005) — JS 를 쓸 때는 `check_core_js.py` 가 잡는다
- 비용: 이 세션까지 누적 $85.87(API 정가, `python3 scripts/usage_cost.py --record` 22:33 — 돌고 있는 sonnet 서브에이전트 2개의 몫은 아직 들어가지 않았다)
