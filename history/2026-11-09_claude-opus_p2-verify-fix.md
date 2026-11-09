# 2026-11-09 — Phase 2: 시작 검증에서 렌더러 Chromium 단계 간헐 실패 → `cdp.js` 고침

- 작업자: Claude Opus 5.5(effort xhigh — 환경 변수) / 브랜치: `impl-phase2` / 이전 세션: [`2026-11-09_claude-opus_p2-review2.md`](2026-11-09_claude-opus_p2-review2.md)(`/clear` 뒤 새 대화, 사용자 지시 "3절 1번부터")

## 1. 한 일

- 0-1절: `check_env.sh` → `READY`. 전체 검증(`71d149b`)이 17단계 `렌더러 Chromium(XSS)` 만 실패 — 2초 만에 `FileNotFoundError: … out.json`, `docker run` 종료 코드 0. 다시 돌리면 통과
- 원인(T-009): 브라우저가 도중에 죽으면 `tests/ui/cdp.js` 의 CDP 요청 약속이 끝나지 않아 Node 가 결과 없이 0 으로 끝났다. 브라우저를 죽이는 주입(`docker exec … pkill -9`)으로 옛 코드 `exit=0`·out.json 없음을 재현. 브라우저가 왜 죽었는지는 모른다(⚠️ — 다시 나면 이제 종료 코드·신호·stderr 가 보인다)
- 조치: `cdp.js` — 연결 끊김에 기다리던 요청을 모두 실패시키고, 끊긴 뒤 요청은 바로 실패, 결과를 쓰기 전 루프가 비면 종료 코드 1. 같은 주입으로 `exit=1`·`신호 SIGKILL` 확인. `render_smoke.py` 15번 연속·`browser_smoke.py` 통과
- 문서: 트러블슈팅 T-009, 테스트결과서 1.1(새 출력)·7절 17번
- 사용자 요청으로 남은 작업 전체 목록을 정리해 알렸다(Phase 2 마무리 → 사용자 몰아서 할 일 → Phase 3~7, 보류 결정 1~8 의 트리거)

## 2. 검증 상태

- `bash scripts/verify.sh`(전체) → 18단계 통과(2026-11-09 11:1x, 커밋 직전 — 출력은 테스트결과서 1.1)

## 3. 다음 단계

1. **사람 리뷰(1절 8단계)**: 체크리스트 [`docs/P2_체크리스트_Core.md`](../docs/P2_체크리스트_Core.md). GitHub `impl-phase2` 에는 `1f388f4` 까지만 있다 — push 할지, 병합까지 할지 사용자에게 물었다(답에 따라)
2. 사용자가 병합을 요청하면 종료 루틴(1절 9단계): 전체 검증 > 로그 && 커밋 → history → `merge --no-ff` → push → 브랜치 보존 → `/clear` 권장
3. 앞 history 3절 3번(MWL 세션에 전할 것)·4번(Phase 3 시작 때 보류 결정 1·2·7·8, 설계서 7절 입력)은 그대로

## 4. 판단·관찰

- 간헐 실패를 다시 돌려 넘기지 않고 '0 으로 끝나는 길'을 막았다 — 결과 파일이 없는데 성공으로 끝나는 도구는 다른 실패를 숨긴다. 재시도는 넣지 않았다(브라우저가 죽는 까닭을 가린다)
- 비용: 누적 $106.88(API 정가, `python3 scripts/usage_cost.py --record` 11:1x)
