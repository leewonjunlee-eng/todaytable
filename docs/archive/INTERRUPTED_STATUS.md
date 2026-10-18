> 과거 기록 보관본입니다. 최신 상태와 검증 결과는 [현재 현황](../STATUS.md)을 기준으로 확인하세요.

# 작업 중단 지점 정리 — 2026-10-17 (01:38 UTC 중단)

## 중단 원인

Codex 메인 세션(`~/.codex/sessions/2026/10/17/rollout-2026-10-17T00-35-22-…jsonl`)이 **01:38:10 UTC에 사용량 한도(`usage_limit_exceeded`)에 걸려** 종료됐다. 하위 에이전트 3개(lifecycle, source_admin, runtime)도 01:38:3x에 함께 멈췄다. 각 에이전트가 명령을 실행하던 중에 끊겼고, 결과를 통합하는 단계는 시작되지 않았다.

## 이 세션에서 끝난 일 (00:35 ~ 01:28)

| 시각(UTC) | 요청 | 결과 |
|---|---|---|
| 00:35 | 중단된 작업 이어서 진행 | Journey 통합 검증 복구 완료. 자세한 내용은 `RESUME_STATUS.md` 참고 (typecheck, SQLite acceptance 19/19, build, render smoke 통과) |
| 00:53 | 사용자·운영자 계정 생성 | 로컬 DB에 `user@todaytable.local`(PARTICIPANT)과 `operator@todaytable.local`(ADMIN) 생성 |
| 00:54 | 배포 서버에도 생성 | 운영 PostgreSQL이 비어 있어 001–005 스키마만 초기화한 뒤 두 계정 생성. 로그인 Origin 검사 버그(`lib/http.ts`)는 별도 worktree에서 수정해 배포했다 (deploy `fabb031a…`, SUCCESS). 비밀번호는 Codex 대화에 있고 이 문서에는 적지 않는다 |
| 01:20 | 제공 데이터 DB 적재 | 엑셀 294건을 운영 DB의 `provided_data` 스키마에 원본 그대로 저장했다. 재실행해도 중복이 생기지 않는다 (`IMPORTED_DATA.md`) |
| 01:25 | 남은 구현 목록 | 7개 항목 정리 (아래 계획의 배경) |
| 01:28 | **"전체 시나리오 검증까지 진행. 계획은 메인이, 구현은 하위모델이. 클로드 검증은 제외"** | `SCENARIO_PLAN.md` 작성 후 하위 에이전트 3개 실행 → **진행 중에 중단** |

## 중단된 작업: 전체 시나리오 구현·검증 (`SCENARIO_PLAN.md`)

### 1. lifecycle 담당: 취소·환불·재매칭
- `lib/lifecycle-service.ts`, `lib/matching.ts`, `app/api/applications/[id]/cancel/route.ts`, `tests/core-lifecycle.test.ts`, `tests/matching.test.ts` 작업
- 동의 범위 안에서만 재매칭하는 `REPAIR_TABLE` 서비스를 추가했다. 후보 조회에서 정지·영구제재 사용자를 제외하는 필터도 넣었다
- **마지막 상태:** `matching.test.ts`와 `core-lifecycle.test.ts` 8/8 통과, typecheck 통과 (01:38:35)
- 메인 에이전트가 리뷰에서 지적한 두 가지를 보완하던 중이었다: 취소 기준일을 첫 신청 옵션이 아니라 실제 배정 회차에서 읽도록 수정, 재매칭 후 예약·참석 기록이 중복 생성될 위험 처리. 반영이 끝났는지는 확인되지 않았다

### 2. source_admin 담당: 원본 294건 관리자 화면·시연 전환
- `/admin/source-data` 페이지, `app/api/admin/source-data`, `components/source-data-admin.tsx`, `lib/source-data.ts`, `db/{migrations,sqlite}/013_source_data.sql`, `scripts/import_source_data_sqlite.ts`, `tests/source-data.test.ts`
- 리뷰 반영 완료: synthetic 계정에만 매칭 동의 체크박스 적용, 같은 날짜·지역이면 `DEMO ONLY` cohort로 묶음, 시각 19:00 KST
- **마지막 상태:** `tsc --noEmit && git diff --check` 실행 중에 중단됐다 (출력이 나오기 전)

### 3. runtime 담당: 워커·배포 이미지·브라우저 시나리오
- `worker/index.ts`: 푸시 구독별 재시도, 404/410 구독 비활성화, `REPAIR_TABLE`에서 lifecycle 서비스 호출
- `Dockerfile`, `.dockerignore`: 이미지에 `db/`와 `scripts/migrate.ts` 포함
- `WORKER_DEPLOYMENT.md`: Railway 워커 서비스 설정 방법 (아직 실제로 생성하지 않음)
- `tests/browser-scenarios.ts`, `tests/run-browser-scenarios.mjs`: Playwright로 실제 Chromium 클릭 시나리오 실행 (`PLAYWRIGHT_MODULE=/tmp/todaytable-browser-tools/node_modules/playwright/index.mjs`)
- **마지막 상태:** 브라우저 시나리오 첫 실행에서 마이그레이션 001–013 적용과 Next dev 서버 기동까지 확인했다. `/login` 컴파일 중에 끊겨 **결과가 없다**

### 메인 에이전트(통합·검증)
- 별도 PostgreSQL 검증 환경(`/tmp/todaytable-pg-scenarios`)에서 기본 매칭·예약·미매칭 해결 흐름이 동작하는 것을 확인했다
- ⚠️ **Railway web과 worker에 VAPID 키를 이미 설정했다. 재배포는 하지 않았다** ("VAPID keys configured for web and worker; values not printed; deploy pending")
- 운영 DB에는 아직 006–013 마이그레이션이 적용되지 않았다. 최신 코드도 배포되지 않았고 커밋·푸시도 하지 않았다. 현재 HEAD는 `0a7cb7b`이고 미커밋 변경이 많다

## 현재 작업트리 검증 (2026-10-17 이 문서 작성 시 직접 실행)

| 명령 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm test` | **23개 중 14 pass / 4 fail** (나머지는 skip). 실패한 테스트는 `sqlite.integration.test.ts` 쪽 4개 (#20–23). 예: #20 `403 !== 401`. `lib/http.ts`·`lib/auth.ts`의 출처(Origin/APP_URL) 검사 변경 때문일 가능성이 크다 |
| `tests/scratchacceptance-newresults.json` (01:37) | SQLite: 시나리오 16번 "48시간 전 취소 / 당일 취소 거부" **실패**, 오류는 `NOT NULL constraint failed: refund_requests.resolution_id` (일반 취소 환불이 미매칭 해결용 `resolution_id`를 요구함). PostgreSQL: code 0 |

## 재개 시 할 일 (순서대로)

1. **테스트 복구**
   - `refund_requests.resolution_id` NOT NULL 문제: 일반 취소 환불에서도 쓸 수 있도록 마이그레이션(nullable로 바꾸거나 source 구분 컬럼 추가)과 lifecycle 코드를 수정한다
   - `sqlite.integration.test.ts`의 403/401 실패 4건: 테스트에 Origin/APP_URL을 넣어 주거나 http 검사를 바로잡는다
2. lifecycle 리뷰 항목 2개(취소 기준일, 재매칭 후 중복 기록)가 반영됐는지 확인한다
3. `source-data.test.ts`와 typecheck를 다시 실행한다
4. 브라우저 시나리오를 다시 실행한다: `PLAYWRIGHT_MODULE=/tmp/todaytable-browser-tools/node_modules/playwright/index.mjs node --import tsx tests/run-browser-scenarios.mjs`
5. PostgreSQL acceptance를 다시 실행한다 (`npm run test:providers`에 PG URL 지정, `/tmp/todaytable-pg-scenarios`)
6. 전체 통과 후 커밋한다 → 운영 DB 백업 → 006–013 마이그레이션 적용 → web 배포 → `WORKER_DEPLOYMENT.md`대로 worker 서비스 생성 (VAPID는 이미 설정됨)
7. 배포 환경에서 역할별 접근, 워커 실행, 원본 294건 보존, 푸시 동작을 확인한다
8. 최종 검증 보고서를 작성한다 (`SCENARIO_PLAN.md`의 "완료 판정" 기준)

## 참고 문서
- `SCENARIO_PLAN.md`: 이번 작업 범위와 완료 기준
- `RESUME_STATUS.md`: 직전 재개 작업과 운영 계정·로그인 수정 기록
- `IMPORTED_DATA.md`: 294건 적재 내역
- `WORKER_DEPLOYMENT.md`: 워커 배포 방법
- `backend-contract-delta.md`: 백엔드 계약 변경점
