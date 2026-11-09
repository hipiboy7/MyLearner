# P3 설계서 — PC 에서 배우기 (화면 · 로컬 서버 · 저장 어댑터 · 통계 · `.tgz` · 가져오기)

- 작성 2026-11-09 / 대응 요구사항: [`P3_요구사항정의서_PC.md`](P3_요구사항정의서_PC.md) FR-301~364, NFR-301~306 / 상위 문서: [`설계서_Architecture.md`](설계서_Architecture.md), [`P2_설계서_Core.md`](P2_설계서_Core.md)
- 코드: `web/`(index.html·boot.js·config.js·styles.css·app/·store/·core/ 더하기), `mylearner/`(server.py·storage.py·__main__.py·convert/learn.py), `config/editions/`, `scripts/pack_app.py`·`scripts/app_smoke.py` / 시험: `tests/unit/js/`, `tests/unit/py/`, `tests/integration/py/`, `tests/ui/`
- 정정 이력: 2026-11-09 — 독립 점검(테스트결과서 5.2절)을 받아 3.2절(읽기 전용 탭·탭 키·`navigator.locks`·서버 모드 기기 ID·64 KiB)·3.3절(세션 쿠키·한 번 쓰는 주소·잠금·권한·시한·fail-closed·`/api/log` 범위)을 고쳤다
- 옮겨 온 코드의 출처: MWL `e55b9c0` 의 `web/app.js`(라우터·화면 골격·차트·날짜 넘김), `web/styles.css`(토큰), `web/index.html`(껍데기), `mwl/web/server.py`(정적 파일·토큰 쿠키), `web/engine.js` 의 점검 절(`checkBank`·`sampleIds`·`gradeCheck`·`wrongNotes`)

## 1. 데이터 흐름

```
[개발 VM]  MWL content/ ─ convert.mwl ─┐                     ┌─ config/editions/<판>.json ─▶ web/config.js
           Learn <프로젝트>/content/ ─ convert.learn ─┴─▶ 과정 파일 ─ pack_app.py ─▶ web/data/courses/<id>.js + manifest.js
                                                                         └─▶ dist/mylearner-<판>-v<판>.tgz (+ .zip)
[PC 브라우저]
 boot.js(화면 설정) → config.js → core/*.js → store/*.js → manifest.js → courses/*.js(묶음 과정) → app/*.js
 app: 과정 싣기(validate) + 사용자 과정(저장소) ─┐
      저장소.loadLog() → log.merge → 사건 ─────┼─▶ replay.run(today) ─▶ 상태 ─▶ plan · mastery · stats · checkup · markdown ─▶ 화면
      화면의 행동 → log.make(dev, seq, t, day) → 저장소.append(줄) ─┘ (메모리 사건에도 더하고 다시 계산)
 저장소 = 서버 모드(fetch /api/… → data/log.jsonl) | 브라우저 모드(localStorage mylearner.log.YYYY-MM + IndexedDB)
```

- 상태는 늘 사건에서 다시 계산한다(P2 설계서 1절). 사건 5,000줄 다시 계산은 수 ms 라 캐시를 두지 않는다 — '하루 스냅숏'은 기록 파일 전체의 하루 백업으로 둔다(FR-324)

## 2. 모듈 구성

| 파일 | 책임 | 등급 | 출처 |
|---|---|---|---|
| `web/index.html` | 껍데기(메뉴 세 묶음·본문·띠·발), CSP·no-referrer 메타, 스크립트 싣는 순서 | C | MWL `index.html` |
| `web/boot.js` | 그리기 전에 화면 설정 적용(인라인 스크립트를 쓰지 않으려고 파일로) | C | MWL 머리 스크립트 |
| `web/config.js` | 판 설정 `MyLearnerConfig`(묶을 때 `config/editions/<판>.json` 에서 만든다. 저장소의 것은 개발용 = 인터넷판) | C | 새로 |
| `web/styles.css` | 색·글꼴·간격 토큰 한 곳 + 컴포넌트 | C | MWL `styles.css` |
| `web/core/checkup.js` | 점검 문항 은행·뽑기·채점·오답노트(과정 목차로 영역) | A | MWL `engine.js` 점검 절 |
| `web/core/stats.js` | 통계 ①~⑥ 계산(`overview`·`trend`·`cardStates`·`weak`·`checkCompare`) + 옛 `summary` | A | MWL + 새로 |
| `web/core/markdown.js` | (더하기) `allowLink(href)` 선택 인자 — 안전 검사를 통과한 링크를 판 설정이 더 막을 수 있다 | A | P2 |
| `web/store/common.js` | 순수 부분: 달 키, 줄 합집합, 임대 판정, 백업 이름·남길 것 고르기, 바이트 셈 | A | 새로 |
| `web/store/browser.js` | 브라우저 어댑터 — localStorage(달별 키)·KV(IndexedDB)를 주입받는다 | B | 새로 |
| `web/store/idb.js` | IndexedDB 를 작은 KV(`get`·`put`·`keys`·`del`)로 감싼다 | C(Chromium 스모크) | 새로 |
| `web/store/server.js` | 서버 어댑터 — `/api/…` 호출 | B | MWL `ApiStore` |
| `web/app/util.js` | `esc`·DOM 도우미·띠·차트 SVG(막대·쌓은 막대) | C | MWL |
| `web/app/state.js` | 앱 상태: 과정 싣기, 저장소 고르기, 사건 → 상태, 사건 만들기·저장(임대·실패 재시도), 날짜 넘김 | C | MWL `App`·`persist`·`checkDay` |
| `web/app/views.js` | 화면: 오늘·복습·강의·실습·드릴·퀴즈·점검·기록·오답·과정·지도·용어·회고 | C | MWL 화면들 |
| `web/app/stats_view.js` | 통계 화면 ①~⑥ | C | MWL `viewStats` + 새로 |
| `web/app/settings_view.js` | 설정·기록(저장 위치·백업·내려받기)·MWL 진도 들여오기 | C | MWL `viewSettings` + 새로 |
| `web/app/main.js` | 라우터·행동 묶기·키보드·시작 | C | MWL `route`·`bind`·`init` |
| `mylearner/__main__.py` | CLI `python -m mylearner serve` | B | MWL `serve.py` |
| `mylearner/server.py` | HTTP 서버(정적·API·토큰·보안 헤더) | B | MWL `web/server.py` |
| `mylearner/storage.py` | 데이터 폴더: 기록 파일(합집합·원자적 쓰기)·기기 ID·토큰·사용자 과정·백업 | B(순수 함수는 A) | 새로 |
| `mylearner/convert/learn.py` | Learn 콘텐츠 표준 v0 → 과정 파일, CLI | B | 새로 |
| `config/editions/closed.json`·`internet.json` | 판 설정 | — | 새로 |
| `scripts/pack_app.py` | 과정 자료 JS 로 감싸기 + 반입 묶음(재현·외부 URL 검사) | B | P1 `pack_probe.py` |
| `scripts/app_smoke.py` + `tests/ui/app_check.js`·`a11y.js` | 화면 스모크(Chromium, `file://`·서버 모드, 다시 연 뒤 남음)·접근성·스크린샷 | C | P2 `render_smoke.py` |

싣는 순서(index.html): `boot.js` → `config.js` → core 14개(P2 순서) + `checkup.js` → `store/common.js`·`idb.js`·`browser.js`·`server.js` → `data/manifest.js` → (manifest 가 적은 과정 파일을 `app/state.js` 가 동적 `<script>` 로) → `app/util.js`·`state.js`·`views.js`·`stats_view.js`·`settings_view.js`·`main.js`.

## 3. 인터페이스

### 3.1 판 설정 (FR-302)

```json
{"edition": "closed", "label": "폐쇄망판", "export": false, "link_hosts": [], "server": {"port": 8770},
 "stats_scope": "폐쇄망 안의 기록과 들여온 기록", "ai_presets": []}
```

- `link_hosts`: 강의 링크가 될 수 있는 호스트(정확히 같거나 `*.도메인`). `[]` 이면 외부 링크는 모두 글. 인터넷판은 `["*"]`(모두)
- `export`: 기록 파일·백업 내려받기 단추와 서버 내려받기 API
- `ai_presets`: Phase 6 자리. 폐쇄망판은 늘 비어야 한다(묶음 검사)

### 3.2 저장 어댑터 (FR-320~327)

```
store.kind                      'server' | 'browser'           (이름 표시만)
store.init()            → Promise<{dev, where}>               기기 ID 를 정하고(없으면 만든다) 저장 위치 글
store.loadLog()         → Promise<string[]>                   기록의 모든 줄(해석 전 — 화면이 log.merge)
store.append(lines)     → Promise<{added}>                    합집합으로 덧붙인다. 실패하면 던진다(호출부가 다시 보낸다)
store.loadCourses()     → Promise<course[]>                   사용자 과정
store.saveCourse(c)     → Promise<void>
store.backup(reason)    → Promise<{name}>                     기록 파일 전체 사본. reason: 'import-mwl' | 'daily'
store.listBackups()     → Promise<[{name, at, bytes, reason}]>
store.backupText(name)  → Promise<string>                     (판 설정 export 일 때만 화면이 부른다)
store.usage()           → Promise<{bytes, keys}|null>         브라우저 모드 쓴 양(통계 아래)
```

| | 서버 모드(`store/server.js` → `mylearner/storage.py`) | 브라우저 모드(`store/browser.js`) |
|---|---|---|
| 기록 | `data/log.jsonl` — 머리 + 줄. 덧붙이기 = (있던 줄 순서 그대로) + (없던 줄), 임시 파일에 쓰고 `os.replace` | `mylearner.log.YYYY-MM`(그 달 학습일의 줄, `\n` 으로 이음), 해석하지 못한 줄은 `mylearner.log.raw`. 덧붙이기 = 그 키를 다시 읽어 합집합 후 쓰기 |
| 기기 ID | `data/device.json` `{"dev": …}` | `mylearner.device` |
| 순번 | 화면이 `log.nextSeq(모든 사건, dev)` | 같음 + `mylearner.seq`(쓴 가장 큰 순번 — 달 키를 잃어도 순번을 다시 쓰지 않게, F12) 와 큰 쪽 |
| 사용자 과정 | `data/courses/<id>.json` | IndexedDB `courses` |
| 백업 | `data/backups/<UTC 시각>-<reason>.jsonl`. 하루 백업은 서버가 그날 첫 덧붙이기 전에 만든다 | IndexedDB `backups`. 하루 백업은 그 기기의 학습일 첫 덧붙이기 전에 |
| 남길 백업 | `import-*` 최근 20개, `daily` 최근 14개(`store/common.js` `pruneBackups` · `storage.py` `prune_backups` 같은 규칙) | 같음 |

- 백업 글 = `log.writeFile(log.merge([줄]))`(정해진 순서) — 서버는 줄을 해석하지 않으므로 머리 + 있던 줄 그대로를 복사한다(합치면 같은 모음)
- 줄 검사(서버): 문자열, 1~65,536 바이트, `\n`·`\r` 없음. 그 밖의 해석은 화면(`log.merge`)이 한다 — 서버는 줄을 바꾸지 않는다(같은 줄 = 같은 글)

**쓰는 탭 임대(FR-325)** — `localStorage['mylearner.writer'] = {"id": <탭 ID>, "at": <ms>}`

| 상황(`store/common.js` `lease(rec, me, now)`) | 결과 |
|---|---|
| 기록 없음 · `now - at > 6000` · `id == me` | `mine` — 쓴다(내 것으로 다시 적음) |
| 다른 탭이 6초 안에 적음 | `other` — 읽기만. 띠 '다른 탭에서 쓰고 있습니다 [이 탭에서 쓰기]' |

- 쓰는 탭은 2초마다 `at` 을 새로 적고 닫을 때(`pagehide`) 지운다. 읽기 전용 탭은 기록하는 단추를 누르기 전에 막고 사건을 만들지 않는다(같은 순번을 받지 않게 — 독립 점검 S1). '이 탭에서 쓰기'·임대가 끝남은 저장소를 다시 읽은 뒤 쓰는 탭이 된다. 다른 탭이 쓴 줄은 `storage` 이벤트로 받아 다시 계산한다. 6초 넘게 미래인 임대 기록도 오래된 것으로 본다(S13)
- 저장 못 한 줄은 메모리와 탭 키 `mylearner.pending.<탭 ID>` 에 둔다. 쓰는 탭이 되면(시작·넘겨받기) 다른 탭 키의 줄을 모아 보내고 지운다(S8). 저장 못 한 것이 있으면 `beforeunload` 로 묻는다
- 달 키 읽기-합치기-쓰기는 `navigator.locks.request('mylearner.log')` 안에서 한다 — 임대가 새는 틈의 경쟁(S11). 64 KiB(UTF-8)를 넘는 사건은 만들지 않는다(S3)
- 서버 모드의 기기 ID = 서버 기기 + `-` + 브라우저마다 6자리(`mylearner.browser`) — 임대는 한 브라우저 안에서만 통하므로 브라우저 둘이 같은 순번을 쓰지 않게(S9)
- 서버 모드도 같은 임대를 쓴다(같은 기기 ID 의 순번이 겹치지 않게). 겹쳐도 서버는 합집합이라 줄은 잃지 않는다

### 3.3 로컬 서버 (FR-330~335)

| 경로 | 방식 | 요청 → 응답 |
|---|---|---|
| `/` · 정적 | GET | `web/` 안 파일. 경로 밖·`.` 으로 시작하는 이름 404. 형식 표: html·js·css·json·svg·png·ico·txt |
| `/api/health` | GET | `{ok, app: "mylearner", version, edition}` |
| `/api/device` | GET | `{dev, where}` — `where` 는 '데이터 폴더의 log.jsonl' 같은 글(절대 경로를 보내지 않는다) |
| `/api/log` | GET | 기록 파일 글(`text/plain; charset=utf-8`) |
| `/api/log` | POST | `{"lines": [...]}` → `{ok, added, total}` |
| `/api/courses` | GET | `{"courses": [...]}` |
| `/api/courses/<id>` | PUT | 과정 JSON(머리 `format` 이 `mylearner-course`, `id` 가 주소와 같음) → `{ok}` |
| `/api/backups` | GET · POST | 목록 · `{"reason": "import-mwl"}` → `{ok, name}` |
| `/api/backups/<이름>` | GET | 백업 글 — 판 설정 `export` 가 참일 때만, 아니면 404 |

- 토큰: `data/token`(32바이트 16진, 처음 켤 때 만든다, 0600). `GET /?token=…` 또는 `GET /?once=…`(켤 때 브라우저에 준 한 번 쓰는 값 — 120초·한 번, 브라우저 명령줄에 토큰을 싣지 않는다, V2) → 302 + `Set-Cookie: mylearner_<포트>=<세션>; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`. 세션은 서버를 켤 때마다 새로 만든다 — 127.0.0.1 쿠키는 포트를 가리지 않고 다른 서버에도 가므로 토큰을 싣지 않는다. 비교는 `hmac.compare_digest`. 명령줄 도구는 헤더 `X-MyLearner-Token`(토큰)
- 데이터 폴더: 0700, 파일은 처음부터 0600(임시 파일도), 서버 하나만(`data/.lock` 잠금 — 둘째 서버는 이유를 찍고 끝남, S4). 판 설정을 못 찾으면 `export: false`·`link_hosts: []` 로 켠다(fail-closed, V1)
- 시한·한도: 소켓 30초, 거부할 요청은 본문 64 KB 까지만 읽고 닫는다(V5), 처리 못 한 입력은 400·404(V6), 이름·ID 는 `fullmatch`, JSON 의 NaN·Infinity 거부(V7)
- `GET /api/log` 는 화면이 기록을 읽는 길이라 폐쇄망판에서도 열려 있다(토큰 필요, V8). 폐쇄망판이 막는 것은 백업 내려받기 API 와 화면의 내보내기 단추다
- 거부 순서: `Host` 검사(400) → 토큰(401, 화면은 안내 페이지) → 쓰기 요청의 `Content-Type`·`Origin`(403) → 한도(413·400)
- 헤더(모든 응답): `Content-Security-Policy`(4절과 같은 글), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `X-Frame-Options: DENY`
- 동시성: 저장은 프로세스 안 잠금 하나로 줄 세운다(`ThreadingHTTPServer`)
- 출력: 켤 때 `MyLearner <판> - http://127.0.0.1:<포트>/?token=<토큰>` 과 데이터 폴더. cp949 로 나타낼 수 있는 글자만

### 3.4 화면 주소 (해시 라우터)

| 주소 | 화면 | 상태를 바꾸나 |
|---|---|---|
| `#/today` | 오늘 | 아니오 |
| `#/review` | 복습 | 등급·보류 단추로만 |
| `#/learn/<과정>/<강의>` | 강의 | 자신감 단추로만 |
| `#/lab/<과정>/<실습>` · `#/drill/<과정>/<드릴>` · `#/quiz/<과정>/<퀴즈>` | 실습·드릴·퀴즈 | 제출 단추로만 |
| `#/check[/<과정>]` · `#/check/<과정>/run` | 점검 · 문항(시작 단추를 눌렀을 때만 — 주소만으로 열면 점검 첫 화면) | 제출로만 |
| `#/checks[/<번호>]` · `#/wrong` | 점검 기록 · 오답노트 | 아니오 |
| `#/courses` · `#/map/<과정>[/<영역>]` | 과정 목록 · 지도 | 주 과정·보류 풀기 단추로만 |
| `#/stats[/<과정>]` · `#/glossary[/<과정>]` · `#/journal` | 통계 · 용어 · 회고 | 회고 저장 단추로만 |
| `#/settings` · `#/import/mwl` | 설정 · MWL 진도 들여오기 | 저장·들여오기 단추 + 확인으로만 |

- MWL 렌더 결과의 강의 참조 `#/learn/<강의>` 는 P2 렌더러가 `lessonRef` 로 `#/learn/<과정>/<강의>` 를 만든다(135과 대조와 같은 규칙)
- 강의 본문의 `#/…` 링크(과정 파일이 쓴 것)는 위 표의 화면으로만 간다 — 어느 주소도 그 자체로 기록을 바꾸지 않는다(P2 설계서 7절)

### 3.5 사건 만들기 (화면 → 기록)

| 행동 | 사건(P2 설계서 3.3절) | 학습 시간(`session`) |
|---|---|---|
| 복습 등급 | `review {course, card, grade}` | 큐를 다 돌면 `ceil(장 × 15초 / 60)` 분, `reviewed` = 장 |
| 보류 · 풀기 | `card.hold {course, card, on, why: "wrong"}` | — |
| 강의 마침 | `lesson {course, lesson, done: true, confidence}` | 강의 `minutes` |
| 실습 | `lab {course, lab, done: true, score, total, notes}` | 실습 `minutes` |
| 드릴 저장 | `drill {course, drill, score, max, path}` | 드릴 `minutes` |
| 퀴즈 | `quiz {course, quiz, score, answers}` | 10분 |
| 점검 | `check {course, mode, scores, total, items}` | — |
| 회고 | `journal {course: 주 과정, summary, apply, unclear, teach}` | 5분 |
| 설정 저장 | 바뀐 키마다 `setting {key, value}` — `weekday_minutes`·`weekend_minutes`·`weekend_review_only`·`max_reviews_per_day`·`new_cards_per_day`·`study_days`·`main_course`·`day_start_hour`·`plan_variants.<과정>` | — |

- 봉투: `dev` = `store.init()` 의 기기 ID, `seq` = 3.2절 순번, `{t, day}` = `log.stamp(new Date(), day_start_hour)`
- 설정 읽기: `replay` 의 `settings`(나중 것이 이긴다)를 `PLAN_DEFAULTS` 위에 얹고, `plan_variants.<과정>` 키는 `plan_variants` 표로 모은다

### 3.6 점검 — `web/core/checkup.js` (FR-316)

| 함수 | 입력 → 출력 |
|---|---|
| `bank(course)` | 점검 문항(`diagnostic`, ID 그대로) + 퀴즈 문항(`<퀴즈>:<문항>`) → `{id: item}`(자기 키만 있는 표) |
| `partOf(course, item)` | 문항의 `lesson` → 단원 → 영역 ID. 찾지 못하면 `"?"` |
| `baselineIds(course)` | 점검 문항 ID 목록(순서 그대로) |
| `sampleIds(course, bank, per, parts, rnd)` | 영역마다 섞어 `per` 개(MWL `sampleIds` 와 같은 피셔–예이츠, 영역은 `partOf`) |
| `gradeCheck(course, bank, ids, answers)` | `{scores: {영역: 0~100}, total, items: [{id, answer, correct}]}` — 반올림은 MWL 과 같은 0.5 올림 |
| `detail(check, bank)` | 기록 한 건의 문항별 줄(지금 은행에 없는 문항은 뺀다) |
| `wrongNotes(course, st, bank)` | 그 과정의 퀴즈·점검 시도 → `[{id, wrong, attempts, last_wrong_at, last_answer, resolved}]`(MWL 정렬: 못 고친 것 → 틀린 횟수 많은 것 → 최근 → ID) |
| `retryIds(notes, limit)` | 못 고친 것 앞에서 `limit` 개 |

### 3.7 통계 — `web/core/stats.js` (FR-340~347)

`filter` = 과정 ID 목록(없으면 전체). 계산은 모두 `replay` 상태와 과정 파일에서만 한다.

| 함수 | 결과 |
|---|---|
| `overview(courses, st, today, settings)` | `{today_minutes, today_goal, week_minutes, week_goal, streak, due7: [{date, count}]}` — 이번 주 = 월~일, 목표는 공부 요일 `weekday_minutes`·아닌 날 `weekend_minutes`. `due7[0]` 은 밀린 것까지(보류·과정 파일에 없는 카드 제외) |
| `trend(st, today, days, filter)` | `{daily: [{date, reviews, good, accuracy}], weekly: [{week_start, reviews, accuracy}]}` — `st.reviews` 전부(이른 복습도 복습한 사실이다), `accuracy` = good 이상 / 복습 수, 없으면 `null` |
| `cardStates(courses, st, filter)` | `{new, learning, settled, held, total, settle_rate}` — 과정 파일의 카드만. 정착 = grades 3개 이상 + 최근 3개 모두 good 이상, `settle_rate` = 본 카드의 `srs.retention` 평균 |
| `progress(courses, st, filter)` | 과정마다 `{lessons_done, lessons_total, parts: mastery.summary}` |
| `weak(courses, st, filter, nCards, nUnits)` | `{cards: [{course, card, lesson, again, reviews}], units: [{course, unit, title, again, retention}]}` — again 수 많은 순 → ID |
| `checkCompare(st, course)` | `{first, latest}` — 그 과정의 첫·가장 최근 기준선(`mode` baseline)의 영역 점수. 하나뿐이면 `latest` 는 `null` |

### 3.8 Learn 변환 — `mylearner/convert/learn.py` (FR-350~352)

| Learn | 과정 파일 |
|---|---|
| `content/index.md` 머리 `project`·`title`·`area`·`confidence`·`base` | `id` = `project`, `title`, `confidence`, `origin {type: "learn", ref: "<project>@<Learn 프로젝트 커밋 7자리>", hash}`. `area: kids` 면 오류로 끝낸다 |
| 장 = `content/` 바로 아래 `NN-이름.md` 또는 `NN-이름/` 폴더 | 영역 하나(`main`, 제목 = 과정 제목) 아래 단원 하나씩(ID = `NN-이름`, 제목 = 그 장 첫 페이지 `title`) |
| 페이지(`.md`, `index.md`·`glossary.md` 제외) | 강의 — ID = 경로에서 `.md` 를 떼고 `/` 를 `.`(예 `04-usage.01-command`), `title`·`level`(L 숫자)·`confidence`·`sources`, `minutes` = 글자 수 / 400(5~60), `body` = 변환한 본문 |
| `content/cards/*.json` 의 카드 | `cards[id]`(ID 그대로), `lesson` = `source` 의 페이지 경로 → 강의 ID, `type: "concept"` |
| `glossary.md` 의 표(용어·뜻 칸) | `glossary[]`(ID `T-001`… — 기록이 가리키지 않는다) |

확장 문법 → 렌더러 문법(FR-351):

| Learn | 바꾼 꼴 |
|---|---|
| `!!! note "제목"` + 들여쓴 본문 | `> **제목**` + `> 본문`(인용) |
| `??? question "질문"` + 들여쓴 답 | `**질문**` + 다음 줄부터 `> 답`(인용) |
| `=== "Windows"` + 들여쓴 본문 | `**Windows**` + 들여쓰기를 뗀 본문 |
| 각주 `[^1]` · `[^1]: 글` | `(주 1)` · 끝의 `## 주` 절 아래 `1. 글` |
| ```` ```mermaid ```` | 그대로 코드 블록(그림 대신 원문) |
| `[글](02-architecture.md#앵커)`(같은 프로젝트 페이지) | `[글](#/learn/<과정>/02-architecture)` |
| 앞의 YAML 머리 | 떼어 낸다(값은 위 표로) |

### 3.9 묶음 — `scripts/pack_app.py` (FR-353·354)

```
mylearner-<판>-v<판번호>/
  README_KO.txt  MyLearner.cmd  config.json(서버가 읽는 판 설정 — 포트 등)
  mylearner/  __init__.py __main__.py constants.py server.py storage.py     (convert/ 는 싣지 않는다)
  web/  index.html boot.js config.js styles.css app/ core/ store/ data/manifest.js data/courses/<id>.js
```

- 과정 자료 JS: `MyLearner.courseData = MyLearner.courseData || []; MyLearner.courseData.push(<JSON>);` — JSON 은 `sort_keys`·`ensure_ascii=False`, U+2028·U+2029 는 ` `·` ` 로. manifest: `{courses: [{id, file, bytes, sha256}]}`
- 넣는 과정: `--courses` 로 고른 과정 파일들(기본: `dist/courses/*.course.json`). 개발 중 화면은 `python3 scripts/pack_app.py --web-data` 로 `web/data/` 만 만든다(커밋하지 않음)
- 재현: 이름순, mtime 고정, uid/gid 0, USTAR, gzip 이름·시각 없음 — ZIP 은 시각 고정·`ZIP_DEFLATED`
- 검사: 두 번 만들어 같은 바이트. 폐쇄망판 — 앱 파일(과정 자료 밖)에 외부 URL 0(P1 `external_urls` 규칙), `config.js` 의 `export` 거짓·`link_hosts` 빔·`ai_presets` 빔. 과정 자료의 외부 주소는 호스트별 개수를 찍는다

## 4. CSP

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self';
object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

- `index.html` 의 `<meta http-equiv>` 와 서버 헤더가 같은 글이다(메타에서는 `frame-ancestors` 가 무시된다). 헤드리스 Chromium 153 `file://` 에서 확인(2026-11-09): 같은 폴더 스크립트(정적·동적 `<script>`)·스타일시트·localStorage·IndexedDB 는 되고, 인라인 `style` 속성만 막힌다(`style-src-attr`) — 그래서 진행 막대 폭 같은 값은 그린 뒤 `el.style.width`(CSSOM)로 넣는다(`data-pct`)

## 5. 화면 (MWL 골격에서 바꾼 것)

| 화면 | MWL 과 같은 것 | 바꾼 것 |
|---|---|---|
| 껍데기 | 메뉴 세 묶음(학습·기록·참고), 띠, 발, 밝기 단추, 건너뛰기 링크 | 메뉴: 학습(오늘·복습·점검·오답노트) / 기록(통계·회고·과정) / 참고(용어·설정). 판 이름 배지 |
| 오늘 | 순서 목록, 다음 할 일 하나만 기본 단추, 목표 막대, 오늘 한 것 | 단계마다 과정 이름, 여러 과정 합친 복습 |
| 복습 | Space·1~4, 진행 막대, 결과 타일 | 카드의 과정·강의 링크, '틀렸다 → 보류' |
| 강의 | 리더 + 목차, 자신감 1~4 | 렌더러는 core `markdown.render`, 외부 링크는 판 설정 |
| 점검·기록·오답 | 같은 흐름 | 과정 고르기, 영역 = 목차 |
| 통계 | 타일·막대 차트 규칙 | ①~⑥ 절(3.7), 과정 고르기, 범위 글, 쌓은 막대(카드 상태 — 칸마다 이름·수를 글로) |
| 설정 | 화면·학습 설정 | 학습 설정은 `setting` 사건, 기록 절(저장 위치·쓴 양·백업 목록·내려받기(인터넷판)), MWL 들여오기 입구 |
| 빠진 것 | 내 지식 편집기·AI 연결 | Phase 5·6 |

## 6. 요구사항 → 코드 · 시험

| FR | 코드 | 시험 |
|---|---|---|
| 301·304·305 | `web/index.html`·`boot.js`·`app/main.js` | `app_smoke.py`(`file://`·서버, CSP 위반 0, 화면 오류 0) |
| 302·353·354 | `config/editions/*.json`, `scripts/pack_app.py` | `test_pack_app.py`, 전체 검증 묶음 단계 |
| 303 | `app/state.js` | `app_smoke.py`(잘못된 과정 자료를 넣은 단계) |
| 306·325·326 | `app/state.js`, `store/common.js` | `store.test.js`(임대·합집합), `app_smoke.py`(탭 둘) |
| 307 | `boot.js`·`app/util.js` | `app_smoke.py` |
| 310~319 | `app/views.js` | `app_smoke.py`(흐름) |
| 312 | `core/markdown.js` `allowLink` | `markdown.test.js` |
| 316 | `core/checkup.js` | `checkup.test.js` |
| 320~324·327 | `store/*.js`, `mylearner/storage.py` | `store.test.js`, `test_storage.py`, `app_smoke.py`(다시 연 뒤 남음) |
| 330~335 | `mylearner/server.py`·`__main__.py` | `test_server.py`(실제 서버) |
| 340~347 | `core/stats.js`, `app/stats_view.js` | `stats.test.js`, 스크린샷 |
| 350~352 | `mylearner/convert/learn.py` | `test_convert_learn.py`, Learn 실데이터(두 프로젝트) |
| 360~364 | `app/settings_view.js` | `app_smoke.py`(만든 MWL 진도 두 번 들여오기 → 사건 수 같음·N/N) |
| NFR-303 | `tests/ui/a11y.js` | `app_smoke.py` |

## 7. 아직 정하지 않은 것

| 무엇 | 언제 |
|---|---|
| 브라우저 저장 방식·한도 확정 | 보류 결정 8 의 결과 코드가 올 때(보류 결정 7 잠정) |
| 다른 기기 기록 합치기(미리보기·되돌리기), 백업에서 되살리기 | Phase 4 |
| 안드로이드 저장 어댑터(같은 인터페이스) | Phase 4 |
| 사용자 과정 고르기·편집, 과정 항목 수정 합치기 | Phase 5 |
| `ai_presets` 채우기 | Phase 6 |
