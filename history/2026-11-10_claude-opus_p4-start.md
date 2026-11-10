# 2026-11-10 — Phase 4(폰에서 배우기 + 합치기) 착수 · 첫 릴리스 `v0.3.0` · P4 인터뷰

- 작업자: Claude Opus 5.5(effort xhigh — 환경 변수) / 브랜치: `main` → `impl-phase4` / 이전 세션: [`2026-11-10_claude-opus_p3-merge.md`](2026-11-10_claude-opus_p3-merge.md)

## 1. 한 일

- 세션 시작 점검(CLAUDE.md 0-1절): `bash scripts/check_env.sh` → `READY`(안드로이드 빌드 이미지 포함), `bash scripts/verify.sh` → 20단계 통과. 보류 결정 3 이 트리거
- 사전 조사(읽기만): MWL 안드로이드 시제품은 이제 MWL `main` 의 `mobile/android/`·`scripts/build_android.sh` 에 있다(BRIEF 4.1 의 브랜치 `feat-android-app` 은 병합 뒤 지워짐). 패키지 `io.github.hipiboy7.mwl`, 서명 키는 이 계정 홈 `~/.config/mwl/`(저장소 밖). 빌드 이미지 `ANDROID_IMAGE` 에 에뮬레이터 실행 파일은 있고 시스템 이미지는 없다. `/dev/kvm` 있음
- Phase 4 인터뷰 질문 7개와 기본값을 한 번에 물었고 답을 받았다 → [`docs/P4_인터뷰결과서_Mobile.md`](../docs/P4_인터뷰결과서_Mobile.md)
- 사용자 지시 "앞으로 릴리즈했을 때 github app 에서 다운로드 받을 수 있게 절차를 claude.md 에 설정해, 지금 당장" → CLAUDE.md 7절 '릴리스 — 폰의 GitHub 앱에서 받기'(6단계), 1절 9단계 종료 루틴에 릴리스, 11절 사람 확인에 Release 올리기
  - 처음에는 "비공개 Release 는 GitHub 앱에서 받히지 않는다"고 추정해(로그인 없는 `curl` → `404` 만 보고) 공개 받는 곳 저장소를 물었다. 사용자 뜻은 "GitHub 앱 로그인 → 저장소 → MyLearner → 릴리스에 올라가는 것"이었다 → 받는 곳을 이 저장소(private) Release 로 고치고 보류 결정 9 를 닫았다. 추정을 사실처럼 쓴 문장은 지웠다
- **첫 릴리스 `v0.3.0`**(Phase 3 묶음) — https://github.com/hipiboy7/MyLearner/releases/tag/v0.3.0 , 태그 → `main` `d2e992a`. README 명령대로 다시 만들었다: 과정 파일 3개는 11-09 빌드와 같은 바이트, 묶음 셋은 11-09 15:45 빌드와 다르다(그 뒤 독립 점검 반영 커밋이 들어갔기 때문 — `main` 과 묶음 입력 차이 0)

| 파일 | 바이트 | SHA-256 |
|---|---|---|
| `mylearner-internet-v0.3.0.zip` | 2407810 | `97e82e06629ea1ebefd51ab7de65a9ba416d782a3c526439b8ab78294a9a5fc9` |
| `mylearner-internet-v0.3.0.tgz` | 2373331 | `7abd3ca7d5f28209637aa3976eeb0e7cc0b769c32b1cd1ac21aecf343d3eef12` |
| `mylearner-closed-v0.3.0.tgz` | 2373284 | `4e68f58ac2a67e099138b1ad5f576036bcf937bdf9493c0ba4cafdeb5fcc0b3c` |
| `mylearner-probe-v1.tgz` | 34694 | `9193c63e104e16734b5ec6009e26f4aab680f0b879065e45df178cd5aa670263` |

  - 확인: `gh release view` 다섯 파일 `uploaded` · pre-release 아님 · `gh release download` 뒤 `sha256sum -c SHA256SUMS.txt` 넷 다 `OK` · 로그인 없는 `curl` → `404`(비공개 — 예상대로)
- P4 인터뷰 결과를 CLAUDE.md 0절(폐쇄망 zip 반입·폰 기종)·보류 결정 3·7·11절, scope 9·11절, Architecture 8절, P3 체크리스트 2·4절(릴리스에서 받기)에 반영했다
- **저장소 public 전환**(사용자 결정 — "작업 완료될때까지 public으로 작업하고 다시 private으로", 이유 "Actions 분 수 · artifact 한도") → 문답은 [`docs/P4_인터뷰결과서_Mobile.md`](../docs/P4_인터뷰결과서_Mobile.md) 5절. 순서: CLAUDE.md 0·7·11절의 private → public, 보류 결정 9 고침·10(private 로 되돌리기 — 트리거: 작업 완료) 새로, 7절 'GitHub Actions'(Windows 실기·에뮬레이터 시험 규칙), 1절 Phase 4 산출물에 CI, 11절 '커밋 메일'(이 저장소 `user.email` = GitHub noreply — 이 커밋부터) → 전체 검증 → `impl-phase4` push → `gh repo edit … --visibility public`
  - 공개 전 점검: 모든 브랜치 이력에서 RFC 5737·루프백 밖 IPv4 0, 키·토큰 꼴 0, 실제 사내 호스트 0(시험의 `*.corp.example` 등은 가짜 값), 비밀 파일 0. 작성자 메일은 28개 커밋 모두 개인 메일 — 사용자가 이력 그대로 두기로 했다
  - Actions 기본값(2026-11-10 `gh api`): 워크플로 권한 `read`, PR 리뷰 승인 불가, 액션 `all` 허용. 워크플로 0개

## 2. 검증 상태

- `bash scripts/verify.sh`(전체) — 이 커밋 직전에 돌려 통과한 뒤 커밋한다. `python3 scripts/verify_docs.py --release` 의 위반 15건은 이 세션 전과 같다(앞으로 만들 경로 — 배포 전에만 본다)

## 3. 다음 단계

1. **사용자 재확인 3가지**(P4 인터뷰결과서 4절): ① 패키지 이름 꼴 `io.github.hipiboy7.mylearningplatform` + 앱 이름 `MyLearningPlatform` ② 폐쇄망판 `.tgz` 도 계속 낼지(제안: zip 기본 + `.tgz` 함께) ③ '폰에서 MWL' = MyLearner 폰 앱에서 미들웨어 과정 + MWL 진도 들여오기(MWL 저장소 앱은 안 고침)
2. 사용자가 GitHub 앱에서 `v0.3.0` 파일이 받아지는지 알려 주면 CLAUDE.md 7절 '릴리스' 의 ⚠️ 를 지운다(안 되면 막힌 화면 문구로 다시 정한다)
3. 재확인 뒤: `docs/P4_요구사항정의서_Mobile.md`(FR-401~ — APK 껍데기·안드로이드 저장 어댑터·교환 파일·합치기 화면(미리보기·백업·되돌리기)·폐쇄망 zip 반입 파일·폐쇄망판 zip 묶음·폰 MWL 들여오기·폴드5 두 화면·**CI 2종**(GitHub Actions — Windows 러너 묶음 실기, Linux 러너 에뮬레이터 시험. 러너 KVM 지원 확인 ⚠️ — CLAUDE.md 7절 'GitHub Actions')) → 설계서 → 코드·시험 → 테스트결과서 → 체크리스트(폰 점검 순서는 MWL `docs/checklist/android-app.md` 14칸을 본떠 MyLearner 화면에 맞춘다)
4. 서명 키 만들기(재확인 뒤 첫 빌드 때): `~/.config/mylearner/` + `/data` 개인 폴더 사본, VM 밖 한 부는 사용자에게 알린다
5. 에뮬레이터 시스템 이미지는 받기 전에 `df -h /data` 로 잰다
6. Phase 4 끝 병합 때 CLAUDE.md 7절 '릴리스' 대로 `v0.4.0`(APK + 폐쇄망 zip 포함)
7. 사람 리뷰(기다리지 않음): [`docs/P3_체크리스트_PC.md`](../docs/P3_체크리스트_PC.md). 보류 결정 8 이 오면 7 을 확정

## 4. 판단·관찰

- 추정을 사실처럼 문서에 쓰면 사용자 뜻과 다른 결정을 묻게 된다 — 이번에는 "GitHub 앱에서 다운로드가 안된다"를 "앱이 비공개 파일을 못 받는다"로 읽었지만, 실제로는 이 저장소에 릴리스가 아직 없었다
- 비용: 결과 보고 때 `python3 scripts/usage_cost.py --record` 로 잰 값(`history/usage_ledger.json`)
