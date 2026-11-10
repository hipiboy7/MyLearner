# 2026-11-10 — Phase 4(폰에서 배우기 + 합치기) 요구사항·설계·구현·에뮬레이터 시험

- 작업자: Claude Opus 5.5(effort xhigh — 환경 변수) / 브랜치: `impl-phase4` / 이전 세션: [`2026-11-10_claude-opus_p4-start.md`](2026-11-10_claude-opus_p4-start.md)(`/clear` 뒤 새 대화, 사용자 지시 "다음 단계 3번(P4 요구사항정의서)부터")

## 1. 한 일

- 세션 시작 점검: `check_env.sh` → `READY`, `verify.sh` → 20단계 통과. 사용자가 effort 를 먼저 물어 xhigh(환경 변수 그대로)를 권했다
- 외부 사실 확인: GitHub changelog 2024-04-02(2-vCPU 이상 Linux 호스티드 러너 KVM — udev 규칙), 폴드5 화면 사양(삼성 — 덮개 904×2316·402 ppi, 본 화면 1812×2176·374 ppi. dp 폭은 공식 값이 없어 추정 344·690 ⚠️), 액션 최신 태그의 커밋 SHA(`gh api`)
- 문서: [`docs/P4_요구사항정의서_Mobile.md`](../docs/P4_요구사항정의서_Mobile.md)(FR-401~481·NFR-401~408) → [`docs/P4_설계서_Mobile.md`](../docs/P4_설계서_Mobile.md) → 커밋 `8a82528`
- 코드(커밋 `59a4e6d`·`597b1f9` + 이 커밋):
  - `web/core/zip.js`·`exchange.js`·`merge.js`(교환 파일·합치기 미리보기·N/N·되살리기 계획·알림), `replay.KNOWN`
  - 저장 어댑터 `backupDiff`·`restore`(브라우저·서버·안드로이드), `web/store/android.js`(다리의 파일 KV → 브라우저 어댑터, `singleWriter`), 서버 API `/api/backups/<이름>/diff`·`/restore`(백업 글은 내주지 않는다), 백업 까닭 표(JS·Python 같음)
  - 화면 `web/app/merge_view.js`(합치기·되살리기·내보내기·알림 띠), 설정의 주고받기·백업 되살리기·화면 폭, 손가락 화면 키보드 안내 숨김, 넓은 표 `.table-wrap`, 40~60rem 메뉴 여러 줄
  - `mobile/android/`(MainActivity·Policy·Kv·ShareProvider·셸·리소스·조립 도구·에뮬레이터 시험), `scripts/build_android.sh`, 모바일판 설정, 폐쇄망 zip, 판 0.4.0
  - CI: `.github/workflows/windows-bundle.yml`·`android-emulator.yml`, `scripts/check_workflows.py`·`ci_windows_bundle.py`, 전체 검증 20~22단계
- **릴리스 서명 키를 만들었다**(보류 결정 3): 원본 이 계정 `~/.config/mylearner/`(600), 사본 이 계정 `/data` 개인 폴더 `keys/mylearner/`(700·600, `cmp` 같음). 서명 인증서 SHA-256 `7589128ce39f53ef32dfffa269405d8c07d625248273a23b50ce6d25e0a9b18c`. **VM 밖 한 부는 사용자가 보관해야 한다**(체크리스트 1절)
- 에뮬레이터 시스템 이미지 `system-images;android-36;default;x86_64` 를 받았다(받기 전 `df -h /data` 31G — Docker 볼륨 `mylearner-android-<uid>` 2.05 GB). 에뮬레이터 시험 24건 통과(강제 종료 뒤 남음·시스템 저장 창으로 교환 파일·회전·뒤로 가기)
- 시험·화면에서 찾아 고친 것: 에뮬레이터 세그폴트(T-012), BOM 날 글자(T-013), 강제 종료 뒤 읽기 전용 띠(T-014), 폴드 폭에서 표 잘림·메뉴 숨음(시험 도구가 놓치던 것까지 — 테스트결과서 7절)
- 이어서(사용자 답 "1 push 해, 2 독립 점검 해, 3 테스트도 red·green·blue 다 했어?"): `impl-phase4` push → Actions 첫 실행 — 에뮬레이터 통과(KVM·24건), Windows 묶음 실기는 시험 도구가 러너 콘솔(cp1252)에서 죽음(T-015 고침, 21단계를 cp1252 로). TDD 사후 점검 — Red·Refactor 를 다 지키지 않았음을 대화 기록으로 확인해 7절 11 을 바로잡고, 변이 시험(25개 중 21 잡음)·경계 시험 3건·리팩터(`merge`·`exchange`·`zip`, 전후 2,100건 같음)를 했다(테스트결과서 7.1절). 독립 점검 sonnet 1개 시작
- 사람용 문서: [`docs/P4_테스트결과서_Mobile.md`](../docs/P4_테스트결과서_Mobile.md), [`docs/P4_체크리스트_Mobile.md`](../docs/P4_체크리스트_Mobile.md), README, 트러블슈팅 T-012~014, Architecture, CLAUDE.md 0절 디스크, 스크린샷 `docs/screenshots/P4/`

## 2. 검증 상태

- `bash scripts/verify.sh`(23단계) — 이 커밋 직전에 돌려 통과한 뒤 커밋한다. JS 182건·Python 275건·자바 150건·에뮬레이터 24건(따로)·묶음 실기 13건
- 아직 없는 것: Windows 묶음 실기 Actions 통과(T-015 고친 커밋의 실행), 독립 점검 결과 — 아래 3절 1·2

## 3. 다음 단계

1. Actions: 에뮬레이터는 통과(테스트결과서 1.6절). T-015 고친 커밋의 `windows-bundle`(3.9·3.14) 결과를 1.6절에 — `gh run list --repo hipiboy7/MyLearner --limit 4`. 실패하면 고친다(러너 Python 판은 바꾸지 말고 사용자에게 묻는다)
2. 독립 점검(CLAUDE.md 12절, 2026-11-10 사용자 허락 — sonnet 1개) — 합치기·되살리기(유실)·교환 파일 zip 입력·안드로이드 다리. 지적은 원문으로 확인한 뒤 반영, 테스트결과서 5.2절
3. 사용자: 서명 키 두 파일의 VM 밖 사본(체크리스트 1절)
4. Phase 4 병합 요청이 오면: 전체 검증 → history → 병합 → push → 릴리스 `v0.4.0`(APK·폐쇄망 zip·`.tgz`·인터넷판·점검 묶음 — CLAUDE.md 7절. APK 는 태그 커밋에서 `bash scripts/build_android.sh` 로 다시)
5. 체크리스트 피드백 — 폴드5·S22 의 실제 화면 폭(설정 → 이 앱)이 오면 `scripts/app_smoke.py` `PHONE_WIDTHS` 와 설계서 3.7절을 고친다. GitHub 앱에서 Release 가 받아지면 CLAUDE.md 7절 ⚠️ 를 지운다
6. 보류 결정 8(폐쇄망 점검)이 오면 보류 결정 7 확정(변함없음)
7. private 로 되돌릴 때(보류 결정 10): 워크플로를 끄거나 줄이고 CLAUDE.md 0·7·11절을 되돌린다

## 4. 판단·관찰

- 되살리기는 '줄을 빼는' 유일한 동작이다 — 결과를 `(지금 − 뺄 줄) ∪ 백업` 으로 정해, 뺀 줄은 늘 직전 백업에 있고 그 백업을 되살리면 돌아오게 했다. 서버는 줄을 해석하지 않고 백업 글을 밖에 내지 않는다(폐쇄망판도 되살리기를 쓴다)
- 모바일 에뮬레이션(CDP `mobile: true`)은 넓은 내용에 맞춰 레이아웃 폭을 늘려, `innerWidth` 와 비교한 넘침 검사가 늘 통과했다 — 스크린샷을 직접 보고 찾았다. 검사는 정한 폭과 비교한다
- 다른 프로젝트의 시제품을 옮길 때 실행 옵션의 주석(MWL 의 `swangle_indirect` 이유)까지 읽었으면 세그폴트 진단 30분을 아꼈다
- 비용: `python3 scripts/usage_cost.py --record` — 기준점 뒤 누적 $196.88(이 세션 추정 $29.94, 16:24)
