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
| — | E (채팅/단체방) | **제외** — WebSocket/인프라 필요, 요청 시 추가 |

## 3. 배포 확인
- 컨테이너 시작: `Starting Container` / `Next.js 16` / `Ready`
- 현재 `todaytable` 서비스 배포 상태: 대시보드에서 `SUCCESS` 확인 필요 (이전에 FAILED → 현재 env 설정 후 새 배포 시도됨)
- `OPERATIONS.md` 추가: 가격/지역/PRD-외 운영 정책

## 4. 미완료 / 다음 단계 (선택)
- 자동 매칭 알고리즘 (현재 순차 6명 할당만): 연령/성비/MBTI 기반 그룹핑
- 실제 PG/환불 연동 (외부 리소스 — 제외됨)
- 메시지 채널 확장 (이메일/푸시 — 외부 리소스 제외)
- 참석 피드백 1~5점 스코어 UI 연동

## 5. 실행 명령 (로컬 확인용)
```bash
npm run build
# 배포 URL 확인
curl -I https://todaytable-production.up.railway.app
```

---
작성: 2026-10-16 | 기반: `development` branch (`master`) → Railway `todaytable`
