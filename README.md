# MyLearner

내가 넣은 자료로 강의·카드·퀴즈를 만들고 매일 복습해 몸에 익히는 **1인용 학습 플랫폼** — 폐쇄망 PC · 내 PC · 안드로이드 폰.

**지금 상태(2026-10-14): 착수 전.** 이 폴더에는 기획 원문 [`docs/BRIEF.md`](docs/BRIEF.md) 와 이 안내만 있다. 이 폴더에서 Claude Code 세션을 열어 착수한다(아래 1). 이 폴더는 git 저장소이고(작성자·원격 설정 완료), 이 두 파일을 첫 커밋으로 GitHub `hipiboy7/MyLearner`(private)에 올렸다(2026-10-14).

## 1. 첫 세션 — 착수

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
| 마지막 대화를 이어서 | `cd /data/projects/MyLearner && claude --continue` |
| 새로 열고 기록부터 읽게 | `cd /data/projects/MyLearner && claude` → "이어서 하자" |
| 지난 대화 가운데 골라서 | `claude --resume` (목록에서 `mylearner`) |
| SSH 가 끊겨도 계속 돌게 | `claude --bg -n mylearner` 로 띄우고 `claude attach mylearner` 로 붙는다. ← 로 목록, Ctrl+Z 로 셸 — 세션은 계속 돈다 |
| 돌고 있는 세션 보기·끝내기 | `claude agents --cwd /data/projects/MyLearner` · `claude logs mylearner` · `claude stop mylearner` |

- 같은 폴더에서 두 번째 창을 `claude -c` 로 열지 않는다(두 프로세스가 같은 대화 파일에 쓴다). 갈라서 이어 가려면 `claude --resume <세션ID> --fork-session`.
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
