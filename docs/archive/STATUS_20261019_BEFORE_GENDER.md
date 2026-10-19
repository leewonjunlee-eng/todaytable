# 현재 현황 — 2026-10-19 화면·가상 운영 개편

참가자 화면을 **발견 · 내 만남 · 대화 · 마이**로 정리했습니다. 내 만남은 **만남 예정 / 신청 중 / 지난 만남**으로 나누고, 결제·참가권·문의·설정은 마이에서 접근합니다. 관리자도 신청 중·만남 예정·지난 만남을 같은 용어로 사용합니다. [운영 사이트](https://todaytable-production.up.railway.app)와 [설계·GitHub 스킬 기록](EXPERIENCE_REDESIGN_20261019.md)을 확인하세요.

## 가상 운영 자료

제공된 XLSX **294행을 모두 별도 참가자에 연결**했습니다. 중복 후보도 행별로 보존했습니다.

| 원본 참가자 상태 | 인원 |
| --- | ---: |
| 지난 만남 | 105 |
| 만남 예정 | 98 |
| 신청 중 | 91 |
| 합계 | 294 |

체험용 기존 참가자 계정까지 포함한 구성은 참가자 295명, 신청 307건, 확정 식탁 37개, 후기 83개, 참가자 대화 148개, 문의 12건입니다. 한 사람이 여러 만남에 참여할 수 있으므로 신청 건수와 원본 참가자 수는 다릅니다. 운영 첫 화면의 세 상태는 현재 연결 신청 건수를 표시합니다.

원본 파일·응답·가정·연결 이력을 보존합니다. 연도 없는 날짜는 현재 기준 목요일 저녁으로 재구성했고, 연락처와 Instagram은 복사하지 않았습니다. 결제·식당 예약은 전부 MOCK입니다. 가상 운영이 활성화되면 외부 웹 푸시도 차단합니다. 인앱 알림과 대화·후기·문의는 가상 자료로 구성했습니다.

## 검증

| 확인 | 결과 | 근거 |
| --- | --- | --- |
| 전체 자동 테스트 | PostgreSQL 전용 검사 포함 85개 통과, 실패·건너뜀 0 | `.data/showcase-tests-both.log` |
| 최종 문의함 범위·가상 자료 보완 | 관련 16개 통과 | `.data/showcase-final-targeted-tests.log` |
| DB 인수 | SQLite 20개 + PostgreSQL 20개, 001~029 적용 및 두 번째 실행 신규 이행 0개 | `.data/showcase-providers.log` |
| 실제 XLSX 구성 | 294행 전체 연결, 4–6명·연령 차이 8년·식당 수용량, 재실행과 외부 푸시 차단 | `tests/showcase.test.ts` |
| PostgreSQL 자료 생성 | 294행 전체와 세 상태 생성 성공 | `.data/showcase-pg-populate.log` |
| 프로덕션 빌드 | Next.js 16.4.2, TypeScript 검사 포함 통과 | `.data/showcase-build-final.log` 및 Railway 빌드 로그 |
| 로컬 실제 브라우저 | Python Playwright 129개 확인, 360·390·430·1440px, 캡처 55개 | `.data/showcase-browser/results.json` |
| 운영 실제 브라우저 | 대표·PD·CTO·참가자 네 계정, 138개 확인 통과 | `.data/showcase-production-browser/results.json` |
| 신청 2단계 실제 동작 | 추천 일정 입력 → 모의 실패 → 재시도 성공 → 신청 중 이동 확인 | `.data/showcase-apply-flow.log` |
| 최종 화면 보완 | 날짜·지역 중복 제거, 가격·선택 표시 간격, 접근성 이름·키보드 이동 20개 확인 | `.data/showcase-css-preview-browser/results.json` 및 최종 운영 확인 |
| 운영 DB 보존 | 기존 74개 테이블의 원래 행 보존, 가변 세션·작업·읽음 상태 등 6개는 별도 분류 | `.data/showcase-production-preservation.json` |
| 운영 런타임 | 웹·워커 각각 핵심 소스 123개 해시 일치, PostgreSQL·Next.js 버전 확인 | `.data/showcase-runtime-verification.json` |
| 최근 운영 로그 | 웹·워커 오류 0, 열린 처리 예외 0 | `.data/showcase-log-review.json`, `.data/showcase-production-health.json` |

최종 화면에서 본문 건너뛰기 대상, 포커스, 모바일 글자 크기와 줄바꿈, 날짜·지역 중복 안내, URL 탭·뒤로가기·새로고침, 본인 대화 및 지난 대화를 확인합니다. 실행 방법은 [검증 안내](VALIDATION.md)와 [테스트 안내](../tests/README.md)에 있습니다. 로그·캡처·백업·계정 정보는 Git 제외 `.data/`에 보관합니다.

## 운영 배포

직접 검증한 릴리스 배포는 웹 `99f65053-30ee-4d51-b15b-68c00e6bb158`, 워커 `65bc12f0-169c-4a3d-bbd7-b2c1ec9ab04a`입니다. PostgreSQL은 001~029 이행을 완료했습니다.

기존 Railway production 환경과 PostgreSQL을 유지합니다. 백업 → 029 이행 → 외부 푸시 차단 워커 → 웹 → 원본 설문 기반 가상 운영 구성 순으로 적용했습니다. 새 서비스나 DB를 만들지 않았습니다. 배포 소스는 `.data/showcase-release-manifest.json`, 워커는 `.data/showcase-worker-release-manifest.json`에 기록합니다. 동일 릴리스의 GitHub 자동 배포가 뒤따를 수 있으며 Railway의 최신 상태와 런타임 해시를 함께 확인합니다.

대표 `ceo@todaytable`, PD `pd@todaytable`, CTO `cto@todaytable`, 참가자 `user@todaytable` 계정과 비밀번호를 유지합니다. 비밀번호는 보호 파일 `.data/simple-login-credentials.json`에만 있습니다. 기존 계정 52개·프로필 49개·신청/결제 61건·식탁 6개·원본 294행을 삭제하거나 변경하지 않았습니다. 운영 화면은 활성 가상 배치를 중심으로 보여줍니다.

## 범위와 복구

- 실제 돈 이동·외부 예약·이메일·외부 푸시 전달은 이번 가상 운영의 범위에 포함하지 않습니다.
- 연령·MBTI·지역·날짜 보완은 원본 검증을 뜻하지 않으며, 원래 값과 가정을 함께 보관합니다. 실제 사용자 성과나 만족도 개선을 주장하지 않습니다.
- 같은 원본 해시와 기준 목요일에 대한 재실행은 중복 생성하지 않습니다. 다른 기준 주에 새 배치를 만들면 원래 자료를 보존하고 새 배치를 활성화합니다.
- 복구 시 원본 DB와 029 스키마를 유지하고, 가상 운영 외부 전송 차단을 지원하는 워커를 사용합니다. 웹만 과거 버전으로 되돌리더라도 외부 전송 차단을 해제하지 않습니다.

이전 구현·검증 기록은 [개편 전 현황](archive/STATUS_20261019_BEFORE_EXPERIENCE.md), [이전 릴리스](RELEASE_20261019.md)에 보존했습니다.
