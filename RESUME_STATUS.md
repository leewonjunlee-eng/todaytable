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
