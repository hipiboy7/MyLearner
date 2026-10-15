# 2026-10-15 — Learn 루트 README 지도에 MyLearner 추가 · 루트 7절 메모리 다시 재기

- 작업자: Claude Opus 5.5(effort max — 문서 갱신이라 medium 이면 충분했다) / 브랜치: `impl-phase1` / 이전 세션: [`2026-10-15_claude-opus_kickoff-done.md`](2026-10-15_claude-opus_kickoff-done.md)(`/clear` 뒤 새 대화)

## 1. 한 일

- Learn 루트 문서 두 개를 이 세션이 고쳤다. Learn 루트 CLAUDE.md 1절과 인터뷰 15번은 루트 세션의 일로 정했지만, 사용자가 이 세션에 직접 지시했다. Learn 루트는 git 저장소가 아니라서 커밋은 없고, 바뀐 내용은 그 두 파일에만 있다
  - `/data/projects/Learn/README.md` — 지도 표 끝에 MyLearner 줄(위치·무엇·유형 agentic-sdlc `536276d`·GitHub private·상태·BRIEF 링크 `../MyLearner/docs/BRIEF.md`). '프로젝트 사이의 관계'에 "Learn 자료(kids 제외)를 가져온다, hub 용 `content/` 는 만들지 않는다" 한 줄(이 저장소 CLAUDE.md 1·13절)
  - `/data/projects/Learn/CLAUDE.md` — 7절 메모리 31GiB → 15Gi, 머리에 정정 이력 한 줄
- 이전 history 3절의 "사용자가 할 일: 루트 세션에 요청"은 이것으로 끝났다

## 2. 검증(2026-10-15 실측)

- `free -h` → Mem total `15Gi` · `grep MemTotal /proc/meminfo` → `16107668 kB` · `lsmem` → `Total online memory: 16G`
- `test -f /data/projects/MyLearner/docs/BRIEF.md` → 있음(README 링크 대상) · 고친 두 파일의 권한은 `660`, 그룹 그대로(다른 계정 세션도 읽는다)
- `grep -n 31GiB /data/projects/Learn/*.md` → 정정 이력 한 줄만 남음

## 3. 관찰(고치지 않음)

- `lscpu` → 소켓 1 × 코어 4 × 스레드 2 = 논리 CPU 8(`nproc` 8). CLAUDE.md 0절과 Learn 7절의 '4코어'는 코어 수로는 맞다
- `df -h` 여유 → `/` 17G·`/data` 61G. CLAUDE.md 0절 값(20G·66G)보다 줄었다. Learn 7절 디스크 칸(2026-09-30 값)도 그대로 뒀다 → 같은 대화 뒤에서 사용자 지시로 둘 다 고쳤다([`2026-10-15_claude-opus_p1-probe.md`](2026-10-15_claude-opus_p1-probe.md))
- VM 은 거의 매일 밤 꺼지고 아침에 켜진다(`last -x shutdown` — 9월 초부터 같은 모양). 백그라운드 세션·컨테이너는 밤을 넘기지 못한다(인터뷰 14번 '세션 유지는 백그라운드 세션으로 충분'과 함께 볼 것)
- 31GiB(2026-09-29)와 15Gi 가 다른 까닭은 확인하지 못했다. 저널은 이번 부팅분만 남고 sysstat 기록이 없다

## 4. 다음 단계 — Phase 1 (`impl-phase1`)

이전 history 4절과 같다.

1. 0단계: `scripts/check_env.sh`(`READY`) 를 만든다. 0-1: Phase 1 이 트리거인 보류 결정은 없다
2. 4단계 ① `docs/P1_요구사항정의서_Probe.md` — FR-101~. 점검 도구 2종(BRIEF 5.8)을 Python 3.9 이상·Chrome 기준으로(scope-definition 11절). 전체 검증 명령·문서 검사도 FR 로
3. ② `docs/P1_설계서_Probe.md` 와 `docs/설계서_Architecture.md`(디렉토리·패키지 이름·모듈·화면 기준·테스트 배치·커버리지 도구)
4. ③ 코드+시험: `tools/ai_probe.py`(판정·요약 함수 등급 A, 호출 흐름 등급 B — 가짜 서버 시험 목록은 BRIEF 5.8), `tools/browser_probe.html`(등급 C), `scripts/verify.sh`·`scripts/verify_docs.py`(MWL 것을 복사해 고친다)
5. ④ `docs/P1_테스트결과서_Probe.md`. 6단계 독립 점검: `ai_probe.py` 키 유출 — 서브에이전트 1개(sonnet), 쓰기 전에 사용자에게 요청(CLAUDE.md 12절)
6. 7단계: README 빠른 시작, `docs/P1_체크리스트_Probe.md`(폐쇄망에서 두 도구를 돌려 결과 코드를 전하는 순서) → 8단계: 체크리스트 위치를 알리고 피드백을 기다린다
