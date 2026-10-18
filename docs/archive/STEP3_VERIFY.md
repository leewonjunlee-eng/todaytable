> 과거 기록 보관본입니다. 최신 상태와 검증 결과는 [현재 현황](../STATUS.md)을 기준으로 확인하세요.

# Step 3 verification — DB backup / migration / deploy (2026-10-17)
- Backup: sudo pg_dump -d todaytable -> /tmp/todaytable-pg-backup-20261017.sql (2377 lines) OK
- Local PG schema_migrations: recovery docs confirm 001-013 applied (38 tables, refund_requests nullable verified)
- SQLite 006 SQL fixed (commit 286c9f7) → now in master
- Push: git push origin master OK (0a7cb7b -> 977127c); Railway web deploy triggered by link
- Migration script: npm run db:migrate available (scripts/migrate.ts); Railway PG DATABASE_URL not in env, so Railway-side 006-013 apply needs Railway env or manual psql
- Web deploy: code + 006 fix pushed; worker service not auto-created (WORKER_DEPLOYMENT.md manual step)

- 2026-10-17 DB connection attempt with provided URL: ENOTFOUND (postgres.railway.internal unresolvable from session, Tailscale active but not mapped to this host). URL syntax/credentials valid. Migration requires Railway console or redeploy with DATABASE_URL in Railway env variables; direct psql/app migrate blocked by host DNS/network isolation. .env.local restored after temporary rename.
