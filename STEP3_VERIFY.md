# Step 3 verification — DB backup / migration / deploy (2026-10-17)
- Backup: sudo pg_dump -d todaytable -> /tmp/todaytable-pg-backup-20261017.sql (2377 lines) OK
- Local PG schema_migrations: recovery docs confirm 001-013 applied (38 tables, refund_requests nullable verified)
- SQLite 006 SQL fixed (commit 286c9f7) → now in master
- Push: git push origin master OK (0a7cb7b -> 977127c); Railway web deploy triggered by link
- Migration script: npm run db:migrate available (scripts/migrate.ts); Railway PG DATABASE_URL not in env, so Railway-side 006-013 apply needs Railway env or manual psql
- Web deploy: code + 006 fix pushed; worker service not auto-created (WORKER_DEPLOYMENT.md manual step)
