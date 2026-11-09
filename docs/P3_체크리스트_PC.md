# P3 체크리스트 — PC 에서 배우기 (써 보기)

- 작성 2026-11-09 / 대응: [`P3_테스트결과서_PC.md`](P3_테스트결과서_PC.md), [`P3_설계서_PC.md`](P3_설계서_PC.md)
- 순서대로 하고 칸마다 "하면 → 보여야 할 것"을 확인한다. 1 은 이 VM(MyLearner 저장소 `/data/projects/MyLearner`, 브랜치 `impl-phase3`), 2~3 은 내 PC(Windows · Chrome), 4 는 폐쇄망 PC 에서 한다
- 1 의 명령은 이 VM 에서 적은 그대로 실행해 확인했다(2026-11-09). 2~4 의 Windows 쪽(`MyLearner.cmd`·`py -3`·실제 Chrome)은 **미실행**이다 — 이 VM 의 Linux·헤드리스 Chromium 153 으로 같은 흐름을 확인했다(테스트결과서 1.4·8절)

## 1. 묶음 만들기 (이 VM)

- [ ] 하면: `python3 scripts/check_mwl_real.py --out dist/courses/mwl.course.json`
  → 보여야 할 것: 마지막 쪽에 `과정 검사: 오류 0 · 경고 0`, `렌더 일치: 강의 135/135 …`
- [ ] 하면: `python3 -m mylearner.convert.learn /data/projects/Learn/mwm-app --out dist/courses/mwm-app.course.json`
  → 보여야 할 것: `과정 mwm-app: 강의 45 · 카드 372 · 실습 0 · 드릴 0 · 퀴즈 0 · 용어 433 · 진단 0`
- [ ] 하면: `python3 -m mylearner.convert.learn /data/projects/Learn/llm-chat-agent --out dist/courses/llm-chat-agent.course.json`
  → 보여야 할 것: `과정 llm-chat-agent: 강의 9 · 카드 128 …`
- [ ] (경계 규칙) 하면: `python3 -m mylearner.convert.learn /data/projects/Learn/kids --out dist/kids.course.json`
  → 보여야 할 것: `변환하지 못했다: area: kids 자료는 가져오지 않는다(Learn 경계 규칙 2절)` 그리고 `dist/kids.course.json` 이 생기지 않는다
- [ ] 하면: `python3 scripts/pack_app.py --check`
  → 보여야 할 것: 마지막 줄 `두 판 모두 두 번 만들어 같음 · 폐쇄망판 앱 파일 외부 URL 0 · 내보내기 꺼짐 · 외부 AI 프리셋 없음`. 그 위 두 줄에 과정 3개와 '과정 자료 안 외부 주소 N종'(강의 글 속 문서 주소 — 폐쇄망판은 링크로 만들지 않는다)
- [ ] 하면: `python3 scripts/pack_app.py --edition closed` 와 `python3 scripts/pack_app.py --edition internet`
  → 보여야 할 것: `만듦: …/dist/mylearner-closed-v0.3.0.tgz`, `만듦: …/dist/mylearner-internet-v0.3.0.tgz`, `만듦: …/dist/mylearner-internet-v0.3.0.zip`
- [ ] (시간이 되면) 하면: `bash scripts/verify.sh` → 보여야 할 것: `전체 통과 (20단계)`. 약 4분

## 2. 내 PC — 서버 모드 (인터넷판)

- [ ] 하면: VM 의 `dist/mylearner-internet-v0.3.0.zip` 을 내 PC 로 옮겨(쓰는 파일 전송 방법으로) 푼다
  → 보여야 할 것: 폴더 `mylearner-internet-v0.3.0` 안에 `MyLearner.cmd`·`README_KO.txt`·`mylearner`·`web`·`config.json`
- [ ] 하면: `MyLearner.cmd` 를 두 번 누른다
  → 보여야 할 것: 검은 창에 `MyLearner 0.3.0 인터넷판 - http://127.0.0.1:8770/?token=…` 과 `데이터 폴더: …\data`, Chrome 이 열리며 **오늘** 화면. 왼쪽 위 `인터넷판`, 왼쪽 아래 `서버 모드`
- [ ] 하면: **과정** 메뉴 → 보여야 할 것: 미들웨어 과정(135과)·MWM 미들웨어관리소 학습(45과)·llm-chat-agent 학습(9과), 미들웨어 과정 옆 `✓ 주 과정`
- [ ] 하면: **오늘** → '강의 열기' → 끝까지 읽고 자신감 `3 보통`
  → 보여야 할 것: 오늘 화면으로 돌아오고 띠 `… 마침 - 카드 N장이 복습 대기열에 들어갑니다`, '오늘 한 것'에 그 강의, 복습 단계가 `새 카드 N장`
- [ ] 하면: **복습** → `Space` → `3`(알겠음)을 몇 장 → 한 장은 '이 카드가 틀렸다 → 보류'
  → 보여야 할 것: 진행 막대가 늘고, 다 돌면 '복습 완료' 와 정답률. 과정 → 지도 맨 아래 '보류한 카드'에 그 카드
- [ ] 하면: **통계** → 보여야 할 것: 맨 위 범위 `이 기기에 모인 기록(이 기기 + 들여온 기록) · 전체 과정`, ①~⑥ 절, ① 막대에 앞으로 7일 복습 예정, ③ 카드 상태 막대와 이름·수 글
- [ ] 하면: 검은 창에서 `Ctrl+C` 로 끄고 `MyLearner.cmd` 로 다시 켠다
  → 보여야 할 것: 오늘·통계에 앞에서 한 것이 그대로(기록은 `data\log.jsonl`). 설정 → 기록 → 백업 표에 '하루 백업'(둘째 날부터)
- [ ] 하면: 설정 → '기록 파일 내려받기' → 보여야 할 것: `mylearner-log-<오늘>.jsonl` 이 받아진다(인터넷판만 — Phase 4 합치기에 쓴다)

## 3. 내 PC — 더블클릭 (Python 없이)

- [ ] 하면: 같은 폴더의 `web\index.html` 을 Chrome 으로 연다
  → 보여야 할 것: 왼쪽 아래 `브라우저 모드`. 2 의 기록은 보이지 않는다(서버 모드와 다른 기기로 센다 — README_KO.txt 1-나)
- [ ] 하면: 강의 하나를 마치고 Chrome 을 모두 닫았다가 같은 파일을 다시 연다 → 보여야 할 것: 그 강의가 '오늘 한 것'에 남아 있다
- [ ] 하면: 같은 파일을 탭 둘에 연다 → 보여야 할 것: 나중 탭 위에 노란 띠 `다른 탭이 기록을 쓰고 있어 이 탭은 읽기만 합니다` 와 `이 탭에서 쓰기`

## 4. 폐쇄망 PC — 반입 · MWL 진도 들여오기 (폐쇄망판)

- [ ] 하면: `dist/mylearner-closed-v0.3.0.tgz` 를 반입해 `tar -xzf mylearner-closed-v0.3.0.tgz`(안 되면 반디집·7-Zip) → `MyLearner.cmd`
  → 보여야 할 것: 왼쪽 위 `폐쇄망판`. 포트는 8770(MWL 8765 와 함께 켤 수 있다)
- [ ] 하면: 아무 강의에서 문서 주소가 있는 곳을 본다 → 보여야 할 것: 주소가 밑줄 링크가 아니라 글로 보인다. 설정 → '기록 파일 내려받기' 단추가 없다
- [ ] 하면: MWL 에서 설정 → 진도 내보내기(JSON) → MyLearner 과정 → 'MWL 진도 들여오기' → 그 파일 고르기
  → 보여야 할 것: 미리보기 표(바꿀 사건 · 새로 더할 줄 · 메모 강의·카드). 위의 안내에 '들여온 카드 상태는 그 진도의 마지막 복습일까지 … 덮습니다'
- [ ] 하면: '백업하고 들여오기' → 확인
  → 보여야 할 것: `들여왔습니다` 와 **`변환 일치 N / N`**(N = MWL 카드 수 — S5). 과정 화면에 `MWL 내 메모`(MWL 내 지식이 있으면)
- [ ] 하면: 같은 파일을 한 번 더 들여온다 → 보여야 할 것: 미리보기 '새로 더할 줄 0 - 이미 모두 들여왔습니다', 들여와도 사건 수가 그대로
- [ ] 하면: 통계 ⑥ → 보여야 할 것: MWL 에서 잰 기준선이 있으면 '첫 기준선'과 '가장 최근' 점수
- [ ] (보류 결정 8) P1 체크리스트의 브라우저 점검 결과 코드를 함께 전해 주면 저장 방식(보류 결정 7)을 확정한다

## 피드백

| # | 화면·단계 | 본 것 / 바라는 것 |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
