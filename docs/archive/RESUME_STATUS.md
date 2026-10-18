> 과거 기록 보관본입니다. 최신 상태와 검증 결과는 [현재 현황](../STATUS.md)을 기준으로 확인하세요.

# 중단 작업 재개 기록 — 2026-10-17

## 확인한 중단 지점

Journey 참가자·운영자 UI, API, worker와 006–011 마이그레이션 소스는 작성되어 있었으나 통합 검증이 끝나지 않았다. 기존 acceptance 결과는 19개 중 7개 실패였고, 실제 재실행에서 타입 오류와 Journey worker 테스트 실패도 확인했다. 기존 작업 파일은 유지했다.

## 이번에 수정한 내용

- 참가자 `/api/journey`가 존재하지 않는 `notifications.read_at` 열을 조회하던 오류를 제거했다. 현재 UI에는 읽음 상태 변경 기능이 없다.
- 운영자 예외 재시도는 `scheduled_job`의 실제 job key와 `dining_table`의 provisioning key를 구분한다. 대상이 없으면 트랜잭션을 rollback하여 예외 상태가 잘못 변경되지 않는다.
- 취소 API는 Asia/Seoul 날짜로 당일 여부를 판단한다. PostgreSQL에서는 lifecycle advisory lock과 `FOR UPDATE OF a`로 신청 행을 잠근다. 이 PostgreSQL 경로의 런타임 검증은 남아 있다.
- 누락된 `@types/web-push@3.6.4`, worker lease 필드와 acceptance 환경 변수 타입을 보완했다.
- acceptance의 SQLite 배열 바인딩과 CSV·푸시 API 호출을 실제 UI 계약에 맞췄다. 보관 성공·중복 복구 방지·소유권·버전 충돌·모의 환불 중복 방지·운영자 재시도·당일 취소 거부를 실제 DB 상태로 확인하도록 보강했다.
- Journey 테스트는 최신 마이그레이션 전체를 적용하고, 매칭과 독립된 provisioning worker를 실제 실행한다. 테스트 이름은 실제 확인 범위에 맞췄다.
- Turbopack root를 절대 경로로 설정하고 런타임 SQLite 경로가 프로젝트 전체 파일 추적을 유발하지 않게 했다.
- 렌더링 smoke 범위를 이력·알림 및 운영자 Journey 페이지와 보호 API까지 확장했다.

## 기존 로컬 DB 복구

`.env.local`이 지정한 `.data/todaytable.sqlite`에는 002–005의 테이블·인덱스가 있었지만 이력은 001만 기록되어 있었다. 002–005의 테이블·인덱스 10개 정의를 현재 SQL로 만든 기준 DB와 대조하여 모두 일치하는 것을 확인했다.

SQLite backup API로 `.data/todaytable-before-history-repair-20261017T004642Z.sqlite`를 저장한 뒤, 확인된 002–005 이력만 기록했다. 기존 참가자·신청 데이터는 삭제하지 않았고 정상 migrator로 006–011을 적용했다. 재실행은 추가 적용 없이 성공했다. 이 복구는 해당 로컬 DB에만 수행했으며 migrator가 중복 오류를 무시하도록 바꾸지 않았다.

## 검증 결과

| 명령 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm test` | 테스트 파일 6개 통과. PostgreSQL 라이브 실행 근거로 사용하지 않음 |
| `npm run test:providers` | SQLite 통과, PostgreSQL URL 미설정으로 미실행 |
| `node --import tsx tests/provider-acceptance.ts` | SQLite 시나리오 19/19 통과 |
| `TODAYTABLE_IN_PROCESS_TYPESCRIPT=1 npm run build` | 컴파일·타입·페이지 생성 통과 |
| `npm run test:render` | 로그인, 참가자·운영자 페이지 18개와 보호 API 3개 정상 응답 |
| `npm run db:migrate` 재실행 | 추가 적용 없이 통과 |
| `git diff --check` | 통과 |

기본 `npm run build`는 이 환경에서 TypeScript 자식 프로세스 출력 해석에 실패했다. 기존의 in-process TypeScript 설정을 활성화한 위 명령으로 빌드를 완료했다. HTML 렌더링은 실제 Next.js 요청 처리기를 사용했으며 브라우저 JavaScript 실행·사용자 클릭 검증을 대체하지 않는다. 대표 HTML은 `.data/render-smoke/`에 있다.

## 남은 작업

1. `REPAIR_TABLE`: 취소로 4명 미만이 된 테이블의 동의 범위 내 자동 재매칭 구현. 현재는 `EXCEPTION`과 worker 실패 이력으로 남는다.
2. 일반 참가 취소의 모의 환불·이용권 복구 정책 연결. 미매칭 해결의 보관·모의 환불과 구분해야 한다.
3. PostgreSQL에서 최신 마이그레이션·행 잠금·API·worker acceptance 실행. 이번에는 PostgreSQL 서버를 사용하지 않았다.
4. 실제 브라우저에서 채팅·체크인·후기·운영 예외 조작 검증 및 배포 환경의 웹·독립 worker 확인.
5. 실제 푸시 전송은 VAPID 설정 후 검증. 외부 결제·환불은 현재 모의 처리다.

이번 작업은 로컬 구현과 통합 검증 복구이며, 서비스 전체 완료·새 외부 배포를 의미하지 않는다. Git commit/push는 수행하지 않았다.

## 후속: 운영 계정 생성 및 로그인 수정 (2026-10-17)

사용자 요청으로 production PostgreSQL에 `user@todaytable.local`(PARTICIPANT), `operator@todaytable.local`(ADMIN)을 생성했다. 비밀번호는 사용자에게 전달한 로컬 계정과 같으며 이 문서에는 기록하지 않는다.

운영 DB가 비어 있어 배포 커밋 `0a7cb7b97287025cfa49c58a6f991ab1368fce2a`의 001–005 스키마를 초기화했다. 004는 기존 소스의 중복 attendance enum 생성 방지 구문을 사용했다. 최신 Journey 마이그레이션 006–011은 운영 DB에 적용하지 않았다.

브라우저 Origin을 포함한 로그인에서 기존 출처 검사 오류를 재현했다. 공개 `APP_URL`을 기준으로 검사하도록 `lib/http.ts`를 수정하고 회귀 테스트를 통과했다. 운영 APP_URL에 누락된 https://도 보완했다. 현재 운영 커밋에서 이 수정과 테스트만 적용한 별도 worktree `/tmp/todaytable-login-origin-fix`를 배포했다. 배포 ID는 `fabb031a-436f-4c2e-a361-687b71861a55`, 상태는 SUCCESS다. 본 작업 폴더의 다른 미완성 변경은 배포하지 않았다.

실제 공개 URL에서 올바른 Origin 헤더를 포함한 두 계정의 로그인 200과 참가자 `/profile`, 운영자 `/admin/applications` 응답 200을 확인했다. 확인용 로그인은 logout했다. 임시 Railway SSH 키 등록은 해제했고 로컬 임시 키·비밀번호 검증 스크립트·해시 파일도 삭제했다.


## 후속: 구현 검토 및 취소·재매칭 보완 (2026-10-17)

현재 소스를 검토해 아래 오류를 수정했다.

- 참가 취소가 테이블의 예약 작업 전체를 즉시 실행 대기 상태로 바꾸던 코드를 제거했다. 후기 요청·출석 마감 등은 예정 시각을 유지한다.
- 재매칭 작업 키에 취소 신청 ID를 포함해, 이전 재매칭의 `job_effects`가 다음 취소 처리를 막지 않게 했다. 동일 취소 재요청은 새 작업을 생성하지 않는다.
- 재매칭 시 DB에 저장된 현재 테이블 일정을 기준으로 판단하고, 지난 행사와 취소된 행사를 후보에서 제외했다.
- 재매칭 성공 시 기존 예약 작업을 종료하고 새 매칭 실행 ID를 포함한 작업 키로 일정을 다시 생성한다. 취소한 구성원의 출석 기록과 리마인드를 새로 만들지 않는다.
- SQLite 통합·lifecycle 테스트에 최신 마이그레이션 전체를 적용했다. 구 스키마로 인해 인증 조회가 실패하던 테스트를 복구하고 취소·재매칭 회귀 시나리오를 추가했다.
- README의 자동 재매칭·일반 취소 정책 설명을 현재 구현에 맞췄다.

검증: `npm test` 25개 중 20개 통과, PostgreSQL URL 미설정에 따른 5개 명시적 skip, 실패 0개. 자식 프로세스 검증은 실행 제한 밖에서 수행했다. `npm run typecheck`, `TODAYTABLE_IN_PROCESS_TYPESCRIPT=1 npm run build`, `git diff --check` 통과. PostgreSQL 실연결·실제 브라우저 조작·외부 배포는 이번 검증 범위에 포함하지 않았다. 기존 `tsconfig.json` 변경은 유지했다.


## 후속: 모의 결제 매출 및 운영 데이터 반영 (2026-10-17)

- `scripts/seed-operations.ts`와 `npm run db:seed:operations`를 추가했다. 가상 참가자 48명, 회차 12개, 신청·MOCK 결제 60건, 매칭 식탁·예약 6개, 참가자 채팅 30개, 후기 15개를 생성한다. 신청마다 결제·이용권·사용 원장·알림을 연결하고 대기·확정·지난 모임·미매칭 대안·환불 완료 상태를 포함한다.
- 기존 `user@todaytable.local` 및 `guest@todaytable.local` 계정이 있으면 과거/예정/대기 경험을 연결한다. 비밀번호와 기존 프로필은 변경하지 않는다. 원본 설문 응답을 결제자나 동의자로 전환하지 않고 가상 참가자를 사용한다.
- 생성은 하나의 트랜잭션과 완료 마커로 보호한다. SQLite 및 격리된 PostgreSQL 스키마에서 생성·재실행을 검증했다. 운영 DB 최초 원격 생성은 시간 제한으로 롤백되었고, 배포 서버 내부에서 실행하여 성공했다. 재실행은 추가 생성 없이 완료됐다.
- 관리자 API·대시보드에 모의 결제 매출 597,000원, 환불 완료 23,000원, 환불 대기액과 최근 거래를 추가했다. 행사·식당과 관리자 화면에 모의 표시를 넣었다. 실제 돈은 이동하지 않는다.
- 웹 배포 `66c0e06a-d99a-4043-9b76-f5418729d80f` 성공. 워커 배포 `9e1697b1-31ce-4240-a27b-19195a971864` 성공 및 PostgreSQL polling 로그 확인. 워커는 전용 `railway.worker.json`을 업로드 폴더의 `railway.json`으로 사용해 HTTP healthcheck 없이 실행했다.
- 실제 공개 사이트에서 관리자 매출·식탁 6개, 참가자 신청 3건과 알림을 브라우저로 검증했다. 원본 설문은 294행 그대로 보존되어 있다. 스크린샷은 `.data/production-operations-admin.png`, `.data/production-operations-participant.png`에 저장했다.
- 로컬 브라우저에서 신청 버튼으로 8,000원 모의 결제 추가 및 PAID 상태를 확인했다. 운영 확인 중 로그아웃이 내부 호스트로 redirect하는 문제를 발견해 APP_URL 기준으로 수정하고 회귀 테스트를 추가했다.
- 전체 테스트 27개 중 22개 통과, PostgreSQL URL 미설정에 따른 5개 skip. 별도로 PostgreSQL 전체 마이그레이션·운영 데이터 생성·재실행을 검증했다. 타입 검사와 프로덕션 빌드 통과.
- 변경 전 운영 public 스키마 38개 테이블의 일관된 스냅샷을 `.data/production-before-operations.json`에 보관했다. 임시 검증 세션을 삭제했고 임시 Railway SSH 키를 해제했다. 임시 DB TCP proxy도 검증 후 삭제했다.

로그아웃 수정 웹 배포 `9cc7eb1a-a3fc-470e-b7db-1b5ee4bc1164` 반영 후 공개 URL의 303 Location이 정상 공개 `/login` 주소임을 확인했다.


## 후속: 제품 확장 일부 구현 후 사용자 요청으로 중단 (2026-10-17)

공동 문의함·3인 운영자 설정·매칭 스튜디오와 정책 스냅샷, 신규 014~017 이행 및 공통 디자인 틀을 로컬에 작성했다. 사용자의 “웹사이트 안에서 문의 답변 확인” 요구는 사용자 `/support` 목록·대화·추가 질문과 내부 메모 비노출로 연결했다.

이후 사용자가 “하던 데까지만 마무리하고 상세 .md를 남겨 달라”고 요청해 새 기능 확장을 중단했다. 전체 1~5단계 완료가 아니다. 후기 상세 저장·신호 생성·인사이트·참가자 여정 마무리·실제 브라우저 검증·운영 배포가 남아 있다.

재개할 때는 [상세 구현 인수인계](../IMPLEMENTATION_HANDOFF.md)를 먼저 읽는다. 현재 상태, 파일별 역할, API 예시, 알려진 문제, 작업 순서, 검증 명령, 배포 주의점과 완료 체크리스트를 기록했다. 원래 제품 의도는 [제품 확장 계획](../PRODUCT_EVOLUTION_PLAN.md)을 함께 본다.

검증: 전체 테스트 33개 중 28개 통과·기존 PostgreSQL 테스트 5개 skip·실패 0개. 새 문의/스튜디오 PostgreSQL 통합은 별도 격리 스키마에서 6개 통과했다. 타입 검사 통과. 이번 확장의 운영 배포와 운영 DB 이행은 하지 않았다. 로컬 운영자 3인 구성만 진행했다.

중단 정리 최종 프로덕션 빌드도 컴파일·타입·페이지 생성까지 통과했다. 새 UI의 실제 브라우저 검증은 남겨 두었다.
