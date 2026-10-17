# 중단→원래 계획 진행 기록 — 2026-10-17

## 완료 (1~4)
- 1 테스트/DB: refund_requests NOT NULL → nullable (006 sql + SQLite .data), APP_URL=http://localhost 테스트 환경 설정. sqlite.integration 403/401 원인 확인 (sameOrigin). source-data test 1/1 pass. typecheck/build 렌더링 통과.
- 2 lifecycle: cancel route 이미 assigned event (table_members→event) 기준으로 starts_at 계산, repair_table 자동 트리거 (remaining<4 → EXCEPTION + scheduled_jobs). 리뷰 2항(취소 기준일, 중복) 코드상 반영 확인, 통합 검증 미완료.
- 3 source_admin: source-data-admin 컴포넌트/페이지/API/마이그레이션 존재, test pass, typecheck 통과.
- 4 browser/render: render-smoke 18 페이지+3 API 통과, /login 컴파일 문제 해결 (in-process build). 전체 Chromium 클릭 시나리오(test/browser-scenarios.ts)는 서버+고립 DB 필요하여 미실행; 스크립트 준비됨.

## 미완료 (5~6) — 차단
- 5 PostgreSQL acceptance: /tmp/todaytable-pg-scenarios 서버 가동 중이나 auth 미해결로 DATABASE_URL/TEST_DATABASE_URL 미설정. 006-013 마이그레이션 미적용. PG acceptance 미실행.
- 6 배포: 운영 DB 006-013 미적용, 최신 코드 커밋/푸시 미완료, worker 서비스 미생성. VAPID는 이미 Railway web/worker에 설정됨(재배포 미완료). 로그인 수정 worktree `fabb031a`만 별도 배포 완료.

## 다음
- PG auth 해결 → 006-013 마이그레이션 적용 → SQLite 시나리오 19/19 재확인 (현재 14/23 일부 실패) → 브라우저 시나리오 실행 → 커밋/푸시 → 운영 DB 백업 → web 배포 → worker 서비스 생성.

## 2026-10-17 추가 진행 (PG)
- PostgreSQL 서버 (/var/lib/postgresql/14/main) 사용, DB `todaytable` 생성, 001-013 마이그레이션 전체 적용 완료 (38 테이블).
- `refund_requests.resolution_id` nullable 확인 (`\d` + INSERT 시도).
- Node `DATABASE_URL` + `DATABASE_PROVIDER=postgres` 연결 성공 (`{ ok: 1 }`).
- PG acceptance (provider-acceptance) 미실행 — 테스트 환경 변수/DB 상태 확인 후 순차 실행 필요.
