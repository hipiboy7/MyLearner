# P4 설계서 — 폰에서 배우기 + 합치기 (APK · 안드로이드 저장 · 교환 파일 · 합치기·되살리기 · 폐쇄망 zip · CI)

- 작성 2026-11-10 / 대응 요구사항: [`P4_요구사항정의서_Mobile.md`](P4_요구사항정의서_Mobile.md) FR-401~481, NFR-401~408 / 상위 문서: [`설계서_Architecture.md`](설계서_Architecture.md), [`P3_설계서_PC.md`](P3_설계서_PC.md), [`P2_설계서_Core.md`](P2_설계서_Core.md)
- 코드: `web/core/`(zip·exchange·merge), `web/store/`(android·더하기), `web/app/`(merge_view·더하기), `mylearner/`(storage·server 더하기), `config/editions/mobile.json`, `mobile/android/`, `scripts/`(build_android.sh·pack_app.py·ci_windows_bundle.py·check_workflows.py), `.github/workflows/` / 시험: `tests/unit/js/`, `tests/integration/py/`, `tests/ui/`, `mobile/android/test/`, `mobile/android/e2e/`
- 옮겨 온 코드의 출처: MWL `e55b9c0` 의 `mobile/android/`(`MainActivity`·`Policy`·`ShareProvider`·`Mirror` 의 원자적 쓰기·셸 스크립트·`tools/pack.py`·`tools/docker-build.sh`·`e2e/emulator_test.py`), `scripts/build_android.sh`

## 1. 데이터 흐름

```
[개발 VM]  pack_app.py --edition mobile --web-out <stage> ─▶ web 사본(config.js = 모바일판, data/ = 과정 셋)
           mobile/android/tools/pack.py stage ─▶ index.html 사본에 셸 스크립트 한 줄
           build_android.sh(ANDROID_IMAGE, --network none): 규칙 시험(JVM) → aapt2 → javac → d8 → zipalign → apksigner → 점검(권한 0)
                                                           ─▶ dist/android/MyLearningPlatform-v<판>.apk
[폰]  MainActivity ─ WebView ─ https://appassets.androidplatform.net/web/index.html#/today
        화면(PC 와 같은 web/) ─ 저장소 = store/android.js ─ 다리 kv* ─▶ Kv.java ─▶ files/kv/<이름>(원자적 교체)
        교환 파일 내보내기 ─ 다리 save·share ─▶ 시스템 저장 창(ACTION_CREATE_DOCUMENT) · 공유 시트(ACTION_SEND)
        파일 고르기(<input type=file>) ─▶ ACTION_OPEN_DOCUMENT ─▶ 합치기·MWL 들여오기 화면
[세 판 공통]  교환 파일(zip) ─ exchange.open ─▶ merge.preview ─(확인)─▶ store.backup('import-merge') ─▶ store.append ─▶ saveCourse ─▶ 다시 읽기 ─▶ N/N
              백업 ─ store.backupDiff ─▶ merge.restorePlan ─(확인)─▶ store.restore(이름, 뺄 줄) ─▶ 다시 읽기
```

- 상태는 Phase 3 처럼 늘 사건에서 다시 계산한다. 합치기·되살리기는 저장소의 줄 모음만 바꾸고 화면은 다시 읽는다

## 2. 모듈 구성

| 파일 | 책임 | 등급 | 출처 |
|---|---|---|---|
| `web/core/zip.js` | CRC-32, zip 쓰기(저장 방식·시각 고정), zip 읽기(중앙 디렉터리 → 항목, 저장·deflate — 압축 풀기는 주입), 한도 | A | 새로 |
| `web/core/exchange.js` | 교환 파일 만들기·열기(머리·해시 대조), 파일 종류 알아보기(교환 zip·기록 파일·MWL 진도·그 밖) | A | 새로 |
| `web/core/merge.js` | 합치기 미리보기(새 줄·기기·과정·충돌·모르는 종류·미래·시계)·N/N 확인, 되살리기 계획, 내보내기 알림 날 수 | A | 새로 |
| `web/store/common.js` | (더하기) 백업 까닭 `import-merge`·`restore`, `restoreLines`(순수) | A | P3 |
| `web/store/browser.js`·`server.js` | (더하기) `backupDiff`·`restore` | B | P3 |
| `web/store/android.js` | 안드로이드 어댑터 — 다리의 파일 KV 를 localStorage 꼴(`ls`)과 KV 꼴(`kv`)로 감싸 브라우저 어댑터를 그대로 쓴다 | B | 새로 |
| `web/app/merge_view.js` | 합치기 화면(`#/import/merge`), 되살리기 화면(`#/restore/<백업>`), 교환 파일 내보내기 행동, 내보내기 알림 띠 | C | 새로 |
| `web/app/util.js`·`state.js`·`settings_view.js`·`views.js`·`main.js` | (더하기) 바이트 내려받기·플랫폼 훅, 안드로이드 저장소 고르기·이 기기 판정, 설정의 교환·백업 칸, 오늘의 띠, 파일 고르기 묶기 | C | P3 |
| `mylearner/storage.py`·`server.py` | (더하기) 백업 까닭, `backup_diff`·`restore`, API 둘 | B(순수 A) | P3 |
| `config/editions/mobile.json` | 모바일판 설정 | — | 새로 |
| `scripts/pack_app.py` | (더하기) 폐쇄망 zip, `--web-out`(APK 용 web 사본), `config.js` 에 앱 판 | B | P3 |
| `mobile/android/AndroidManifest.xml`·`res/` | 매니페스트(권한 0)·아이콘·테마 | C | MWL |
| `mobile/android/src/io/github/hipiboy7/mylearningplatform/MainActivity.java` | WebView·가로채기·다리·파일 고르기·저장·공유·뒤로·가장자리·확인 창·날짜 넘김 | B | MWL `MainActivity` |
| `…/Policy.java` | 주소 규칙·뒤로 가기·고른 주소·파일 이름·CSP(순수) | A(JVM 시험) | MWL `Policy` |
| `…/Kv.java` | 파일 KV — 이름 규칙·원자적 교체(임시 → fsync → 이름 바꾸기)·목록(순수 + 파일) | A(JVM 시험) | MWL `Mirror` 의 쓰기 |
| `…/ShareProvider.java` | 공유할 파일 하나를 받는 앱에만 잠깐 읽기 | B | MWL |
| `mobile/android/shell/android-shell.js` | `MyLearner.platform`(저장·공유·바깥 링크·상태 표시줄), `<html data-shell="android">` | C | MWL 셸 스크립트 |
| `mobile/android/tools/pack.py` | web 사본에 셸 한 줄 넣기, dex 붙이기(재현), 판 번호 | B | MWL |
| `mobile/android/tools/docker-build.sh` | (컨테이너 안) 시험 → aapt2 → javac → d8 · 정렬 → 서명 → 점검 · 키 만들기 | B | MWL |
| `scripts/build_android.sh` | APK 빌드 명령 하나(`--test-key`·`--debuggable`·`--repro`·`--courses`) | B | MWL |
| `mobile/android/e2e/emulator_test.py` | 에뮬레이터 시험(설치·누르기·강제 종료 뒤 남음·내보내기) — VM·Actions 공용 | C | MWL |
| `scripts/ci_windows_bundle.py` | (Windows 러너) 묶음 실기 — zip 풀기 → `MyLearner.cmd` → 토큰·기록 → 다시 켜기 → cp949 | B | 새로 |
| `scripts/check_workflows.py` | 워크플로 정적 검사(권한·SHA 고정·금지 이벤트·비밀값 참조) | B | 새로 |
| `.github/workflows/windows-bundle.yml`·`android-emulator.yml` | CI 2종 | C | 새로 |

싣는 순서(index.html): Phase 3 순서에 `core/zip.js`·`core/exchange.js`·`core/merge.js`(core 끝), `store/android.js`(store 끝), `app/merge_view.js`(`settings_view.js` 다음)를 더한다. APK 사본만 `styles.css` 바로 뒤에 `android-shell.js` 한 줄.

## 3. 인터페이스

### 3.1 판 설정 (FR-409·413)

```json
{"edition": "mobile", "label": "모바일판", "export": true, "link_hosts": ["*"], "server": null,
 "stats_scope": "이 폰에 모인 기록(이 폰 + 들여온 기록)", "ai_presets": [], "remind_export_days": 7}
```

- 새 키 `remind_export_days` — 0 이면 띠 없음. 인터넷판·폐쇄망판 0, 모바일판 7
- `pack_app.py` 가 `config.js` 에 `app_version`(= `mylearner.__version__`)을 넣는다 — 교환 파일 머리와 설정 '이 앱' 줄이 쓴다
- 모바일판의 `link_hosts: ["*"]` 는 강의 링크를 만들되 누르면 셸이 묻고 폰 브라우저로 넘긴다(3.2)

### 3.2 안드로이드 껍데기 (FR-401~408)

| 항목 | 정한 것 |
|---|---|
| 매니페스트 | `package` `io.github.hipiboy7.mylearningplatform`, `uses-permission` 없음, `android:allowBackup="false"`, `android:usesCleartextTraffic="false"`, 액티비티 하나(`exported=true` — 런처), `ShareProvider`(`exported=false`, `grantUriPermissions=true`), `configChanges="orientation\|screenSize\|smallestScreenSize\|screenLayout\|keyboard\|keyboardHidden\|density\|uiMode"` 중 `uiMode` 는 빼서 밝기 모드가 바뀌면 새로 그린다(MWL 과 같음) |
| 가상 주소 | `https://appassets.androidplatform.net/web/<경로>` → `assets/web/<경로>`. 그 밖 403 · 없는 파일 404 · GET 만 · 경로에 `..`·`\`·`%2e`·`%2f` 거부(`Policy.assetPath`). HTML 에 CSP 헤더(`Policy.CSP` — `web/index.html` 메타와 같은 글 + `frame-ancestors 'none'`, 같은지는 Python 시험이 본다) |
| 첫 화면 | `…/web/index.html#/today`(해시를 붙여 열어 화면 기록이 한 번 더 쌓이지 않게) |
| WebView 설정 | JS 켬, DOM 저장소 켬, `allowFileAccess`·`allowContentAccess` 끔, `setSupportMultipleWindows(false)`, `javaScriptCanOpenWindowsAutomatically(false)`, Safe Browsing·사용 통계 끔, 디버그 빌드에서만 `setWebContentsDebuggingEnabled(true)` |
| 다리 `MyLearnerAndroid` | 지금 화면 주소가 `https://appassets.androidplatform.net/` 로 시작할 때만 일한다(아니면 빈 값). 메서드는 아래 표 |
| 파일 고르기 | `<input type=file>` → `onShowFileChooser` → `ACTION_OPEN_DOCUMENT`(`*/*` — 카톡이 저장한 파일의 형식이 제각각). 돌아온 주소는 `content:` 만(`Policy.pickedOk`) |
| 뒤로 가기 | `Policy.back(hash)` — `#/today`(또는 빈 해시)면 닫기, 아니면 `history.back()`, 기록이 없으면 `#/today`. 13 이상 `OnBackInvokedCallback`, 8~12 `onBackPressed` |
| 앞으로 올 때 | `onResume` → `MyLearner.app && MyLearner.app.checkDay && MyLearner.app.checkDay()`(날짜 넘김, P3 FR-306) |
| 확인 창 | `alert`·`confirm` → 앱 창(제목 `MyLearningPlatform`, 확인·취소) |
| 가장자리 | 11 이상은 가장자리까지 그리고 시스템 막대·자판·노치만큼 WebView 에 여백. 상태 표시줄 색은 셸이 `setBars(색, 어두움)` 로 알린다 |
| 아이콘·판 | 적응형 아이콘(MWL 모양을 MyLearner 색으로), `versionCode` = 주×10000+부×100+수(0.4.0 → 400), minSdk 26 · targetSdk 36 · compileSdk 36(이미지의 android-36) |

다리 메서드(모두 `@JavascriptInterface`, 동기 — WebView 의 다리 스레드에서 돈다):

| 메서드 | 하는 일 | 돌려줌 |
|---|---|---|
| `kvGet(name)` | `files/kv/<name>` 읽기 | 글 또는 `null` |
| `kvPut(name, text)` | 원자적 쓰기(3.3) | `""` 성공 · 오류 글 |
| `kvDel(name)` | 지우기 | `""` · 오류 글 |
| `kvList(prefix)` | 그 접두사로 시작하는 이름들 | JSON 배열 글(이름순) |
| `saveFile(name, base64, mime)` | 시스템 저장 창 → 고른 곳에 쓰기(UI 스레드로 넘김) | `""` 시작함 · 오류 글. 끝나면 `MyLearner.platform.done('save', ok, 글)` 를 부른다 |
| `shareFile(name, base64, mime)` | 앱 캐시 `share/<name>` 에 쓰고 `ACTION_SEND`(받는 앱에만 읽기) | 같음(`done('share', …)`) |
| `openExternal(url)` | `http(s)` 만, 폰 브라우저로(`ACTION_VIEW`) | `""` · 오류 글 |
| `setBars(color, dark)` | 상태·내비게이션 막대 색과 아이콘 밝기 | — |
| `info()` | `{"version", "code", "sdk", "webview"}` JSON | 글 |

- 파일 이름 규칙(`Policy.fileNameOk`): `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(zip|jsonl|json)$`. 크기 상한 64 MiB(base64 전)
- 셸 스크립트(`android-shell.js`) — `MyLearner.platform = {kind: 'android', save(name, bytes, mime) → Promise, share(…) → Promise, openExternal(url), done(…)}`. 바이트는 base64 로 다리에 넘긴다. `a[href^="http"]` 누름을 가로채 `confirm('휴대폰의 브라우저로 엽니다 …')` 후 `openExternal`. 자바 `shouldOverrideUrlLoading` 도 이 앱 주소 밖은 막는다(사용자가 누른 `http(s)` 만 물어서 넘김)
- 화면 쪽 훅: `ui.download(name, data, type)` 은 `MyLearner.platform.save` 가 있으면 그것을, 없으면 지금처럼 blob 내려받기. 설정의 내보내기는 `platform.share` 가 있으면 '공유' 단추를 더 보인다. 판 분기가 아니라 플랫폼 훅이다(저장 어댑터와 같은 DIP)

### 3.3 안드로이드 저장 어댑터 (FR-410~412)

**자바 `Kv`** — 루트 `getFilesDir()/kv/`

| 규칙 | 값 |
|---|---|
| 이름 | `^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$` 이고 `.tmp` 로 끝나지 않는다(`Kv.nameOk`). 틀리면 쓰기·읽기 모두 거부 |
| 쓰기 | `<name>.<난수>.tmp` 에 UTF-8 로 쓰고 `FileOutputStream.getFD().sync()` → `File.renameTo(<name>)`(같은 폴더 — 원자적) → 폴더 `FileChannel.force(true)`(되면). 실패하면 임시 파일을 지우고 오류 글 |
| 읽기 | 없으면 `null`. 켤 때 남은 `*.tmp` 는 지운다(쓰다 죽은 것 — 원본은 그대로) |
| 상한 | 값 하나 64 MiB(UTF-16 글자 수 기준 32M) |

**JS `store/android.js`** — `create({bridge, random, now})` 는 다리를 두 꼴로 감싸 `storeBrowser.create({ls, kv, random, now})` 를 부르고 `kind`·`init` 의 `where` 만 바꾼다.

| 감싼 꼴 | 다리 이름 | 비고 |
|---|---|---|
| `ls.getItem(k)`·`setItem(k, v)`·`removeItem(k)` | `ls.<k>`(예 `ls.mylearner.log.2026-11`) | `setItem` 이 오류 글을 받으면 던진다(브라우저의 용량 초과처럼 — 화면이 '저장 실패' 띠와 다시 보내기로) |
| `ls.length`·`ls.key(i)` | `kvList('ls.')` | `length` 를 읽을 때 목록을 새로 받고 `key(i)` 는 그 목록 |
| `kv.get(store, key)`·`put`·`del`·`keys(store)` | `kv.<store>.<key>`(예 `kv.backups.20261110T…Z-daily`) | 값은 JSON 글. 약속(Promise)으로 돌려준다 |

- 기록은 브라우저 모드와 같은 달별 키(`mylearner.log.YYYY-MM`)라 덧붙이기 한 번에 다시 쓰는 양은 그달 것뿐이다. 하루 백업·순번 하한(`mylearner.seq`)·기기 ID 도 같은 규칙으로 파일에 남는다
- 앱 안 WebView 는 하나라 쓰는 탭 임대는 늘 '내 것'이다. 임대·저장 못 한 줄(`mylearner.pending.*`)·화면 설정은 WebView localStorage 에 둔다(잃어도 기록은 파일에 있다)
- `state.js chooseStore`: `root.MyLearnerAndroid` 와 `ns.storeAndroid` 가 있으면 안드로이드 어댑터를 먼저 고른다(서버 확인 없이)

### 3.4 교환 파일 (FR-420~424)

```
mylearner-exchange-<학습일>-<기기 앞 6자리>.zip   (항목 순서 고정 · 저장 방식 · 시각 1980-01-01 00:00 · 이름 UTF-8 표시)
  manifest.json      {"format":"mylearner-exchange","version":1,"min_reader":1,
                      "app":{"name":"mylearner","version":"0.4.0","edition":"mobile","label":"모바일판"},
                      "dev":"<이 기기>","made_at":"<UTC>","day":"<학습일>",
                      "files":[{"path":"log.jsonl","bytes":N,"sha256":"…","lines":N},{"path":"courses/mwl-notes.json","bytes":N,"sha256":"…"}]}
  log.jsonl          mylearner-log v1 — log.writeFile(log.merge([사건 줄, 해석하지 못한 줄]))
  courses/<id>.json  사용자 과정(canonical JSON — 키 정렬). 묶음 과정은 넣지 않는다
```

`web/core/zip.js`:

| 함수 | 입력 → 출력 |
|---|---|
| `crc32(bytes)` | 정수(부호 없음) |
| `write([{name, bytes}])` | `Uint8Array` — 지역 머리 + 자료 + 중앙 디렉터리 + 끝 레코드. 방식 0(저장), 플래그 0x0800(UTF-8 이름), 시각 고정 → 같은 입력 = 같은 바이트 |
| `list(bytes, limits)` | `{ok, error, entries: [{name, method, size, csize, crc, offset}]}` — 끝 레코드를 뒤 64 KiB + 22 바이트에서 찾고 중앙 디렉터리를 읽는다. 거부: 끝 레코드 없음·여러 디스크·zip64(`0xFFFFFFFF`)·암호(플래그 비트 0)·방식 0·8 밖·이름의 `/` 시작·`..`·`\`·NUL·한도 초과 |
| `extract(bytes, entry, inflateRaw)` | `Promise<Uint8Array>` — 지역 머리를 다시 읽어 자료 위치를 찾고, 방식 8 이면 주입받은 `inflateRaw(압축 바이트, 상한)`, 크기·CRC 가 다르면 거부 |

한도(`zip.LIMITS`): 파일 256 MiB, 항목 1,000, 항목 하나 풀린 크기 256 MiB, 모두 풀린 크기 512 MiB. `inflateRaw` 는 브라우저에서 `DecompressionStream('deflate-raw')` 를 읽으며 상한을 넘으면 끊는다(화면 `merge_view.js`), Node 시험은 `zlib.inflateRawSync`(`maxOutputLength`).

`web/core/exchange.js`:

| 함수 | 입력 → 출력 |
|---|---|
| `build({lines, raw, courses, app, dev, now, dayStartHour})` | `{name, bytes, manifest}` — `now` 를 주입받는다(같은 입력 = 같은 바이트) |
| `sniff(bytes)` | `'zip'` · `'log'`(첫 줄이 `mylearner-log` 머리) · `'mwl'`(JSON 이고 MWL 진도 꼴 — `schema`·`cards` 키) · `'unknown'` |
| `open(bytes, {inflateRaw})` | `Promise<{ok, error, kind, manifest, lines, courses: [{id, obj, error}]}>` — `kind` 가 `log` 면 `log.readFile`. `zip` 이면 `manifest.json` → 형식·`min_reader` → 적힌 파일마다 크기·SHA-256 대조 → `log.jsonl` 은 `log.readFile`, `courses/*.json` 은 JSON(검사는 화면이 `course.validate`) |

오류 코드: `E-FILE-KIND`(모르는 파일) · `E-FILE-MWL`(MWL 진도 — MWL 들여오기로) · `E-ZIP`(구조) · `E-ZIP-LIMIT` · `E-ZIP-METHOD`(암호·zip64·모르는 압축) · `E-EX-FORMAT` · `E-EX-READER` · `E-EX-MISSING <경로>` · `E-EX-HASH <경로>` · `E-LOG-FORMAT`·`E-LOG-READER` · `E-LINE-LONG`(64 KiB 넘는 줄 — 저장소가 받지 않는다) · `E-UTF8`

### 3.5 합치기 — `web/core/merge.js` (FR-430~435)

| 함수 | 입력 → 출력 |
|---|---|
| `keyOf(line)` | 사건이면 정규형, 아니면 앞뒤 빈칸 뗀 글(`log.parseLine`) — 저장소와 같은 '같은 줄' |
| `preview({have, file, today, isOwn, known})` | `have`·`file` = 줄 배열. 결과 `{total, fresh, freshLines, devices: [{dev, own, total, fresh, first_day, last_day, clock}], courses: [{course, reviews, lessons, other}], conflicts_new, unknown, bad, newer, future}` |
| `present(haveAfter, file)` | `{present, total}` — 파일의 줄(키)마다 기록에 있는지(N/N) |
| `restorePlan({onlyCurrent, onlyBackup, isOwn})` | `{remove: [줄], keep_own, add: onlyBackup, by_dev: [{dev, remove}]}` — `onlyCurrent` 가운데 이 기기 사건이 아닌 것(해석하지 못한 줄 포함)이 `remove` |
| `reminderDays({exportedAt, firstOwnT, now, days})` | 띠를 띄울 날 수 또는 `null` |

- `fresh` = 파일의 키 가운데 `have` 에 없는 것(파일 안 중복은 하나). 덧붙일 때는 키 꼴(정규형)로 보낸다 — 앱이 쓰는 줄과 같은 글이라 저장소 합집합이 그대로 통한다
- `devices[].clock`: 합친 뒤 그 기기의 학습일 가운데 `today + 1` 보다 뒤가 있으면 `'ahead'`, 순번을 따라 학습일이 줄어드는 곳이 있으면 `'back'`, 아니면 `'ok'`(P2 설계서 3.4절 8·13)
- `courses[]`: 새 사건을 `data.course`(없으면 `-`)로 묶고 `review`·`lesson`·그 밖을 센다
- `conflicts_new` = `merge([have, fresh]).counts.conflicts − merge([have]).counts.conflicts`. `unknown` = 새 사건 가운데 `known`(다시 계산이 아는 종류 — `replay.KNOWN`)에 없는 종류. `bad`·`newer` = 새 해석하지 못한 줄. `future` = 새 사건 가운데 학습일 > `today + 1`
- `isOwn(dev)`: 이 기기 = `dev == 기기 바탕` 또는 `dev` 가 `기기 바탕 + '-'` 로 시작(서버 모드는 브라우저마다 꼬리가 붙는다 — P3 설계서 3.2절)
- 사용자 과정 판정(화면): `course.validate` 실패 → `invalid`, 묶음 과정과 ID 같음 → `bundled`(싣지 않음), 지금 없음 → `new`(저장), 정규형이 같음 → `same`, 다름 → `diff`(지금 것을 둔다 — Phase 5)

화면 흐름(`merge_view.js` — 상태를 바꾸는 것은 단추와 `confirm` 뿐):

```
#/import/merge  [파일 고르기] → 읽는 중 → (오류: 코드와 풀이 · 다른 파일 고르기)
                → 미리보기 표 넷(파일 · 기기 · 과정 · 사용자 과정) + 주의(충돌·모르는 종류·미래·시계 확인)
                → [백업하고 합치기] confirm → flush → backup('import-merge') → append(freshLines) → saveCourse(new) → loadCourses → reloadLog
                → 결과: 더한 줄 · 파일의 줄 N/N 이 기록에 있음 · 새 충돌 · [이 들여오기 되돌리기](#/restore/<그 백업>)
```

### 3.6 되살리기 (FR-440~443)

저장 어댑터에 둘을 더한다(세 어댑터 같은 약속):

```
store.backupDiff(name) → Promise<{onlyCurrent: [줄], onlyBackup: 수}>   지금 기록에만 있는 줄(글 그대로)과 백업에만 있는 줄의 수
store.restore(name, remove) → Promise<{removed, added, backup}>        지금 기록을 백업(까닭 'restore') → (지금 − remove) ∪ 백업 줄 → 원자적으로 쓴다
```

- 결과 = `(지금 − remove) ∪ 백업` 이고 `remove` 는 `restorePlan` 이 고른 '백업에 없는 다른 기기 줄'이다 → **백업 ∪ 이 기기 줄** 이 남는다. `remove` 에 백업에 있는 줄이 섞여 와도 백업 줄이 다시 들어간다(합집합이 마지막)
- 서버는 줄을 해석하지 않고 집합 연산만 한다. 백업 글은 서버 밖으로 내지 않는다 — `backupDiff` 는 지금 기록의 줄(이미 `GET /api/log` 로 읽는 것)과 수만 준다. 그래서 폐쇄망판도 되살리기를 쓰고 백업 내려받기는 지금처럼 막힌다(FR-451)
- 되살리기 전 백업(`restore`)을 다시 되살리면 직전 상태로 돌아간다(그 백업에만 있는 줄이 다시 들어온다 — FR-442)
- 미리보기: 뺄 줄 수(기기마다), 되돌아올 줄 수(`onlyBackup`), 남기는 이 기기 줄 수, 그 뒤 들여오기 수(백업 목록에서 이 백업보다 새 `import-*`)
- 백업 남기기(`KEEP`): `import-mwl` 20 · `import-merge` 20 · `restore` 10 · `daily` 14(JS `store/common.js`·Python `storage.py` 같은 표, 시험이 같은지 본다)

서버 API(더하기 — 쓰기는 지금처럼 `Content-Type`·`Origin` 검사, 토큰 필요):

| 경로 | 방식 | 요청 → 응답 |
|---|---|---|
| `/api/backups/<이름>/diff` | GET | `{"only_current": [...], "only_backup": N}` — 두 판 모두 |
| `/api/backups/<이름>/restore` | POST | `{"remove": [...]}` → `{ok, removed, added, backup, total}` — 두 판 모두. 한도는 덧붙이기와 같음 |

### 3.7 화면 (FR-413·430·440·461)

| 주소·자리 | 무엇 | 상태를 바꾸나 |
|---|---|---|
| `#/import/merge` | 합치기(3.5) | [백업하고 합치기] + 확인으로만 |
| `#/restore/<백업 이름>` | 되살리기 미리보기 → [백업하고 되살리기] | 단추 + 확인으로만. 주소만으로 열면 미리보기까지 |
| 설정 → 기록 | 교환 파일 내보내기(판 설정 `export` — 폰은 '파일로 저장'·'공유'), '다른 기기 기록 합치기', 백업 표에 '되살리기'(들여오기 전 백업은 '이 들여오기 되돌리기') | 단추로만 |
| 설정 → 이 앱 | 판·앱 판·과정 수·화면 폭(`innerWidth` px — 체크리스트 피드백용) | 아니오 |
| 오늘 위 띠 | `merge.reminderDays` 가 값이면 '마지막 내보내기 N일 전 — 앱을 지우면 기록도 지워집니다 [내보내기]' | 아니오 |

- 마지막 내보내기 시각은 `localStorage['mylearner.exported']`(ISO)에 둔다 — 알림용이라 잃어도 기록과 상관없다
- 폰 폭(FR-461): 화면 확인 폭 — 폰 390(Phase 3), **폴드5 접은 화면 344**, **펼친 화면 690**. 값은 기기 사양(덮개 904×2316 px·402 ppi, 본 화면 1812×2176 px·374 ppi — 삼성 사양표)을 흔한 밀도(420 dpi = 2.625배)로 나눈 추정이다 ⚠️ — 실제 폭은 설정 → 이 앱의 '화면 폭' 을 체크리스트 피드백으로 받아 고친다. S22 울트라(기본 1080 px 폭)는 390 근처라 390 으로 본다 ⚠️

### 3.8 묶음·빌드 (FR-408·450·452)

- `pack_app.py --edition closed`: `.tgz` 와 `.zip`(인터넷판과 같은 ZIP 규칙 — 시각 고정·`ZIP_DEFLATED`). `--check` 는 두 판 × 두 꼴을 두 번 만들어 비교하고 폐쇄망판 두 꼴 모두 외부 URL·내보내기·프리셋을 본다
- `pack_app.py --edition mobile --web-out <폴더>`: `<폴더>/web/` 에 묶음과 같은 web 사본(모바일판 `config.js` + `data/`). 서버 코드·`MyLearner.cmd` 는 넣지 않는다
- `scripts/build_android.sh [--courses 파일…] [--test-key] [--debuggable] [--repro] [--out 폴더]`
  1. 과정 파일(기본 `dist/courses/*.course.json`) → `pack_app.py --edition mobile --web-out` → `mobile/android/tools/pack.py stage`(셸 한 줄)
  2. 컨테이너(`ANDROID_IMAGE`, `--network none`, 저장소 읽기 전용): `docker-build.sh compile` — `PolicyTest`·`KvTest`(JVM) → aapt2 compile·link(`--debug-mode` 는 `--debuggable` 일 때만) → javac(원본 8, `android.jar` + `core-lambda-stubs.jar`) → d8
  3. `pack.py add-dex`(시각 고정·무압축) → `docker-build.sh sign`: zipalign → apksigner(v2·v3) → verify → `aapt2 dump badging`·`permissions`
  4. 점검(실패하면 종료 코드 1): 패키지·판·SDK, **권한 0**, 디버그 표시(`--debuggable` 일 때만 있음), exported 구성요소 = 런처 하나
  5. `--repro`: 1~3 을 두 번 해 서명 전·후 APK 바이트 비교
- 서명 키: `~/.config/mylearner/android-release.jks`·`android-release.pass`(600, 별칭 `mylearner`, `CN=MyLearningPlatform`). 없으면 `--init-key` 로 한 번 만들고 사본을 이 계정의 `/data` 개인 폴더 `keys/mylearner/`(700)에 둔다. `--test-key` 는 실행 때 임시 폴더에 새 키를 만들고 끝나면 지운다(Actions·에뮬레이터 시험용)
- 산출물: `dist/android/MyLearningPlatform-v<판>.apk`(릴리스), `dist/android/MyLearningPlatform-v<판>-test.apk`(시험 키·디버그)

### 3.9 CI — GitHub Actions (FR-470~473)

공통: `permissions: contents: read`, 이벤트 `push`(`main`·`impl-phase*`)·`workflow_dispatch`, 액션은 커밋 SHA(아래 표 — 2026-11-10 `gh api repos/<액션>/commits/<태그>`), `actions/checkout` 은 `persist-credentials: false`, artifact `retention-days: 7`.

| 액션 | 태그 | 커밋 |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-python` | v7.1.0 | `6d4fd22b20465ccc0f7354476588e8df7c9ca0e0` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

**`windows-bundle.yml`** — `runs-on: windows-2025`, 판 `3.9`·`3.14` 두 갈래

1. checkout → setup-python(그 판) → `python scripts/ci_windows_bundle.py --python <판>`
2. 스크립트: `pack_app.py --edition closed --courses tests/fixtures/courses/sample.course.json --out <임시>` → zip 을 PowerShell `Expand-Archive` 로 풂 → `cmd /c "chcp 949 >nul & MyLearner.cmd --no-browser --port 8781"`(환경 `PY_PYTHON3=<판>` — `py -3` 이 그 판을 고르게, 표준 입력은 비움 — 끝의 `pause` 가 멈추지 않게) → 출력 첫 줄에서 주소·토큰(바이트를 cp949 로 엄격히 풀 수 있어야 함) → `/api/health` · `/?token=` 쿠키 · `POST /api/log` 한 줄 → `taskkill /T /F` → 다시 켬 → `GET /api/log` 에 그 줄 → `/api/backups/<이름>` 404(폐쇄망판)
3. 결과 표를 표준 출력에(토큰·경로는 가린다)

**`android-emulator.yml`** — `runs-on: ubuntu-24.04`, `timeout-minutes: 50`

1. checkout → KVM 켜기(GitHub changelog 2024-04-02 의 udev 규칙: `KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"` → `udevadm control --reload-rules` → `udevadm trigger --name-match=kvm`)
2. `bash scripts/build_android.sh --courses tests/fixtures/courses/sample.course.json --test-key --debuggable`
3. `python3 mobile/android/e2e/emulator_test.py dist/android/MyLearningPlatform-v<판>-test.apk <캡처 폴더> --fetch` — 시스템 이미지(`system-images;android-36;google_apis;x86_64`)를 컨테이너 안 `sdkmanager` 로 받는 단계만 네트워크를 쓰고, 에뮬레이터는 `--network none` + `--device /dev/kvm`
4. 캡처·보고서를 artifact(7일). 기록 내용·토큰은 싣지 않는다

KVM 근거: GitHub changelog 2024-04-02 "2-vCPU GitHub-hosted Linux runners will be able to make use of hardware acceleration for Android testing" — 리눅스는 러너 사용자가 KVM 을 쓰게 해야 한다(위 udev 규칙). 실제로 되는지는 첫 실행으로 확인한다 ⚠️

**`scripts/check_workflows.py`**(전체 검증): `.github/workflows/*.yml` 마다 — 맨 위 `permissions:` 아래 `contents: read` 만, `pull_request_target`·`workflow_run` 없음, 모든 `uses:` 가 `@<40자리 16진>`, `secrets.` 참조 0, `run:` 안 `${{ github.event.` 0(주입), `actions/checkout` 에 `persist-credentials: false`, `upload-artifact` 에 `retention-days`. YAML 해석 없이 줄 단위로 본다(PyYAML 없이 3.9~3.14)

### 3.10 시험

| 무엇 | 어떻게 |
|---|---|
| zip·교환 파일·합치기(A) | `zip.test.js`(CRC 기대값·쓰기→읽기·deflate 항목(Node zlib 로 만든 zip)·거부 사례 12가지), `exchange.test.js`(같은 입력 = 같은 바이트·해시 깨짐·모르는 판·MWL 진도·기록 파일), `merge.test.js`(미리보기 칸마다·멱등·되살리기 계획·알림 날 수) — 시험 먼저 |
| 기록 유실 0(속성, NFR-402) | `property.test.js` 에 기기 셋 무작위 시나리오 — 각 기기는 브라우저 어댑터(가짜 저장소), 주고받기는 `exchange.build` → 바이트 → `exchange.open` → `merge.preview` → `append`. 되살리기를 섞은 경우는 '뺀 줄이 직전 백업에 있다'를 본다 |
| 명령 단위(NFR-402) | `scripts/check_log_roundtrip.js` 를 교환 파일(zip)로 — 실제 파일을 쓰고 읽는다 + 실제 로컬 서버에 `restore`·`diff` 를 부르는 통합 시험(`test_server.py`) |
| 안드로이드 어댑터(B) | `store_android.test.js` — 가짜 다리(메모리 파일 KV, 오류 글 주입)로 Phase 3 어댑터 시험과 같은 약속 |
| 서버·저장(B) | `test_storage.py`(`backup_diff`·`restore`·`KEEP` 표 JS 와 같음), `test_server.py`(두 API·폐쇄망판 백업 내려받기 404 그대로) |
| 자바(A) | `PolicyTest`(주소·뒤로·고른 주소·파일 이름·CSP), `KvTest`(이름·원자적 쓰기·남은 임시 파일·목록) — 빌드마다 먼저 |
| 화면(C) | `app_check.js` 에 합치기(내보낸 교환 파일 → 다른 프로필에 들여오기 → N/N → 같은 파일 다시 → 새 줄 0 → 되돌리기)·되살리기·내보내기 알림 띠, 폰 폭 344·390·690 넘침·누름 44px, 접근성. 셸 스크립트는 가짜 다리를 심어 저장·공유·바깥 링크 |
| 날짜 넘김 | 화면 스모크가 페이지 시계를 23:58 → 다음 날로 옮겨 `checkDay` 가 새로 읽는지(P3 테스트결과서 8절에서 넘어옴) |
| APK | `build_android.sh` 의 점검(권한 0·exported 1·디버그 표시), `--repro` |
| 에뮬레이터(C) | `emulator_test.py` — 설치·판·권한 0, 비행기 모드 첫 화면, 강의 마침·복습, 채점 0.1초 뒤 강제 종료 → 다시 켜도 그 사건(디버그 빌드의 `run-as` 로 `files/kv/` 를 읽어 확인), 뒤로 가기(오늘에서 닫힘), 회전, 교환 파일 '파일로 저장' → 다운로드 폴더 파일의 머리·줄 수 |

## 4. 오류 처리

| 상황 | 처리 |
|---|---|
| 교환 파일이 깨짐·모르는 판 | 미리보기 대신 오류 코드와 풀이, 아무것도 쓰지 않는다 |
| 합치기 중 백업 실패 | 덧붙이지 않는다(P3 FR-324 와 같음) |
| 덧붙이기 중 실패 | 다시 읽어 화면을 맞추고 '같은 파일로 다시 하면 빠진 것만 더한다'(FR-435) |
| 되살리기 중 실패 | 서버·파일은 원자적 쓰기라 바뀌기 전 그대로이거나 다 바뀐 것뿐 — 다시 읽어 보인다 |
| 다리 `kvPut` 실패(저장 공간 없음) | `setItem` 이 던져 Phase 3 의 '저장 실패' 흐름(메모리·탭 키에 남김, 다시 보냄) |
| 폰 저장 창을 취소 | `done('save', false, '취소')` → 띠 '저장하지 않았습니다' |

## 5. 요구사항 → 코드 · 시험

| FR | 코드 | 시험 |
|---|---|---|
| 401·402·403·404·405·406 | `mobile/android/`(Manifest·`MainActivity`·`Policy`·셸) | `PolicyTest`, `build_android.sh` 점검, `emulator_test.py`, `app_check.js`(셸 가짜 다리) |
| 407·408 | `scripts/build_android.sh`, `mobile/android/tools/` | `--repro`, 점검 단계 |
| 409 | `config/editions/mobile.json`, `pack_app.py` | `test_pack_app.py` |
| 410~412 | `web/store/android.js`, `Kv.java`, `state.js` | `store_android.test.js`, `KvTest`, `emulator_test.py`(강제 종료) |
| 413 | `merge.reminderDays`, `merge_view.js` | `merge.test.js`, `app_check.js` |
| 420~424 | `web/core/zip.js`·`exchange.js`, `merge_view.js` | `zip.test.js`, `exchange.test.js`, `app_check.js` |
| 430~436 | `web/core/merge.js`, `merge_view.js`, `settings_view.js` | `merge.test.js`, `property.test.js`, `app_check.js` |
| 440~443 | `merge.restorePlan`, `store/*.js`, `storage.py`·`server.py` | `merge.test.js`, `store_common.test.js`, `store_adapters.test.js`, `test_storage.py`, `test_server.py`, `app_check.js` |
| 450~452 | `pack_app.py`, `config/bundle/README_KO.txt` | `test_pack_app.py`, 전체 검증 '앱 묶음' |
| 460~462 | `web/styles.css`(좁은 화면), 셸 `setBars` | `app_check.js`(폭 셋), 에뮬레이터 캡처 |
| 470~473 | `.github/workflows/`, `scripts/ci_windows_bundle.py`, `scripts/check_workflows.py` | Actions 실행, `test_verify_tools*.py`(검사기) |
| 480·481 | CLAUDE.md 7절 '릴리스' | 받아 `sha256sum -c` |

## 6. 아직 정하지 않은 것

| 무엇 | 언제 |
|---|---|
| 폴드5·S22 울트라의 실제 화면 폭(지금은 추정 344·690·390) | 체크리스트 피드백(설정 → 이 앱 '화면 폭') |
| 공유받기('이 앱으로 열기') | 피드백이 오면 Phase 7 |
| 같은 ID 사용자 과정의 항목 합치기 | Phase 5 |
| GitHub 앱에서 Release 파일이 받아지는지 | 사용자(CLAUDE.md 7절 ⚠️) |
| 보류 결정 7(브라우저 저장 방식) 확정 | 보류 결정 8 결과가 올 때 |
