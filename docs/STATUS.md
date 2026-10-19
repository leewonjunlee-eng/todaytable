# 현재 현황 — 2026-10-19 05:32 UTC

운영 화면·가입·프로필·모의 결제 확장과 PRD 보완 코드를 검증하고 **운영 웹·워커에 배포했습니다. 운영 PostgreSQL은 028까지 적용됐습니다.** 이전 테스트 실패를 수정했고 최신 전체 검사에서 실패가 없습니다.

운영 사이트: https://todaytable-production.up.railway.app

## 현재 동작

- 참가자: 가입·단계형 취향 프로필·운영 모집 회차 선택·모의 결제/새로고침 복구·참가권·매칭 결과·빈자리 초대 응답·채팅·체크인·비공개 후기·문의·내 기록/삭제 요청.
- 운영자: 공동 문의함, 마감 전 신청, 자동 확정된 매칭, 지난 식탁, 식당·예약, 월·연 운영 분석. 참석·후기·안내·예외와 작업 시간은 식탁 상세에 통합했습니다.
- `/admin/settings`: 회차 등록/수정/모집 중단/변경 영향, 식당 영업·휴무·음식 요청 확인, 자동 안내 미리보기/버전 발행, 개인정보 삭제 보류/재개/실행.
- 연결 회차 매칭은 필수 조건과 기존 확정 좌석을 보존하며 배정 수·재배치 우선순위·품질을 비교합니다. 8명 반례와 19/25/50/100명 사례에서 전원 배정됐습니다. 탐색은 예산 내에서 수행하며 모든 입력의 전역 최적해를 보장하지 않습니다.
- 취소석은 참가자의 기한 내 초대 응답을 먼저 기다립니다. 초대 정리 후 부족 식탁 병합·재배치, 불가능한 경우 운영 예외와 참가자 대안 절차를 사용합니다. 3명+3명 병합을 검증했습니다.
- 결제·환불은 모의 원장입니다. 실제 돈 이동·이메일·외부 예약 연동은 도입하지 않습니다.

상세 수정과 한계는 [릴리스 기록](RELEASE_20261019.md), 운영 규칙은 [OPERATIONS](../OPERATIONS.md)을 확인하세요.

## 최신 검증

| 확인 | 결과 | 근거 |
|---|---|---|
| 전체 PostgreSQL 구성 | **81개 통과, 실패 0, 건너뜀 0** | `.data/completion-postgres-verified.log` |
| 전체 SQLite 기본 구성 | **76개 통과, 실패 0, PG 전용 5개 건너뜀** | `.data/completion-sqlite-verified.log` |
| DB 인수 시나리오 | SQLite 20개 + PostgreSQL 20개 통과, 001~028 적용 및 두 번째 실행 신규 이행 0개 | `.data/completion-providers-verified.log` |
| 타입·프로덕션 빌드 | Next.js 16.4.2, 기본 TypeScript 검사 포함 통과 | `.data/completion-build-final.log` |
| 최종 빌드 브라우저 | 운영 64 + 프로필 24 + 결제/환불 15 + 설정 10 = **113개 통과** | `.data/completion-*-browser-verified.log` 및 각 결과/캡처 |
| 운영 사이트 | 네 계정 로그인·권한, 주요 API·화면·가로 넘침 **49개 확인 통과** | `.data/completion-production-browser/results.json` |
| 운영 DB 복원 리허설 | 기존 66개 테이블 복원 → 021~028 적용, 기존 열의 원본 행 보존 | `.data/completion-migration-rehearsal.json` |
| 운영 적용 후 보존 | 기존 계정 52·프로필 49·신청/결제 61·식탁 6·원본 설문 294행 보존 | `.data/completion-production-preservation.json` |
| 웹·워커 런타임 | 동일 소스 파일 해시·Next.js 16.4.2·PostgreSQL 확인 | `.data/completion-runtime-verification.json` |

실행 방법은 [검증 안내](VALIDATION.md)를 따릅니다. 로그·캡처·백업·계정 정보는 Git 제외 `.data/`에 보관합니다.

## 운영 배포

| 서비스 | 현재 검증 배포 |
|---|---|
| 웹 | `4fc56eb0-933c-4c6f-a89f-ccf02ca47c59` — SUCCESS |
| 독립 워커 | `32db7352-b195-444c-8c7d-f302468d921d` — SUCCESS |
| PostgreSQL | 기존 서비스 유지, 001~028 이행 완료 |

기존 Railway 프로젝트 `ea8717f4-7740-44c1-a29f-f1107005a7e6`의 production 환경을 사용합니다. 허용된 소스만 직접 업로드했고 새 서비스나 DB를 만들지 않았습니다. 검증한 코드와 최신 문서를 master 브랜치의 Git 버전 관리에 포함합니다. 배포 소스는 `.data/completion-release-manifest.json`과 워커용 매니페스트로 식별합니다.

대표 `ceo@todaytable`, PD `pd@todaytable`, CTO `cto@todaytable`, 참가자 `user@todaytable` 계정과 기존 연결을 유지합니다. 비밀번호는 보호 파일 `.data/simple-login-credentials.json`에만 있습니다. 로그인 검증 세션은 로그아웃했습니다. 임시 Railway SSH 키 등록 해제 결과는 `.data/completion-cleanup.json`을 확인하세요.

## 남은 환경·제품 검증 범위

- 운영 웹·워커의 VAPID 변수 구성을 확인했습니다. 실기기 권한·구독·최종 도착까지의 푸시 전달은 검증하지 않았습니다. 인앱 안내·실패/재시도/만료 구독 처리는 자동화 검증 범위입니다.
- 실제 사용자의 첫 신청 5분 목표, 임의의 모든 매칭 입력에 대한 최적 배치, 학습으로 인한 실제 만족도 향상을 주장하지 않습니다.
- HELD 제안의 자동 만료, 자료별 보관 기간 최종 확정과 자동 보관 만료는 별도입니다. 개인정보 정리 실행은 진행 중 업무를 보류하며 거래·안전 기록·원본 자료를 일괄 삭제하지 않습니다.
- 식당 슬롯은 등록된 식당부터 적용합니다. 기존 식당은 등록 전까지 기존 재고 규칙을 유지합니다.

이 항목들은 [PRD 감사](PRD_GAP_ANALYSIS_AND_PLAN_20261019.md)의 과거 발견 사항과 [릴리스 한계](RELEASE_20261019.md)를 연결한 후속 범위이며, 이번 테스트·배포 성공을 PRD 전체의 무제한 충족으로 해석하지 않습니다.

## 과거 기록·복구

이전 현황 전체는 [릴리스 전 기록](archive/STATUS_20261019_BEFORE_VERIFIED_RELEASE.md)에 보존했습니다. 배포 직전 웹은 `abb964bf-ad00-4a67-8de8-2a30a7404248`, 워커는 `7cf711db-3072-4525-b436-98978f2ac4dc`입니다. 이전 워커는 새 작업 종류를 처리하지 못하므로 단독 복원하지 않습니다. [배포 안내](../DEPLOY.md)의 호환 버전 복구 절차를 따릅니다.
