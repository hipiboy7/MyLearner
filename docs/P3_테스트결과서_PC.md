# P3 테스트결과서 — PC 에서 배우기

- 작성 2026-11-09 / 대응: [`P3_요구사항정의서_PC.md`](P3_요구사항정의서_PC.md) FR-301~364·NFR-301~306, [`P3_설계서_PC.md`](P3_설계서_PC.md) / 써 보기: [`P3_체크리스트_PC.md`](P3_체크리스트_PC.md)
- 실행 환경: 개발 VM(RHEL 9.6), Python 3.9.21·3.11.9·3.12.3(Playwright 이미지)·3.14.8, Node 22.23.3, 헤드리스 Chromium 153(Playwright `v1.63.0-noble`). 과정 자료: MWL `e55b9c0`(135과), Learn `mwm-app`(45과)·`llm-chat-agent`(9과)

## 1. 실행 증거

### 1.1 전체 검증 — `bash scripts/verify.sh` (2026-11-09, 커밋 직전)

```
단계                         결과   초
0 환경 확인                통과   1
1 시험 Python 3.9            통과   17
2 시험 Python 3.11           통과   17
3 시험 Python 3.12(Docker)   통과   18
4 시험 Python 3.14(Docker)   통과   21
5 3.9 문법(ai_probe)         통과   0
6 커버리지(A>=90 B>=70)    통과   18
7 문서 검사                통과   0
8 공개 전 점검            통과   1
9 브라우저 점검 정적 검사 통과   0
10 브라우저 스모크(Chromium) 통과   5
11 반입 묶음 재현·외부 URL 0 통과   0
12 시험 JS(Node 22)+커버리지 통과   17
13 웹 JS 정적 검사        통과   0
14 골든 벡터 복사본(MWL) 통과   1
15 기록 왕복(S3)           통과   7
16 MWL 실데이터 대조     통과   2
17 렌더러 Chromium(XSS)     통과   3
18 앱 묶음 재현·판별   통과   3
19 화면 스모크(Chromium)  통과   18
전체 통과 (20단계)
```

새 단계는 18(앱 묶음 재현·판별)·19(화면 스모크)이고, 13 은 '웹 JS 정적 검사'로 넓혔다(web/store·web/app·index.html). `--quick` 은 3·4·10·17·19 를 건너뛴다.

### 1.2 화면 스모크 — `python3 scripts/app_smoke.py` (2026-11-09)

| 단계 | 결과 |
|---|---|
| file:// · 폐쇄망판 · first | 화면 15개 + 어둡게 3개 접근성 위반 0. 강의 마침 → 복습 10장 대기열 → good 2(단추)·again 1(키보드 `Space`·`1`)·보류 1 → 퀴즈 → 기준선 점검 → 설정(평일 40분) → 회고 → 주 과정 바꾸기·되돌리기 → 보류 풀기 → 통계 ①~⑥ → MWL 진도 두 번 들여오기 → 탭 임대 → 닫을 때 임대 놓기. 사건 54줄(`card.state` 30 · `lesson` 4 · `session` 6 · `journal` 4 · `setting` 3 · `review` 3 · `card.hold` 2 · `quiz` 1 · `check` 1) |
| MWL 들여오기(만든 진도 — 카드 30·강의 3·내 지식 2) | 첫 번째 새 줄 36 = 더한 줄 36, **변환 일치 30/30**, 두 번째 새 줄 0·사건 수 그대로(멱등), 들여오기 전 백업 2개, 메모 과정 `mwl-notes` 실림 |
| 외부 링크(판 설정) | 같은 Learn 강의(`mwm-app/00-prerequisites.01-linux`)에서 폐쇄망판 `<a href="http…">` 0개, 인터넷판 29개 |
| file:// · persist(브라우저를 닫았다 다시 열기) | 기대 54줄 · 남은 54줄 · 사라짐 0 |
| file:// · perf(사건 5,054줄) | 첫 화면 383 ms · 오늘 다시 그리기 3 ms · 통계 41 ms · 복습 한 장(답 보기 + good, 저장 포함) 133 ms — NFR-302(2초·200 ms) 안. 앞 브라우저가 CDP 로 닫혀 임대가 풀리기를 기다린 4,038 ms 는 따로 적었다(T-010) |
| 서버 모드 · 인터넷판 · first·persist | 같은 흐름. 깨진 과정 하나를 싣지 않고 알림(FR-303). 사건 54줄, 다시 연 뒤 사라짐 0 |
| 서버 모드 · 데이터 폴더(명령 단위) | 화면이 만든 줄 54 · `data/log.jsonl` 54줄 · 없는 줄 0 · 백업 2개 |
| 브라우저 오류(CSP 위반·못 읽은 파일 — CDP `Log`)·스크립트 예외 | 0 |

### 1.3 앱 묶음 — `python3 scripts/pack_app.py --check` (2026-11-09)

```
mylearner-closed-v0.3.0: 파일 41개 · 과정 3개 · .tgz 2368482 바이트 sha256 ba022596bbc6 · 과정 자료 안 외부 주소 101종 (man7.org 64, docs.docker.com 54, developer.mozilla.org 34, www.tmaxsoft.com 33, docs.python.org 31, app.mwm.local:20443 19, www.postgresql.org 18, flask-appbuilder.readthedocs.io 15)
mylearner-internet-v0.3.0: 파일 41개 · 과정 3개 · .tgz 2368491 바이트 sha256 bf90a91ccf99 · .zip 2402456 바이트 · 과정 자료 안 외부 주소 101종 (man7.org 64, docs.docker.com 54, developer.mozilla.org 34, www.tmaxsoft.com 33, docs.python.org 31, app.mwm.local:20443 19, www.postgresql.org 18, flask-appbuilder.readthedocs.io 15)
두 판 모두 두 번 만들어 같음 · 폐쇄망판 앱 파일 외부 URL 0 · 내보내기 꺼짐 · 외부 AI 프리셋 없음
```

과정 자료 안 외부 주소는 강의 글 속 문서 주소다(MWL 은 글로, Learn 은 마크다운 링크로). 폐쇄망판은 판 설정 `link_hosts: []` 라 링크로 만들지 않는다(1.2 — 0개). ⚠️ 이 판단(묶음 검사의 '외부 URL 0' 을 앱 파일에만 적용)은 사용자 재확인 대상이다(P3 인터뷰결과서 3절)

푼 묶음에서 켜기(2026-11-09, 이 VM): `tar -xzf mylearner-closed-v0.3.0.tgz` → 그 폴더에서 `python3 -m mylearner serve --no-browser --port 18791` → `MyLearner 0.3.0 폐쇄망판 - http://127.0.0.1:18791/?token=<토큰>`, 데이터 폴더 = 그 폴더의 `data`. 토큰 헤더로 `/api/health` → `{"ok": true, "app": "mylearner", "version": "0.3.0", "edition": "closed"}`, `/data/manifest.js` 200 `application/javascript`, 토큰 없이 `/` 401

### 1.4 Learn 변환 실데이터 (2026-11-09)

| 명령 | 출력 |
|---|---|
| `python3 -m mylearner.convert.learn /data/projects/Learn/mwm-app --out dist/courses/mwm-app.course.json` | `과정 mwm-app: 강의 45 · 카드 372 · 실습 0 · 드릴 0 · 퀴즈 0 · 용어 433 · 진단 0` |
| `python3 -m mylearner.convert.learn /data/projects/Learn/llm-chat-agent --out dist/courses/llm-chat-agent.course.json` | `과정 llm-chat-agent: 강의 9 · 카드 128 · 실습 0 · 드릴 0 · 퀴즈 0 · 용어 106 · 진단 0` |
| `python3 -m mylearner.convert.learn /data/projects/Learn/kids --out dist/kids.course.json` | `변환하지 못했다: area: kids 자료는 가져오지 않는다(Learn 경계 규칙 2절)` — 파일 없음 |
| JS `course.validate`(Node 22) | mwm-app·llm-chat-agent·mwl 모두 오류 0·경고 0, 45과 렌더 206 ms·9과 26 ms·135과 150 ms |

### 1.5 안드로이드 빌드 이미지(Phase 4 준비, 사용자 요청)

`ghcr.io/cirruslabs/android-sdk:36@sha256:f9b3ea9ed2b5…` — 이 이미지로 `--network none` 에서 WebView 액티비티 하나짜리 APK 를 `aapt2 link` → `javac --release 11` → `d8` → `zipalign` → `apksigner sign/verify` 했다. `apksigner verify --print-certs` → `Signer #1 certificate DN: CN=smoke`, `aapt2 dump permissions` → 권한 줄 없음(8,605 바이트, 2026-11-09). 압축 백업 1,087,966,269 바이트, `sha256sum -c` 통과.

## 2. 테스트 구성

| 종류 | 파일 | 수 |
|---|---|---|
| JS 단위(A) | `tests/unit/js/checkup.test.js`·`stats.test.js`·`store_common.test.js`·`markdown.test.js`(allowLink 1건 더함) | 8 · 6 · 8 · +1 |
| JS 단위(B) | `tests/unit/js/store_adapters.test.js`(가짜 localStorage·KV·fetch) | 8 |
| Python 단위(A·B) | `tests/unit/py/test_storage.py` | 12 |
| Python 통합(B) | `tests/integration/py/test_server.py`(실제 서버 13)·`test_convert_learn.py`(5)·`test_pack_app.py`(7)·`test_verify_tools_p2.py`(Phase 3 묶음 규칙 1건 더함) | 26 |
| 화면(C) | `scripts/app_smoke.py` + `tests/ui/app_check.js`·`a11y.js`(CDP `tests/ui/cdp.js` — `ready`·`inject`·`log` 더함) | 시나리오 6 + 스크린샷 9화면 × 2폭 |

JS 시험 131건(단위 129·통합 2), Python 시험 248건 — 모두 통과(2026-11-09).

## 3. 커버리지

### 3.1 JS — `bash scripts/run_js_tests.sh`(기준 줄 90%·분기 80%, `web/core/**`·`web/store/**`, `idb.js` 제외 — 브라우저 전용)

| 파일 | 등급 | 줄 | 분기 | 함수 |
|---|---|---|---|---|
| `web/core/checkup.js` | A | 100.00 | 81.19 | 100.00 |
| `web/core/stats.js` | A | 100.00 | 87.50 | 98.65 |
| `web/core/markdown.js` | A | 100.00 | 95.43 | 100.00 |
| `web/store/common.js` | A | 100.00 | 90.16 | 100.00 |
| `web/store/browser.js` | B | 100.00 | 88.06 | 97.30 |
| `web/store/server.js` | B | 100.00 | 84.00 | 100.00 |
| 전체 | — | 100.00 | 87.81 | 99.66 |

### 3.2 Python — `python3 scripts/coverage_lite.py --enforce`

| 파일 | 등급 | 커버 |
|---|---|---|
| `mylearner/storage.py`(순수 함수 6개) | A | 100.0% |
| `mylearner/storage.py` | B | 98.5% |
| `mylearner/server.py` | B | 98.0% |
| `mylearner/__main__.py` | B | 91.7% |
| `mylearner/convert/learn.py` | B | 97.3% |
| 등급 전체 | A 96.6% · B 95.7% | — |

- `scripts/pack_app.py`(B)는 `scripts/` 가 측정 폴더 밖이라 줄 커버리지를 재지 않았다(P1 `pack_probe.py` 와 같다) — 시험 7건 + 전체 검증 18단계로 본다
- 화면(`web/app/*.js`, C)은 측정하지 않고 화면 스모크로 본다

## 4. 요구사항별 검증

| FR | 증거 |
|---|---|
| 301·304·305 | 화면 스모크 — `file://`·서버 모드 모두 브라우저 오류(CSP 위반 포함) 0, 화면 15개 h1·오류 상자 없음, `#/nope/x` 는 오늘로. 웹 JS 정적 검사 — `index.html` 인라인 스크립트·`style=`·외부 주소 0, CSP 메타 있음 |
| 302·327 | `test_pack_app.py`(판 설정·`web/config.js` = 인터넷판 생성물), 스모크 — 폐쇄망판 '기록 파일 내려받기' 없음·인터넷판 있음, `test_server.py` 폐쇄망판 백업 내려받기 404 |
| 303 | 스모크 서버 모드 — 깨진 과정 1개 싣지 않고 알림, `test_storage.py`(깨진 사용자 과정 파일 건너뜀) |
| 306 | 스모크 — `#/check/mwl/run`·`#/import/mwl`·`#/review`·`#/settings` 를 주소로만 열어 사건 수 그대로. 날짜 넘김은 MWL 코드를 옮김(시간을 돌리는 시험은 없음 — 8절) |
| 307 | 스모크 — 어둡게 화면 접근성 0, 스크린샷 |
| 310~319 | 스모크 흐름(1.2) |
| 312 | `markdown.test.js` allowLink, 스모크 외부 링크 0/29 |
| 316 | `checkup.test.js` 8건(영역 = 목차, MWL 정렬·0.5 올림) |
| 320~324 | `store_common.test.js`·`store_adapters.test.js`·`test_storage.py`, 스모크 persist(유실 0)·서버 데이터 폴더(없는 줄 0)·백업 수 |
| 325·326 | `store_common.test.js`(임대 판정), 스모크 — 다른 탭 임대 중 저장 안 함 → 넘겨받아 저장, 닫을 때 놓기, `store_adapters.test.js`(가득 참 → 던짐) |
| 330~335 | `test_server.py` 13건(Host 검사·토큰·쿠키·보안 헤더·정적 경로 밖·쓰기 JSON·같은 출처·한도·과정·백업·동시 덧붙이기 41줄) |
| 340~347 | `stats.test.js` 6건(①~⑥), 스모크 — 통계 절 6개·차트·상태 막대, 스크린샷 |
| 350~352 | `test_convert_learn.py` 5건, Learn 실데이터 1.4 |
| 353·354 | `test_pack_app.py`, 전체 검증 18단계(두 판 두 번 같은 바이트·폐쇄망판 앱 파일 외부 URL 0) |
| 360~364 | 스모크 — 미리보기·변환 일치 30/30·두 번째 새 줄 0·백업 2개·메모 과정 |
| NFR-301·303·306 | 스모크(1.2) |
| NFR-302 | perf 단계 383 ms·133 ms |
| NFR-304 | 전체 검증 1~4단계(3.9·3.11·3.12·3.14), `test_server.py`·`test_convert_learn.py` 의 출력 `encode("cp949")` |
| NFR-305 | `test_pack_app.py`·`test_convert_learn.py`(두 번 같은 바이트) |

## 5. 점검

### 5.1 자체 점검(만든 에이전트)

| 본 것 | 결과 |
|---|---|
| 기록 유실 0 | 저장 실패·다른 탭 임대 중이면 사건을 메모리(`pending`)에 두고 다음 저장 때 다시 보낸다. 날짜 넘김은 저장 못 한 것이 있으면 먼저 저장. 서버는 합집합·원자적 쓰기·잠금, 남의 파일 머리면 쓰지 않는다. 들여오기는 백업이 실패하면 아무것도 더하지 않는다 |
| 같은 기기의 순번 | `nextSeq` = max(모든 사건, 저장소의 `mylearner.seq`, 마지막으로 쓴 순번) + 1, 넘겨받을 때 저장소를 다시 읽는다(P2 독립 점검 F12) |
| 토큰 | 데이터 폴더 `token`(권한 600 — Windows 는 그 계정 폴더 권한), 비교는 `hmac.compare_digest`, 로그에 주소·토큰을 찍지 않는다. Windows 에서는 `SO_REUSEADDR` 를 끈다(다른 프로세스가 같은 포트에 또 묶이지 않게) |
| 경로 | 정적 파일은 웹 폴더 안만·`.` 으로 시작하는 이름 거부, 백업 이름·과정 ID 는 정규식으로만 |
| 폐쇄망 판별 | 앱 코드·설정·안내 글 외부 URL 0, `export` 거짓, `link_hosts` 빔, `ai_presets` 빔 — 묶음 검사가 본다 |
| 위험(남음) | localStorage 한도(폐쇄망 미측정 — 보류 결정 8), 실제 Chrome 150·Windows 미실행(8절), 실제 MWL 진도는 만든 진도로만 대조 |

### 5.2 독립 점검 — 저장 어댑터·로컬 서버(CLAUDE.md 12절)

아직 하지 않았다 — 서브에이전트 수·토큰을 사용자에게 묻고 승인받은 뒤 한다(결과 보고 확인 요청).

## 6. 첫 사용 재현

README 0절의 명령(과정 만들기 → `--web-data` → `serve --no-browser` → 묶음 → 스모크)을 적은 그대로 돌렸다(2026-11-09). `serve` 는 `MyLearner 0.3.0 인터넷판 - http://127.0.0.1:8770/?token=…` 와 데이터 폴더를 찍는다(`test_server.py` CliTest 가 같은 줄을 본다).

## 7. 실패·재작업 내역

| # | 무엇 | 원인 | 조치 |
|---|---|---|---|
| 1 | `checkup.test.js` 오답노트 정렬 1건 | 시험이 틀림(MWL 은 마지막 오답이 최근인 것이 앞) | 시험을 고침. 시험 먼저 — 모듈 없음 실패를 본 뒤 구현 |
| 2 | `stats.test.js` 연속 학습일 1건 | 시험이 틀림(공부 요일이 아닌 날 한 것도 MWL streak 은 센다) | 시험을 고침. 6건 모두 구현 전 실패를 봄 |
| 3 | `markdown.test.js` allowLink 1건 | 시험이 틀림(괄호가 든 `javascript:` 주소의 링크는 첫 `)` 에서 주소가 끝나 남은 `)` 가 글로 남는다 — MWL 과 같음) | 시험을 고침 |
| 4 | `store_common.test.js` 임대 경계 1건 | 6초 '이상'과 '넘음'이 어긋남 | 6초 이상이면 오래된 것으로 |
| 5 | 웹 JS 정적 검사 위반 | `A.cfg.export` 를 ES 모듈 `export` 로 잡음, store 의 UMD `require` 꼴 | 규칙을 줄 맨 앞 `import`·`export` 로, store 의 `require` 두 꼴 허용 |
| 6 | 화면 스모크 — 제목 단계 건너뜀(h1 → h3) 10건 | MWL 골격의 카드·안내 제목이 h3 | h2 로(같은 크기 토큰) |
| 7 | 화면 스모크 — 복습 한 장 4~6초 | 쓰는 탭 임대 — 다시 연 탭이 6초 읽기 전용(T-010) | 닫을 때 임대 놓기 |
| 8 | 스크린샷이 멈춤·단계마다 30초 늦음, 고친 뒤 세 번에 한 번 '결과를 쓰기 전에 이벤트 루프가 비었다' | `captureBeyondViewport`·경주 타이머, 그다음 브라우저 끝 기다림까지 `unref` 해 이미 끝난 브라우저를 기다리다 루프가 빔(T-011) | 창 늘려 찍기·경주 타이머 `unref`·`waitExit`(이미 끝났으면 바로) |
| 9 | 브라우저 스모크(P1) 실패 | `cdp.js` 가 브라우저 오류 기록을 `console` 에 넣어, 점검 도구가 일부러 일으키는 fetch·CORS 실패가 잡힘 | `log` 칸으로 나눠 화면 스모크만 본다 |
| 10 | 스모크의 외부 링크 검사가 돌지 않음 | MWL 강의는 주소를 글로만 쓴다 | 실린 과정 전체에서 찾게(Learn 강의) |
| 11 | 브라우저 모드가 빈 기록을 하루 백업(0 KB) | 서버와 규칙이 달랐다 | 빈 기록은 백업하지 않는다(서버와 같게), 시험 고침 |
| 12 | 390px 스크린샷에서 통계 차트 글자가 약 5px | viewBox 960 을 그대로 줄였다(FR-347 위반 — 스크린샷을 직접 보고 찾음) | 좁은 화면은 그리는 폭 420·아래 글 6개·긴 이름 줄임, 창 폭이 600px 을 넘나들면 통계 화면을 다시 그린다 |

## 8. 실행하지 못한 것

| 무엇 | 이유 | 언제 |
|---|---|---|
| Windows 에서 `MyLearner.cmd`·`py -3 -m mylearner serve`, 한국어 콘솔 | 개발 VM 은 Linux — 서버·CLI 는 Linux 와 Python 3.9~3.14 로, 출력은 cp949 로 바꿔 시험 | 체크리스트 2·4 |
| 실제 Chrome 150(폐쇄망)·내 PC Chrome | 헤드리스 Chromium 153 으로 대신 | 체크리스트 2~4 |
| 폐쇄망 브라우저의 localStorage·IndexedDB 한도와 다시 연 뒤 남는지 | 보류 결정 8(사용자 실행) | 결과 코드가 오면 보류 결정 7 확정 |
| 사용자의 실제 MWL 진도 들여오기 | 진도가 폐쇄망 브라우저에만 있다 | 체크리스트 4 |
| 실제 탭·창 닫기의 `pagehide` | 헤드리스는 CDP 로 닫아 오지 않는다 — 화면 안에서 이벤트를 보내 확인 | 체크리스트 3(탭 둘) |
| 날짜 넘김(밤새 열어 두기) | 시간을 돌리는 시험을 두지 않았다 — MWL `checkDay` 를 옮김 | Phase 4 합치기 화면 시험 때 |

## 9. 화면 확인

`python3 scripts/app_smoke.py --shots docs/screenshots/P3`(2026-11-09) — 폐쇄망판 `file://`, 위 스모크의 기록을 쌓은 프로필. 18장을 직접 열어 봤다.

| 화면 | PC(1280px) | 휴대폰(390px) | 본 것 |
|---|---|---|---|
| 오늘 | [today-1280](screenshots/P3/today-1280.png) | [today-390](screenshots/P3/today-390.png) | 순서 목록 4단계, 다음 할 일만 파란 단추, 과정 이름 태그, 목표 막대 |
| 복습 | [review-1280](screenshots/P3/review-1280.png) | [review-390](screenshots/P3/review-390.png) | 답·등급 4개(숫자 키 표시)·보류 단추, 메모 과정 카드 |
| 강의 | [learn-1280](screenshots/P3/learn-1280.png) | [learn-390](screenshots/P3/learn-390.png) | 본문·목차(390px 은 위 가로 줄), 신뢰도·출처 |
| 통계 | [stats-1280](screenshots/P3/stats-1280.png) | [stats-390](screenshots/P3/stats-390.png) | ①~⑥, 범위 글, 7일 예정 막대, 28일 막대(아래 날짜가 끝에서부터 같은 간격), 주별 정답률('—(복습 없음)'), 상태 막대 + 이름·수 |
| 점검 | [check-1280](screenshots/P3/check-1280.png) | [check-390](screenshots/P3/check-390.png) | 기준선·무작위(영역 고르기)·오답 다시 풀기 |
| 지도 | [map-1280](screenshots/P3/map-1280.png) | [map-390](screenshots/P3/map-390.png) | 영역 → 단원 숙련도 막대·강의 칩 |
| 과정 | [courses-1280](screenshots/P3/courses-1280.png) | [courses-390](screenshots/P3/courses-390.png) | 과정 4개(MWL·Learn 2·메모), 주 과정 |
| 설정 | [settings-1280](screenshots/P3/settings-1280.png) | [settings-390](screenshots/P3/settings-390.png) | 화면·학습 설정, 기록 표, 백업 목록, 폐쇄망판이라 내려받기 없음 |
| MWL 들여오기 | [import-1280](screenshots/P3/import-1280.png) | [import-390](screenshots/P3/import-390.png) | 병행 안내, 미리보기 표(이미 들여와 새 줄 0) |
