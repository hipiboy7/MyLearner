# MyLearner

내가 넣은 자료로 강의·카드·퀴즈를 만들고 매일 복습해 몸에 익히는 **1인용 학습 플랫폼** — 폐쇄망 PC · 내 PC · 안드로이드 폰.

**지금 상태(2026-10-15): Phase 2(코어, 화면 없음) 만드는 중 — 브랜치 `impl-phase2`** — 과정·기록 파일 형식, 기록 합치기(합집합)·늦은 복습 규칙, SM-2·하루 계획·숙련도·통계(MWL 골든 벡터 통과), 렌더러(MWL 135과와 같은 HTML·XSS 대책), MWL 과정 변환기·진도 변환을 만들었다. 써 보기는 [`docs/P2_체크리스트_Core.md`](docs/P2_체크리스트_Core.md). Phase 1(폐쇄망 점검 도구 2종)은 `main` 에 있고, 폐쇄망에서 돌리는 것은 사용자가 나중에 한다([`docs/P1_체크리스트_Probe.md`](docs/P1_체크리스트_Probe.md), CLAUDE.md 보류 결정 8). 규칙은 [`CLAUDE.md`](CLAUDE.md), 범위는 [`docs/scope-definition.md`](docs/scope-definition.md), 진행 기록은 `history/` 에 있다.

## 0. 빠른 시작 — 개발 VM (Phase 1·2)

```bash
cd /data/projects/MyLearner
bash scripts/check_env.sh        # 마지막 줄 READY
bash scripts/verify.sh           # 전체 검증 18단계(약 2분). 느린 Docker 단계를 빼려면 --quick
bash scripts/run_js_tests.sh     # JS 시험만(Docker Node 22) — 파일을 주면 그것만
python3 scripts/check_mwl_real.py --out dist/courses/mwl.course.json   # MWL 미들웨어 과정 → 과정 파일 + 135과 렌더 대조
python3 scripts/pack_probe.py    # 폐쇄망 점검 묶음 dist/mylearner-probe-v1.tgz
```

- 폐쇄망에서 하는 일(압축 풀기 → AI 점검 → 브라우저 점검 → 결과 코드 옮겨 적기)은 [`docs/P1_체크리스트_Probe.md`](docs/P1_체크리스트_Probe.md)
- 받은 결과 코드 풀이: `python3 tools/ai_probe.py --decode "<줄>" "<줄>"` — 줄마다 검사합을 확인한다
- 이 저장소에서 쓴 Claude Code 비용 누적(API 정가 $): `python3 scripts/usage_cost.py` — 에이전트가 보고마다 `--record` 로 남긴다(CLAUDE.md 11절)
- 커밋 전에는 `bash scripts/verify.sh > 로그 && git commit …` 처럼 종료 코드 0 일 때만 커밋한다(CLAUDE.md 1절 9단계)

## 1. 첫 세션 — 착수 (2026-10-15 마침)

MiddlewareLearner 폴더가 아니라 **이 폴더에서** 연다. 이 BRIEF 를 만든 것과 **같은 VM 계정**으로 접속한다(계정마다 Claude Code 기록이 따로다 — `whoami` 로 확인).

```bash
cd /data/projects/MyLearner && claude -n mylearner --model opus --effort max
```

첫 말:

```text
docs/BRIEF.md 를 기획으로 삼아, /data/projects/agentic-sdlc/docs/howtoUSE.md 를 읽고 그 순서대로 이 프로젝트를 시작해라.
이 폴더는 Learn 워크스페이스 밖이지만 /data/projects/Learn/CLAUDE.md 의 공통 규칙(경계 규칙·착수 절차)을 따른다 — 그 파일을 먼저 읽어라.
```

에이전트가 착수 인터뷰를 시작한다. BRIEF 6절의 질문에 답하면 CLAUDE.md·scope·첫 Phase 가 생긴다. 커밋 작성자는 이 저장소의 git 설정에 이미 들어 있다(`git config user.name` 으로 확인).

## 2. 이어 하기 — 세션 유지

Claude Code 의 대화와 메모리는 **VM 계정 × 폴더** 마다 저장된다. 같은 계정으로, 이 폴더에서 열면 이어진다.

| 하고 싶은 것 | 명령 |
|---|---|
| 마지막 대화를 이어서 | `cd /data/projects/MyLearner && claude --continue --model opus` |
| 새로 열고 기록부터 읽게 | `cd /data/projects/MyLearner && claude --model opus` → "이어서 하자" |
| 지난 대화 가운데 골라서 | `claude --resume` (목록에서 `mylearner`) |
| SSH 가 끊겨도 계속 돌게 | `claude --bg -n mylearner` 로 띄우고 `claude attach mylearner` 로 붙는다. ← 로 목록, Ctrl+Z 로 셸 — 세션은 계속 돈다 |
| 돌고 있는 세션 보기·끝내기 | `claude agents --cwd /data/projects/MyLearner` · `claude logs mylearner` · `claude stop mylearner` |

- 같은 폴더에서 두 번째 창을 `claude -c` 로 열지 않는다(두 프로세스가 같은 대화 파일에 쓴다). 갈라서 이어 가려면 `claude --resume <세션ID> --fork-session`.
- `--model opus` 를 붙이는 이유: 새로 열면 조직 기본 모델(Sonnet)이 적용될 수 있다(2026-10-15 `/model` 화면). effort 는 세션 안에서 `/effort high` 처럼 **그것만 한 줄로** 친다. 환경 변수 `CLAUDE_CODE_EFFORT_LEVEL` 이 있으면 그것이 이긴다(이 계정은 `~/.bashrc` 에 `max` — 2026-10-15).
- 처음 열 때 "외부 파일 가져오기" 승인 창이 뜨면 승인한다 — `CLAUDE.md` 가 Learn 루트 규칙(`/data/projects/Learn/CLAUDE.md`)을 가져온다.
- 이 VM 에는 tmux·screen 이 없다(2026-10-14). 백그라운드 세션이 SSH 를 끊었다 다시 붙어도 이어지는지는 처음 쓸 때 확인한다.
- 다음 사람(또는 다른 계정)이 이어받을 사실은 메모리가 아니라 이 저장소의 `history/`·문서에 남는다 — 착수 뒤 CLAUDE.md 0-1절이 읽는 순서를 정한다.

## 3. GitHub

`https://github.com/hipiboy7/MyLearner` (private). 이 VM 계정의 `gh` 로그인(저장소 주인)으로 HTTPS push 가 된다. 이 서버의 시스템 git 설정이 `https://github.com/` 를 SSH 로 바꾸므로, 이 저장소에만 더 긴 접두사의 규칙을 두어 HTTPS 로 남긴다(2026-10-14 이 방법으로 첫 커밋을 push 했다).

```bash
# 이 폴더에는 이미 되어 있다 — 새로 받은 사본에서만(같은 VM 계정)
git -c url.https://github.com/hipiboy7/.insteadOf=https://github.com/hipiboy7/ -c credential.helper='!gh auth git-credential' clone https://github.com/hipiboy7/MyLearner.git
cd MyLearner
git config url.https://github.com/hipiboy7/.insteadOf https://github.com/hipiboy7/   # 시스템의 SSH 바꿔치기보다 긴 접두사 — HTTPS 로 남는다
git config credential.helper '!gh auth git-credential'                                  # 이 VM 계정의 gh 로그인으로 인증
git push                         # push 는 사용자 확인 뒤
```

## 4. 문서

| 문서 | 무엇 |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | 에이전트 작업 규칙(세션마다 자동으로 읽힌다) |
| [`docs/BRIEF.md`](docs/BRIEF.md) | 기획 원문 — 고치지 않는다 |
| [`docs/scope-definition.md`](docs/scope-definition.md) | 범위·완성의 정의(S1~S7)·Phase 로드맵·BRIEF 와 달라진 것 |
| [`docs/P1_인터뷰결과서_Scope.md`](docs/P1_인터뷰결과서_Scope.md) | 착수 인터뷰 문답과 진행 방식 결정 |
| [`docs/설계서_Architecture.md`](docs/설계서_Architecture.md) | 전체 골격·모듈·테스트 배치·화면 기준(계속 고친다) |
| [`docs/P1_요구사항정의서_Probe.md`](docs/P1_요구사항정의서_Probe.md) | Phase 1 요구사항(FR-101~169) |
| [`docs/P1_설계서_Probe.md`](docs/P1_설계서_Probe.md) | Phase 1 설계 — 결과 코드 v1, 점검 흐름, 검증 도구 |
| [`docs/P1_테스트결과서_Probe.md`](docs/P1_테스트결과서_Probe.md) | Phase 1 실행 증거·커버리지·자체 점검 |
| [`docs/P1_체크리스트_Probe.md`](docs/P1_체크리스트_Probe.md) | 폐쇄망에서 사용자가 따라 하는 순서와 피드백 칸 |
| [`docs/트러블슈팅.md`](docs/트러블슈팅.md) | 겪은 문제와 조치 |
| `history/` | 세션마다 종료 상태와 다음 단계 |
