# 2026-11-10 — Phase 4(폰에서 배우기 + 합치기) 착수 · APK 받는 절차

- 작업자: Claude Opus 5.5(effort xhigh — 환경 변수) / 브랜치: `main` → `impl-phase4` / 이전 세션: [`2026-11-10_claude-opus_p3-merge.md`](2026-11-10_claude-opus_p3-merge.md)

## 1. 한 일

- 세션 시작 점검(CLAUDE.md 0-1절): `bash scripts/check_env.sh` → `READY`(안드로이드 빌드 이미지 포함), `bash scripts/verify.sh` → 20단계 통과. 보류 결정 3 이 트리거
- 사전 조사(읽기만): MWL 안드로이드 시제품은 이제 MWL `main` 의 `mobile/android/`·`scripts/build_android.sh` 에 있다(BRIEF 4.1 의 브랜치 `feat-android-app` 은 병합 뒤 지워짐). 패키지 `io.github.hipiboy7.mwl`, 서명 키는 이 계정 홈 `~/.config/mwl/`(저장소 밖). 빌드 이미지 `ANDROID_IMAGE` 에 에뮬레이터 실행 파일은 있고 시스템 이미지는 없다. `/dev/kvm` 있음
- Phase 4 인터뷰 질문 7개와 에이전트 기본값을 한 번에 물었다(아래 3절 — 답 대기)
- 사용자 지시: "github app 에서 다운로드가 안되는데, 앞으로 릴리즈했을 때 github app 에서 다운로드 받을 수 있게 절차를 claude.md 에 설정해" →
  - 확인한 사실(2026-11-10): 비공개 저장소 MWL 의 Release 파일 주소(`android-v1.7.2` APK)는 로그인 없이 `curl` → `404`. 같은 파일을 `gh` 토큰으로 REST 자산 API(`Accept: application/octet-stream`)에서 받으면 `302` → 서명된 임시 주소(약 1시간 유효). GitHub 앱은 받기를 로그인 정보 없이 폰의 내려받기로 넘기는 것으로 본다 ⚠️ 추정(앱 화면 미확인)
  - CLAUDE.md 7절 'APK 릴리스 — 폰의 GitHub 앱에서 받기'(7단계), 보류 결정 9(APK 받는 곳 — 공개 범위), 11절 사람 확인에 Release 올리기, 0절 외부 서비스, `docs/설계서_Architecture.md` 8절 APK 행

## 2. 검증 상태

- `bash scripts/verify.sh`(전체) — 이 커밋 직전에 돌려 통과한 뒤 커밋한다. `python3 scripts/verify_docs.py --release` 의 위반 15건은 이 세션 전과 같다(앞으로 만들 경로 — 배포 전에만 본다)

## 3. 다음 단계

1. **사용자 답 받기** — 그대로 다시 물을 것:
   - Phase 4 인터뷰(대화로 물음): ① 패키지 이름(추천 `io.github.hipiboy7.mylearner`) ② 서명 키 보관·백업(추천 새 키 — 이 계정 `~/.config/mylearner/` + 이 계정 `/data` 개인 폴더 사본 + VM 밖 한 부는 사용자) ③ 폐쇄망 반입 꼴(`.tgz` 만인지 `.jsonl` 도 되는지, 경로 폰 → 집 PC → 폐쇄망) ④ 폰에 넣을 과정(추천 PC 묶음 셋) ⑤ 폰에서 MWL 앱을 쓰는지(쓰면 폰에서도 MWL 진도 들여오기) ⑥ 폰 안드로이드 판 + 에뮬레이터 시스템 이미지 받기 허락 ⑦ APK 받는 길
   - 보류 결정 9: 공개 Release 전용 저장소(추천 `hipiboy7/MyLearner-releases`, APK·SHA-256·안내만)를 만들지 — ⑦과 같은 질문
   - 기본값(이견이 없으면 그대로): 폰 저장 = 앱 전용 파일 + 브리지 원자적 덧붙이기, 폰 ⇄ PC = 공유 + 파일로 저장, 교환 파일 = 모든 기기 기록 + 사용자 과정, 합치기 = 미리보기 → 확인 → 자동 백업 → 합침, 되돌리기 = 그 들여오기로 새로 들어온 줄만 뺀다, 마지막 내보내기 7일 넘으면 띠, 폐쇄망판은 내보내기 없음
2. 답 → `docs/P4_인터뷰결과서_Mobile.md` → 요구사항정의서(FR-401~) → 설계서 → 코드·시험 → 테스트결과서 → 체크리스트(폰 점검 순서는 MWL `docs/checklist/android-app.md` 14칸을 본떠 MyLearner 화면에 맞춘다)
3. 첫 APK Release 는 CLAUDE.md 7절 'APK 릴리스' 7단계대로
4. 사람 리뷰(기다리지 않음): [`docs/P3_체크리스트_PC.md`](../docs/P3_체크리스트_PC.md). 보류 결정 8 이 오면 7 을 확정

## 4. 판단·관찰

- 사용자는 체크리스트·릴리스를 폰의 GitHub 앱으로 본다 — 비공개 저장소 Release 는 그 앱에서 받히지 않는다(1절). 문서·체크리스트는 비공개 저장소에서 앱으로 읽을 수 있지만 APK 파일은 공개 받는 곳이 있어야 앱에서 받힌다
- 비용: 아래 결과 보고 때 `python3 scripts/usage_cost.py --record` 로 잰 값(`history/usage_ledger.json`)
