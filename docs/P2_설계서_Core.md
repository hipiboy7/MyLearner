# P2 설계서 — Core (과정·기록 파일 형식 · 사건 기록·합치기 · SM-2 · 렌더러 · MWL 변환)

- 작성 2026-10-15 / 대응 요구사항: [`P2_요구사항정의서_Core.md`](P2_요구사항정의서_Core.md) FR-201~263, NFR-201~205 / 상위 문서: [`설계서_Architecture.md`](설계서_Architecture.md)
- 코드: `web/core/`, `mylearner/`, `scripts/` / 시험: `tests/unit/js/`, `tests/integration/js/`, `tests/unit/py/`, `tests/integration/py/`, `tests/realdata/`, `tests/ui/render_check.html`
- 정정 이력: 2026-11-09 — 독립 점검 ②(렌더러, 테스트결과서 5.2절)를 받아 3.6절에 '시간'을 더했다
- 정정 이력: 2026-10-15 — 독립 점검(기록 합치기, 테스트결과서 5.2절)을 받아 3.3절(해석하지 못한 줄은 글자 그대로·상속 이름 ID·깊은 줄·`session.total`·`setting` 키), 3.4절(규칙 문장·사례 6·한계), 3.8절(가상 기기·순번), 7절을 고쳤다
- 옮겨 온 코드의 출처: MWL `e55b9c0` 의 `web/engine.js`(SM-2·계획·숙련도·통계·채점), `mwl/content/markdown.py`(렌더러), `mwl/content/frontmatter.py`·`loader.py`(변환기의 읽기), hub `8dee3b8` 의 `src/learnhub/engine/events.py`(사건·합치기의 뼈대)

## 1. 데이터 흐름

```
[개발 VM]                                          [브라우저 — Phase 3 화면이 부른다]
 MWL content/ ─ python3 -m mylearner.convert.mwl ─▶ 과정 파일(mwl) ─┐
                                                                   ├─▶ course.validate ─▶ plan · mastery · stats · markdown
 MWL 진도(mwl.progress, 폐쇄망 브라우저) ─ mwl_import ─▶ 사건 줄 + 메모 과정(mwl-notes)
                                                                   │
 화면의 행동(복습·강의 마침 …) ─ log.makeEvent ─▶ 사건 줄 ─────────┤
 다른 기기의 기록 파일 ─ log.readFile ─────────────────────────────┤
                                                                   ▼
                              log.merge(합집합, 정해진 순서) ─▶ replay(늦은 복습 규칙) ─▶ 상태
                                       └─ log.writeFile(같은 모음 = 같은 바이트) ─▶ 기록 파일(내보내기·저장)
```

- 과정은 원본 → 과정 파일 단방향이다. 기록은 사건 줄을 더하기만 하고, 상태는 늘 사건에서 다시 계산한다(저장해 둔 상태는 Phase 3 의 '하루 스냅숏' 캐시일 뿐이다)

## 2. 모듈 구성

| 파일 | 책임 | 등급 | 출처 |
|---|---|---|---|
| `web/core/constants.js` | 도메인 상수(SM-2·등급·숙련도·계획 기본값·형식 이름과 판·ID 규칙·사건 종류). `SHARED` 묶음은 Python 과 같아야 한다 | A | MWL `engine.js` 머리 |
| `web/core/dates.js` | `YYYY-MM-DD` 계산(UTC 기준), 학습일(`day_start_hour`), 요일 | A | MWL |
| `web/core/hash.js` | SHA-256(UTF-8). 보안용이 아니라 같은 입력 → 같은 ID 용 | A | 새로 |
| `web/core/srs.js` | SM-2 `review`·`isDue`·`retention` | A | MWL |
| `web/core/course.js` | 과정 파일 검사(오류·경고 코드), 목차 색인(강의 순서·단원·카드) | A | MWL `models.py` 검사 일반화 |
| `web/core/log.js` | 사건 봉투·정규형·만들기, 기록 파일 읽기·쓰기, 합치기(합집합·순서), 기기 ID, 달로 나누기 | A | hub `events.py` |
| `web/core/replay.js` | 사건 → 상태. 늦은 복습 규칙·미래 사건·시계 이상 | A | hub `replay` + BRIEF 5.3-2 |
| `web/core/plan.js` | 하루 계획(여러 과정 — 인터뷰 1번 A) | A | MWL `buildDailyPlan` |
| `web/core/mastery.js` | 단원 숙련도 L0~L5, 영역 요약 | A | MWL `moduleLevel` |
| `web/core/stats.js` | 연속 학습일·요약(MWL `summary` 이식) | A | MWL |
| `web/core/grade.js` | 퀴즈·실습·드릴 채점 | A | MWL |
| `web/core/markdown.js` | 마크다운 → 안전한 HTML | A | MWL `markdown.py` + XSS 대책 |
| `web/core/mwl_import.js` | MWL 진도(스키마 1·2) → 사건 + 메모 과정, N/N 대조 | A | 새로(BRIEF 5.7) |
| `mylearner/constants.py` | Python 쪽 상수(`SHARED` 와 MWL 과정 정보) | A | — |
| `mylearner/convert/mwl.py` | MWL `content/` → 과정 파일. CLI `python3 -m mylearner.convert.mwl` | B | MWL `frontmatter.py`·`loader.py` |
| `scripts/import_mwl_fixtures.py` | MWL 골든 벡터를 기준 커밋에서 복사·대조(`--check`) | C | — |
| `scripts/check_mwl_real.py` + `tests/realdata/mwl_check.js` | MWL 실데이터 대조(변환 두 번·검사·개수·135과 렌더) | C | — |
| `scripts/check_log_roundtrip.js` | 기록 왕복(S3) 명령 단위 증명 | C | — |
| `scripts/render_smoke.py` + `tests/ui/render_check.html` | 렌더러를 실제 Chromium 에서(XSS 사례·classic script·`file://`) | C | P1 `browser_smoke.py`·`cdp.js` |

브라우저에서 싣는 순서: `constants` → `dates` → `hash` → `srs` → `grade` → `course` → `log` → `replay` → `plan` → `mastery` → `stats` → `markdown` → `mwl_import`(`course` 가 `grade.unsafeRegex` 를 쓴다 — `tests/unit/js/umd.test.js`·`tests/ui/render_check.html` 이 이 순서로 싣는다). 앞 파일이 없으면 `MyLearner.<이름> 을 먼저 싣는다` 오류를 낸다.

## 3. 인터페이스

### 3.1 JS 파일의 꼴 (FR-201)

```js
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var ns = node ? null : (root.MyLearner = root.MyLearner || {});
  function dep(name) { /* Node: require('./name.js'), 브라우저: ns[name] — 없으면 오류 */ }
  var mod = factory(dep);
  if (node) module.exports = mod; else ns.<이름> = mod;
})(typeof self !== 'undefined' ? self : this, function (dep) { 'use strict'; … });
```

### 3.2 과정 파일 v1 (FR-210~212)

```json
{"format": "mylearner-course", "version": 1, "min_reader": 1,
 "id": "mwl", "title": "미들웨어 과정", "kind": "course", "lang": "ko", "confidence": "likely", "readonly": true,
 "origin": {"type": "mwl", "ref": "MiddlewareLearner@e55b9c0", "hash": "<원본 sha256>"},
 "default_plan": "default",
 "parts":   [{"id": "A", "title": "JEUS", "code": "JEUS", "summary": "", "units": [{"id": "A1", "title": "개관", "goal": "", "lessons": ["A1-1"]}]}],
 "lessons": {"A1-1": {"title": "…", "minutes": 20, "level": 1, "prereqs": [], "tags": [], "confidence": "verified", "sources": ["…"], "body": "## 결론 먼저\n…"}},
 "cards":   {"A1-1-c01": {"lesson": "A1-1", "type": "concept", "q": "…", "a": "…", "hint": "", "tags": [], "difficulty": 1}},
 "quizzes": {"QZ-A1": {"unit": "A1", "items": [{"id": "q1", "type": "mcq", "q": "…", "options": ["…"], "answer": "…", "explain": "…", "lesson": "A1-1"}]}},
 "labs":    {"LAB-A1-1": {"title": "…", "tier": "L1", "unit": "A1", "lessons": ["A1-1"], "minutes": 15, "env": "browser", "body": "…", "checks": [{"id": "q1", "q": "…", "type": "choice", "options": [], "answer": "…", "explain": ""}]}},
 "drills":  {"DR-01": {"title": "…", "parts": ["A"], "difficulty": 1, "minutes": 15, "lessons": ["A1-1"], "situation": "…", "start": "s1",
             "steps": {"s1": {"prompt": "…", "options": [{"text": "…", "next": "s2", "score": 10, "feedback": "…"}]}}, "debrief": "…", "max_score": 20}},
 "glossary": [{"id": "T-001", "term": "…", "en": "…", "short": "…", "part": "A", "lesson": "A1-1"}],
 "diagnostic": [{"id": "dg-01", "type": "mcq", "q": "…", "options": ["…"], "answer": "…", "explain": "…", "lesson": "A1-1"}],
 "plans": {"default": {"weeks": [{"week": 1, "theme": "…", "drill": "DR-01", "days": [{"day": 1, "lesson": "A1-1", "lab": null}]}]}}}
```

- 필수: 머리 셋, `id`·`title`·`kind`·`parts`·`lessons`. 나머지 묶음은 없으면 빈 것으로 본다
- `kind: "notes"` = 메모 과정(MWL 내 지식). 강의를 마치지 않아도 카드가 새 카드로 나오고, 새 강의로는 내지 않는다. 강의에 `created`·`updated`·`kind`·`origin`·`source`·`related` 를 더 둘 수 있다
- MWL 에서 바뀐 이름: 도메인 → `parts`(영역), 모듈 → `units`(단원), 실습·퀴즈의 `module` → `unit`, 드릴의 `domains` → `parts`, 용어의 `domain` → `part`. ID 값은 그대로
- 강의의 `minutes`·`prereqs` 는 MWL `curriculum.json`(MWL 계획이 쓰는 값), `title`·`tags`·`level`·`confidence`·`sources`·`body` 는 강의 파일에서 온다(강의 파일의 제목·태그가 더 자세하다 — 135과 중 제목 3·태그 88곳이 다르다, 2026-10-15)
- `version` = 쓴 쪽의 형식 판, `min_reader` = 읽으려면 필요한 가장 낮은 판. 읽는 쪽 판(`READER = 1`) < `min_reader` 면 `E-READER`

검사 코드(FR-211) — `course.validate(obj)` → `{ok, errors: [{code, path, msg}], warnings: […], counts}`(앞의 200개만 담고 수는 모두 센다):

| 코드 | 뜻 |
|---|---|
| `E-FORMAT`·`E-VERSION`·`E-READER` | 머리가 틀림 · 판이 정수가 아님 · 더 새 판이 필요 |
| `E-TYPE`·`E-EMPTY`·`E-ENUM`·`E-RANGE` | 값의 꼴 · 빈 글 · 정해진 값이 아님 · 범위 밖 |
| `E-ID`·`E-DUP`·`E-REF` | ID 규칙 · 중복 · 없는 강의·단원·실습·드릴·단계를 가리킴 |
| `E-ANSWER` | 퀴즈·실습 답이 문항 꼴과 맞지 않음(mcq 답 ∉ 보기, order 답 ≠ 보기의 순열 …) |
| `E-REGEX` | 실습 `regex` 가 컴파일되지 않거나 위험(3.7절) |
| `W-UNKNOWN`·`W-ORPHAN` | 모르는 키(지우지 않는다) · 목차에 없는 강의 |

### 3.3 사건과 기록 파일 v1 (FR-220~227)

사건 봉투 — 모든 사건이 가진다:

| 키 | 꼴 | 뜻 |
|---|---|---|
| `v` | `1` | 사건 판. 1 이 아니면 해석하지 않고 그대로 남긴다(`newer`) |
| `dev` | `^[a-z0-9][a-z0-9-]{0,31}$` | 기기 ID. 앱은 16자리 16진수(`log.newDeviceId(rand)`), MWL 가져오기는 `mwl-` + 해시 12자리 |
| `seq` | 정수 1 ~ 2^53−1 | 기기 안의 순번 |
| `t` | `YYYY-MM-DDTHH:MM:SS.sssZ` | UTC 시각(`toISOString` 꼴만 — 글자 비교 = 시간 비교) |
| `day` | `YYYY-MM-DD` | 그 기기의 학습일 |
| `type` | `^[a-z][a-z0-9.]{0,31}$` | 사건 종류 |

| `type` | 더 갖는 키 | 다시 계산에서 |
|---|---|---|
| `review` | `course`, `card`, `grade`(again·hard·good·easy) | 늦은 복습 규칙으로 SM-2 |
| `card.state` | `course`, `card`, `state{ef, interval, reps, lapses, due, last, grades}`, `src` | 그 카드 상태를 이 값으로 둔다(가져온 진도) |
| `card.hold` | `course`, `card`, `on`(bool), `why`? | 보류(계획에서 뺀다 — BRIEF 5.3-6) |
| `lesson` | `course`, `lesson`, `done`(bool), `confidence`? | 강의 마침·되돌림 |
| `lab` | `course`, `lab`, `done`, `score`?, `total`?, `notes`? | 실습 마침 |
| `drill` | `course`, `drill`, `score`, `max`, `path[]` | 드릴 기록 |
| `quiz` | `course`, `quiz`, `score`(0~100), `answers{}` | 퀴즈 기록 |
| `check` | `course`, `mode`, `scores{}`, `total`, `items[]` | 점검 기록 |
| `session` | `minutes`, `reviewed`, `course`?, `lesson`?, `lab`?, `total`? | 학습 시간(그날에 더한다). `total: true` 는 그 기기의 그날 합계(MWL 가져오기) — 같은 기기·같은 날 합계가 또 오면 늘어난 만큼만 더한다 |
| `journal` | `course`?, `summary`, `apply`, `unclear`, `teach` | 일지 |
| `setting` | `key`(`^[a-z][a-z0-9_.]{0,63}$` — 글자로 시작, `__proto__` 를 받지 않는다), `value` | 기기 사이에 따라가는 설정(나중 것이 이긴다) |

- **정규형**: 키를 정렬한 한 줄 JSON(공백 없음). 사건의 같음 = 정규형 글이 같음
- **기록 파일**: 첫 줄 머리 `{"format":"mylearner-log","min_reader":1,"version":1}`, 다음 줄부터 사건(다시 계산 순서), 끝에 해석하지 않은 줄(글자 순), 마지막 줄바꿈. 머리에 시각이 없다 → 같은 모음 = 같은 바이트
- `log.readFile(text)` → `{ok, header, lines, error}`. 첫 줄이 기록 파일 머리가 아니면 읽지 않는다(`E-LOG-FORMAT`), `min_reader` 가 크면 `E-LOG-READER`
- `log.merge(lineLists)` → `{events, raw, counts: {events, conflicts, bad, newer}}`
  - 같은 정규형은 하나 · 같은 (dev, seq)에 다른 정규형이 n 개면 모두 남기고 충돌 n−1
  - JSON 이 아니거나 봉투가 틀린 줄(`bad`), `v` ≠ 1 인 줄(`newer`)은 그대로(앞뒤 빈칸만 뗀 글) 남기고, 같음도 그 글로 본다 — 정규형으로 바꾸면 큰 수·중복 키·`1e400` 이 바뀐다. 너무 깊이 겹쳐 정규형을 만들 수 없는 줄도 이 꼴로 남는다(그 줄 때문에 합치기 전체가 멈추지 않는다)
  - 기기·종류·과정·카드 ID 를 열쇠로 쓰는 표는 프로토타입 없는 객체이거나 자기 키만 읽는다 — `constructor`·`toString` 같은 ID 가 상속 값을 읽거나 `Object` 에 쓰지 않는다. 모든 ID 규칙은 영문·숫자로 시작해 `__proto__` 를 받지 않는다
- **순서**(FR-223): 기기마다 (seq, 정규형) 순으로 줄 세우고, 기기들의 맨 앞 사건 가운데 열쇠 (day, 순위, t, dev)가 가장 작은 것을 하나씩 꺼낸다(힙). 순위는 `card.state` 1, 나머지 0 — 가져온 상태는 그날의 다른 사건 뒤에 온다. 결과는 사건 모음만의 함수다 → 읽는 순서와 무관
- `log.splitByMonth(events)` → `{"2026-10": [...], …}`(학습일 기준)

### 3.4 다시 계산과 늦은 복습 규칙 (FR-224·225)

`replay.run(events, {today})` → 상태

```
{cards: {과정: {카드: {ef, interval, reps, lapses, due, last, grades}}},  held: {과정: {카드: true}},
 lessons: {과정: {강의: {done, done_at, confidence}}}, labs: {과정: {실습: {done, done_at, score, total, notes}}},
 drills: [...], quizzes: [...], checks: [...], journal: [...], sessions: [{date, minutes, reviewed, lesson, lab}],
 settings: {}, reviews: [{course, card, day, grade, applied}], future: [사건], counts: {…}}
```

`review` 하나(카드 상태 st, 사건의 학습일 d):

```
st.due 가 없거나 d ≥ st.due                                   →  st = srs.review(st, grade, d)
grade = again 이고, 그 카드에 마지막으로 반영된 복습이 같은 날의 again 이 아니다  →  st = srs.review(st, grade, d)   (이른 again 도 실제로 틀린 것이다)
그 밖                                                         →  계산에 쓰지 않는다(counts.early, reviews[].applied = false)
```

| # | 사례 | 결과 |
|---|---|---|
| 1 | 한 기기가 늘 due 날 복습 | SM-2 그대로(MWL 벡터 12가지) |
| 2 | 두 기기가 같은 due 날 good·good | 앞의 것만. 간격이 한 번만 자란다 |
| 3 | 새 카드를 두 기기가 같은 날 처음 good·good | 앞의 것만(due = 다음 날) |
| 4 | A 가 due 날 good, B 가 이틀 늦게 good(A 의 새 due 전) | B 는 이른 복습 |
| 5 | A 가 due 날 good, B 가 A 의 새 due 전에 again | again 은 반영 — 다음 날 다시 |
| 6 | 같은 날 A again·B good(순서 무관) | 어느 순서든 again 상태(reps 0, 간격 1, ef −0.2)로 끝난다. good 이 아니라 hard 면 순서에 따라 ef 가 다르다 — hard→again 은 −0.35(둘 다 반영), again→hard 는 −0.2(hard 는 이른 복습). 어느 쪽이든 정해진 순서로 같은 결과다 |
| 6b | 같은 날 두 기기가 again·again | 한 번만 반영(ef 를 두 번 깎지 않는다). 다른 날의 이른 again 은 반영 |
| 7 | 학습일이 계산하는 날 +1 보다 뒤 | 계산에서 빼고 `future` 로(그날이 오면 들어간다) |
| 8 | 한 기기의 학습일이 순번을 따라 뒤로 감 | 계산은 하고 `counts.clock_back` 을 센다 |
| 9 | `card.state` 뒤의 복습 | 그 상태에서 이어진다(S5) |
| 10 | `card.state` 의 학습일(=MWL 마지막 복습일) 이전·당일의 다른 복습 | 그 상태가 덮는다 — 들여온 진도가 그날까지의 사실이다 |
| 11 | 모르는 종류·꼴이 틀린 알려진 종류 | 계산하지 않고 센다(`unknown`·`invalid`). 줄은 기록 파일에 남는다 |
| 12 | 폐쇄망 안에서만 한 복습 | 밖의 기록에 없다 → 밖의 기기는 그 카드를 다시 낸다(BRIEF 5.2 의 대가) |
| 13 | 시계가 줄곧 과거인 기기(예: 폰이 1월로) | 한계 — 기기 안에서 학습일이 줄지 않으므로 시계 이상으로 잡히지 않고, 그 사건이 앞의 날짜로 계산된다(독립 점검 F11). 합치기 화면(Phase 4)이 기기마다 마지막 학습일을 보여 사용자가 알아보게 한다 |

### 3.5 하루 계획·숙련도·통계 (FR-240~243)

`plan.build(courses, state, settings, today, {docker})` — `courses` 는 과정 객체 목록(앞의 것이 우선), 결과의 항목은 `{course, id}`.

| 칸 | 규칙 |
|---|---|
| 주 과정 | `settings.main_course` 와 ID 가 같은 일반 과정, 없으면 목록의 첫 일반 과정 |
| 학습 순서 | 주 과정의 `plan_variants[과정]` → `default_plan` → 첫 계획 → 계획이 없으면 목차 순 |
| `reviews` | 모든 과정에서 과정 파일에 있고 보류가 아닌 due 카드를 (due, 과정, 카드) 순으로 `max_reviews_per_day` 까지 |
| `new_cards` | 메모 과정의 카드(강의 `created`·ID, 카드 ID 순) → 일반 과정의 마친 강의(마친 날, 과정 순서, 학습 순서, ID)의 카드(ID 순). 본 적 없는·보류 아닌 것만, 모두 합쳐 `new_cards_per_day` 까지 |
| `lesson`·`lab`·`drill`·주·테마 | 주 과정에서 MWL 규칙 그대로(선수 강의, docker 없으면 docker 아닌 실습 먼저, 공부하는 마지막 요일에 드릴) |
| `quiz` | 주 과정 → 나머지 일반 과정 순으로, 단원의 강의를 다 마쳤고 아직 안 푼 첫 퀴즈 |
| 주말 | 공부 요일이 아니고 `weekend_review_only` 면 복습만, `weekend_minutes` 로 상한 |

- 숙련도 `mastery.unit(course, state, unitId)`: MWL `moduleLevel` 그대로. 실습이 없는 단원은 실습 조건, 퀴즈가 없으면 퀴즈 조건, 드릴이 없으면 드릴 조건을 건너뛴다. 일지 `teach` 의 단원 ID 는 그 과정의 일지(또는 과정이 없는 일지)에서만 찾는다
- 통계 `stats.summary(courses, state, today, studyDays)`: MWL `summary` 의 칸 그대로 + `courses: {과정: 영역 요약}`. `knowledge`·`knowledge_cards` 는 메모 과정의 강의·카드 수
- MWL 골든 벡터와의 대응(시험의 어댑터): MWL `content` → 변환기 `to_course` → 과정 `mwl`, MWL `progress` → `mwl_import` → 사건 → `replay` → 상태, `plan_variant` → `plan_variants.mwl`, 결과의 `{course, id}` → ID, `parts/units` → `domains/modules`

### 3.6 렌더러 (FR-250~253)

`markdown.render(text, {lessonRef, image})` → HTML 글

- 문법·줄 나눔은 MWL `markdown.py` 와 같다. Python 과 같게 하려고 JS 에 둔 것: 줄 나눔(`str.splitlines` 의 줄 끝 글자 11가지), 공백(`str.isspace` 집합 — `\x1c`~`\x1f`·`\x85` 포함, `﻿` 제외), `\d` = `\p{Nd}`, `\w` = `[\p{L}\p{N}_]`
- 인라인 처리: 코드 조각을 먼저 떼고 → 글을 이스케이프(`& < >`) → 그림 → 링크 → 굵게 → 기울임(MWL 과 같은 순서). 그림·링크의 **태그 자체는 자리표(`n`)로 바꿔 두어** 굵게·기울임 정규식이 속성값을 건드리지 않는다. 원문에 있던 자리표 글자는 U+FFFD 로 바꾼다
- 속성값: `& < > " '` 를 모두 바꾼다(`&amp; &lt; &gt; &quot; &#x27;` — Python `html.escape` 와 같다)
- 링크: 이스케이프를 푼 주소가 `http://`·`https://`(대소문자 무관)·`#` 로 시작하고 제어 글자가 없을 때만 `<a href="…">`. 아니면 링크 글만 남긴다. `rel` 은 달지 않는다(MWL 출력과 같게 — 새 창을 열지 않으므로 `noopener` 가 할 일이 없다). 참조 정보(Referer)는 화면이 `<meta name="referrer" content="no-referrer">` 로 막는다(Phase 3)
- 그림: `image(src)` 가 `^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$` 를 돌려줄 때만 `<img src alt>`. 아니면 `<span class="img-missing">[그림: 대체 글]</span>`
- 강의 참조: 인라인 코드의 내용이 항목 ID 꼴이고 `lessonRef(id)` 가 주소를 주면 `<a class="ref" href="…"><code>id</code></a>`(MWL `linkify_lesson_refs` 와 같은 결과)
- 펜스 언어: MWL 처럼 `class="language-<언어>"` 에 넣되 속성 이스케이프(따옴표까지)를 한다
- 깊이: 인용 16단·목록 16단을 넘으면 더 파고들지 않고 글로 보인다(스택 넘침 방지)
- 시간: 입력 길이에 선형이다. MWL 정규식 가운데 되짚기가 겹치는 다섯은 같은 결과를 내는 꼴로 바꿨다(독립 점검 ②) — `strip`(`\s+$` 2제곱)·제목(`\s+(.*?)\s*#*\s*$` 3제곱)은 손 코드, 표 구분 줄은 끝의 `\s*\|?\s*` 를 `\s*(\|\s*)?` 로(같은 언어), 그림·링크는 다음 `]`·`)`/공백 위치를 기억해 한 번만 훑는다(정규식은 여는 `[` 마다 다시 훑었다). 같은 결과인지는 시험이 옛 정규식과 무작위 글로 대조하고, 20만 자 14가지 꼴을 자식 프로세스에서 1초 안에 끝나는지 잰다(`markdown.test.js` '선형 시간')
- 135과 대조: MWL `bundle.js` 의 `lessons[id].html` 에서 `href="#/learn/<id>"` 를 `href="#/learn/mwl/<id>"` 로 바꾼 것과 같아야 한다

### 3.7 채점 (FR-244)

`grade.checkAnswer`·`gradeItems`·`checkLab`·`runDrill` 는 MWL 과 같다. 실습 `regex` 만 다르다: ① MWL Python(`mwl/cli/commands/lab.py` 의 `re.fullmatch`)처럼 앞의 `(?i)` 를 대소문자 무시로 받는다 — MWL 의 JS 는 `new RegExp('^(?:(?i)…)$')` 가 `SyntaxError` 라 이런 문항(MWL 54개 중 5개)을 늘 오답으로 냈다 ② 패턴 200자·답 500자 상한 ③ 반복되는 묶음 안에 반복·대안(`|`)이 있으면(`(a+)+`·`(a|aa)+`·`(.*a){3,}`) 또는 역참조면 위험으로 보고 `false`(과정 검사는 `E-REGEX`). MWL 54개 패턴은 모두 통과한다.

### 3.8 MWL 진도 변환 (FR-261·262)

`mwl_import.convert(progress | JSON 글)` → `{lines, events, notes, report}`

| MWL(스키마 2) | 사건 | 학습일 |
|---|---|---|
| `cards[id]` | `card.state`(과정: `K\d{4}-c\d{2}` 면 `mwl-notes`, 아니면 `mwl`), `src: "mwl"` | `last`(없으면 `created`) |
| `lessons[id]`(status `done`) | `lesson` done:true, confidence | `done_at` |
| `labs[id]`(status `done`) | `lab` | `done_at` |
| `drills[]`·`quizzes[]`·`diagnostics[]` | `drill`·`quiz`·`check` | `at` |
| `sessions[]` | `session` | `date` |
| `journal[]` | `journal` | `date` |
| `knowledge[]` | 메모 과정 `mwl-notes` 의 강의(본문·만든 날)와 카드(`K0001-c01` …) — 이제 ID 가 목록 위치에 기대지 않는다 | — |

- 가상 기기 `dev = "mwl-" + sha256("mwl-install|" + created)[:12]` — MWL 설치(진도의 `created`)마다 하나. 시각 `t = <day>T00:00:00.000Z`
- 순번 = 학습일(2000-01-01 부터의 날 수) × 2^36 + 종류 × 2^32 + 자리. 자리는 목록(드릴·퀴즈·점검·세션·일지)이면 목록 위치(MWL 은 덧붙이기만 한다), 표(카드·강의·실습)면 ID 의 sha256 앞 32비트. 그래서 기기 안 순서가 날짜 순이고, **같은 설치의 나중 스냅숏을 다시 들여와도 같은 기록은 같은 줄**이라 하나로 합쳐진다(독립 점검 F6 — 처음에는 진도 전체의 해시를 기기로 써서 스냅숏마다 세션·퀴즈가 두 배가 됐다)
- 바뀐 기록: 카드 상태는 마지막 복습일이 바뀌므로 다른 순번이 되어 나중 상태가 뒤에 온다. MWL 은 한 카드를 하루 한 번만 복습하므로 같은 날 다른 상태는 생기지 않는다(생기면 같은 순번·다른 줄 — 둘 다 남고 글자 순, F7). 같은 날 세션 합계가 늘었으면 `total` 이라 늘어난 만큼만 더한다
- `report.invalid` — 바꾼 사건을 바로 다시 계산해 받지 못한 수(0 이어야 한다)
- `mwl_import.verify(progress, state)` → `{total, match, mismatches}` — 카드마다 ef·interval·reps·lapses·due·last·grades 가 같은지(화면의 "N/N 일치")
- 강의 상태 `in_progress`·모르는 스키마는 바꾸지 않고 `report` 에 센다. 스키마 1 은 MWL `migrate` 와 같게 올린다

### 3.9 Python 변환기 (FR-260)

- `load_content(dir)` — MWL 로더와 같은 규칙으로 읽는다(파일 이름 = ID, 강의 폴더 = 도메인/모듈, 중복 거부). 오류가 하나라도 있으면 모아서 알리고 종료 코드 1
- `to_course(bundle_like, ref, origin_hash)` — MWL 번들 꼴(골든 벡터의 `content` 도 같은 꼴) → 과정 파일. 본문이 없으면(골든 벡터) 빈 글
- 출력: `json.dumps(sort_keys=True, ensure_ascii=False, separators=(",", ":"))` + 줄바꿈. `origin.hash` = MWL `content_hash` 와 같은 방법(상대 경로 + 바이트의 SHA-256)
- 과정 `confidence` = 강의 신뢰도 가운데 가장 낮은 것

## 4. 설정 — 외부화한 값과 기본값

| 값 | 기본 | 어디 |
|---|---|---|
| `day_start_hour` | 0(자정) | `constants.js` `PLAN_DEFAULTS` — 인터뷰 2번 |
| 계획 기본값 | 평일 50분·주말 15분·주말 복습만·복습 40·새 카드 12·월~금 | 같음(MWL 과 같다) |
| `main_course`·`plan_variants` | 없음 | 설정(사건 `setting` 으로 기기 사이에 따라간다) |
| 미래 사건 여유 | +1일 | `constants.js` `FUTURE_DAYS` |
| 렌더 깊이 | 16 | `constants.js` `RENDER_MAX_DEPTH` |
| Node 이미지 | `node:22.23.3-alpine` | `scripts/dev_tools.env` |
| MWL 기준 커밋 | `e55b9c0` | `mylearner/constants.py` `MWL_COMMIT` |

## 5. 오류 처리

| 상황 | 처리 |
|---|---|
| 과정 파일 꼴이 틀림 | 오류 목록을 돌려주고 그 과정을 싣지 않는다(화면이 알린다 — Phase 3) |
| 기록 파일 머리가 틀림·판이 높음 | 그 파일을 읽지 않고 코드로 알린다. 다른 파일은 계속 |
| 사건 줄이 틀림 | 남기고 센다(`bad`·`newer`·`invalid`·`unknown`) — 지우지 않는다 |
| MWL 진도가 JSON 이 아님·모르는 스키마 | `Error`(메시지에 받은 값을 되풀이하지 않는다) |
| 변환기의 MWL 내용 오류 | 모두 모아 표준 출력, 종료 코드 1, 출력 파일을 쓰지 않는다 |

## 6. 요구사항 추적

| FR | 코드 | 시험 |
|---|---|---|
| 201 | `web/core/*.js` 머리 | `tests/unit/js/umd.test.js`, 렌더러 Chromium 단계 |
| 202 | `constants.js`·`mylearner/constants.py` | `tests/unit/py/test_constants_shared.py` |
| 203 | `scripts/verify.sh` 12단계 | 전체 검증 |
| 210~212 | `course.js` | `course.test.js` |
| 213 | `dates.js` | `dates.test.js` |
| 220~227 | `log.js` | `log.test.js`, `property.test.js` |
| 224·225 | `replay.js` | `replay.test.js`, `property.test.js` |
| 228 | `scripts/check_log_roundtrip.js` | 전체 검증 '기록 왕복' |
| 230 | `srs.js` | `srs.test.js`(골든 12) |
| 240~243 | `plan.js`·`mastery.js`·`stats.js` | `golden.test.js`(계획 19·숙련도 2·통계 2), `plan.test.js` |
| 244 | `grade.js` | `grade.test.js` |
| 250~253 | `markdown.js` | `markdown.test.js`, `xss.test.js`, 렌더러 Chromium 단계, 실데이터 대조 |
| 260 | `mylearner/convert/mwl.py` | `tests/unit/py/test_convert_mwl.py`, `tests/integration/py/test_convert_mwl_cli.py`, 실데이터 대조 |
| 261·262 | `mwl_import.js` | `mwl_import.test.js`, `golden.test.js` |
| 263 | `scripts/import_mwl_fixtures.py` | 전체 검증 '골든 벡터 복사본' |

## 7. 아직 정하지 않은 것

| 무엇 | 언제 |
|---|---|
| 저장 어댑터·월별 키·한도(하루 스냅숏 포함) | Phase 3 시작 — 보류 결정 7·8 |
| 통계 항목 넓히기 | Phase 3 — 보류 결정 1 |
| 점검·오답노트를 여러 과정에서 | Phase 3 |
| 과정 항목 수정 합치기 | Phase 5 |
| 해시 라우터가 과정 안 `#…` 링크를 어떻게 받을지 | Phase 3(렌더러는 `#` 링크를 그대로 둔다) |
| 참조 정보(Referer) 막기·CSP | Phase 3 화면·로컬 서버(렌더러는 `rel` 을 달지 않는다) |
| 월별 저장에서 해석하지 못한 줄(`raw`)이 갈 곳, 순번 계수기 | Phase 3 저장 어댑터 — `splitByMonth` 는 사건만 나눈다. `nextSeq` 는 그 기기의 모든 달을 보거나 따로 둔 계수기를 써야 한다(독립 점검 F12) |
| MWL 진도를 몇 번 들여오게 할지 | 보류 결정 2(Phase 3) — 같은 설치의 스냅숏은 다시 들여와도 겹치지 않지만, MWL 을 동결한 뒤 한 번 들여오는 것을 안내한다 |
