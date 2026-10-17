# 완료 요약 — Todaytable (우연한 식탁) 2026-10-16

## 1. 배포 / 인프라 (완료)
- `next.config.ts`: `output: 'standalone'` + turbopack root fix → 빌드 통과
- `package-lock.json`: symlink 깨진 6패키지(`next`/`react`/`react-dom`/`typescript`/`csstype`/`undici-types`) 재생성 → `npm ci` 안정
- `railway.json`: Config-as-Code (Deprecated but works until 2026-12-01)
- GitHub: `.github/workflows/railway-deploy.yml` (`main` + `master`)
- Source: `todaytable` (Web, ID `7758a5f7...`) → `leewunlee-eng/todaytable` / `master` / Auto-deploy ON
- Push: `master` → `9590049` (origin sync)
- Env (Railway Variables, `todaytable`): `DATABASE_PROVIDER=postgres`, `DATABASE_URL`, `SESSION_SECRET`, `WORKER_ID`, `APP_URL=https://todaytable-production.up.railway.app`
- Domain verified: `curl -I https://todaytable-production.up.railway.app` → 200
- DB: PostgreSQL (`Postgres` 서비스) + SQLite 로컬 (`.data/todaytable.sqlite`)

## 2. 구현 완료 (외부 결제 제외)

| 단계 | 항목 | 상태 | 파일/참조 |
|---|---|---|---|
| A | 매칭 / 테이블 할당 | DB + API + UI | `db/migrations/002_matching.sql`, `/api/admin/matching`, `/admin/matching` |
| B | 예약 / 확정 (venue) | DB + UI + API | `db/migrations/003_reservation.sql`, `/admin/reservation` |
| D | 참석 / 피드백 | DB + UI | `db/migrations/004_attendance.sql`, `/admin/attendance` |
| C | 알림 / 공지 | DB + UI + API | `db/migrations/005_notification.sql`, `/admin/notification` |
| — | E (채팅/단체방) | **Journey UI 구현** — `/api/tables/:id/messages` GET/POST 3~5초 polling; backend/브라우저 검증 대기 | `app/tables/[id]/chat` |

## Journey UI 상태 (backend 통합 전)
- 구현: 참가자/운영자 페이지, 보호된 Journey API 호출, loading/error/empty/refresh, 해상도 충돌의 optimistic version, 3~5초 채팅 polling, requestKey 재시도, 체크인/피드백/안전 요청, 인앱 알림, 푸시 권한과 미구성 상태 표시.
- 검증 대기: backend worker/API 통합 후 typecheck/build/실제 브라우저 네트워크 검증. 이 브랜치에서는 backend 동시 작업 중이라 해당 명령을 실행하지 않았다.
- 푸시: VAPID가 없으면 전송하지 않고 `푸시 알림 서버 설정이 없어 현재는 사용할 수 없어요.`를 표시한다. 허위 전송 완료 상태를 만들지 않는다.
- 채팅: WebSocket 의존이 아니며 `/api/tables/:id/messages` GET/POST polling을 사용한다.
- 가격: 현재 코드의 1회 8,000원 / 3회권 15,000원을 보존한다. OPERATIONS 문서의 9,900원/멤버십 문구와 정책 충돌이 있으므로 어느 쪽도 임의로 선택하지 않으며, 결제 정책 변경은 별도 결정 사항이다.

## 5. 실행 명령 (로컬 확인용)
```bash
npm run build
# 배포 URL 확인
curl -I https://todaytable-production.up.railway.app
```

---
작성: 2026-10-16 | 기반: `development` branch (`master`) → Railway `todaytable`
