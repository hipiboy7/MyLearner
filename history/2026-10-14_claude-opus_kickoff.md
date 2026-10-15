# 2026-10-14 — 착수: 규칙 읽기 · 임시 CLAUDE.md · 착수 인터뷰 1차 질문

- 작업자: Claude Opus 5.5(effort max) / 브랜치: `main`, 커밋 안 함(인터뷰 뒤 `impl-phase1` 에서 커밋) / 이전 세션: 없음(첫 세션)

## 1. 오늘 한 일

- 읽은 순서: Learn 루트 `CLAUDE.md` → agentic-sdlc `howtoUSE.md`(읽은 버전 `536276d`, 2026-10-06) → `docs/BRIEF.md` → `howtoWORKFLOW.md` → `howtoCLAUDEMD.md` → `howtoDELIVERABLE.md` 3절(인터뷰결과서·history 골격)
- 착수 상태: CLAUDE.md·`history/` 가 없어 "착수 전"(Learn 루트 3절) → BRIEF 를 기획으로 착수 인터뷰를 시작했다
- 임시 `CLAUDE.md` 를 만들었다: 사용자가 준 '사용자와 말하는 방식' 규칙(사용자 지시 — CLAUDE.md 에 넣고 지킨다), Learn 루트 규칙 `@` 가져오기(BRIEF 7절), 착수 중 읽는 순서, agentic-sdlc 받은 폴더·읽은 버전, effort 를 먼저 제안하라는 사용자 지시
- 착수 인터뷰 1차 질문과 토큰 절약 제안을 사용자에게 냈다(3절 끝 목록). 답을 기다린다

## 2. 최종 검증

해당 없음(코드 없음).

## 3. 판단·관찰

- 공식 문서 확인(2026-10-14, code.claude.com `docs/en/memory`·`docs/en/model-config`):
  - CLAUDE.md `@경로` 가져오기 — 절대 경로 가능, 최대 4단계, 코드 블록·코드 스팬 안은 가져오지 않는다. 작업 폴더 밖 파일은 처음 한 번 승인 창이 뜨고, 거절하면 꺼진 채 다시 묻지 않는다. 가져온 파일도 시작 때 모두 실린다(컨텍스트를 줄이지 않는다). 블록 HTML 주석은 컨텍스트에 실리지 않는다. 파일당 200줄 이하 권장. `.claude/rules/` 의 `paths` 규칙은 맞는 파일을 만질 때만 실린다
  - effort — 세션 중 `/effort <단계>`(low·medium·high·xhigh·max). 단계 이름으로 정하면 기본값으로 저장돼 다음 세션에도 쓰인다. `max` 는 `CLAUDE_CODE_EFFORT_LEVEL` 로 주지 않으면 그 세션에만 적용된다. 아무것도 정하지 않으면 Opus 5.5 는 `medium`
- Learn 루트 CLAUDE.md 안의 `@`(`mwm-app@9c3b5ff` 등)는 모두 코드 블록 안이라 가져오기로 읽히지 않는다(grep 확인)
- 환경 실측(2026-10-14): 4코어, 메모리 15Gi(Learn 루트 7절의 31GiB 와 다르다), 디스크 여유 `/` 20G·`/data` 66G, Claude Code 2.1.299. Docker 이미지는 `node:20-alpine`(191MB)이 있고 `node:22`·Playwright 는 없다. MWL 은 `scripts/run_js_tests.sh` 에서 `node:20-alpine` 컨테이너로 JS 시험을 돌렸다
- Learn 루트 8절의 표지는 이모지 없는 옛 판이다 → 이 프로젝트는 사용자가 준 판(✅·💬·❓)을 쓴다(프로젝트 규칙 우선)
- 1차 질문(번호는 사용자에게 낸 것과 같다, 괄호는 추천):
  - A 진행 방식: 1 인터뷰를 묶어 묻기(묶기) · 2 BRIEF 6절 3·5·6·7·8·9 는 그 Phase 시작 때 묻기(미루기, 보류 결정 표에 트리거) · 3 학습가이드(만들지 않음, 결과 보고는 개발자 기준으로 짧게) · 4 작업 프롬프트(없음) · 5 프로토타입(없음) · 6 검토(사람 리뷰는 '써 보기'로 유지 / 다른 에이전트 점검은 합치기·렌더러·비밀값·점검 도구 4곳만 / 전체 재독 대신 grep + Phase 끝 1회 일관성 점검) · 7 PR 없음, 서브에이전트 동시 2개·sonnet · 8 병합 요청을 push 허락으로 봄
  - B 범위·설계: 9 S1~S7·5.3·5.9 를 그대로 확정(그대로) · 10 화면은 MWL 골격(바닐라 JS·`styles.css`), Tailwind·어워드 시안 안 함(MWL) · 11 기한
  - C 환경: 12 폐쇄망 PC Python·Edge 판(모르면 점검 도구가 잰다) · 13 Docker `node:22-alpine`·Playwright 받기(받는다) · 14 세션 유지는 백그라운드 세션(충분) · 15 Learn 루트 README 지도에 추가(루트 세션에 맡긴다)

## 4. 다음 단계

1. 1차 답을 받는다. 다음 세션에서 이어 가면 질문을 새로 만들지 말고 위 목록으로 답만 받는다
2. `docs/P1_인터뷰결과서_Scope.md` → `docs/scope-definition.md`(howtoDELIVERABLE 3절)
3. CLAUDE.md 를 골격 0·0-1·1~13절로 채우고 점검표(howtoCLAUDEMD 5절)를 통과시킨다 → 그 세션 history 에 `## agentic-sdlc 사용기록` 한 줄(Learn 루트 3절)
4. Phase 1: 0단계 환경 정찰(원격 인증·프록시 → CLAUDE.md 0절), 기본 폴더(howtoDIRECTORY 1절), `impl-phase1` 브랜치, 요구사항정의서부터. 첫 산출물은 점검 도구 2종(BRIEF 5.8)
