# Todaytable Deployment Guide

## Railway Deployment

This project is configured for deployment to Railway using Docker. See [current status](docs/STATUS.md) for verification failures and active deployment IDs before deploying local changes.

### Prerequisites
- Railway account
- GitHub repository linked to Railway

### Services
The deployment consists of three services:
1. **Web Service** - Runs the Next.js web application
2. **Worker Service** - Runs background job processing
3. **PostgreSQL Service** - Managed PostgreSQL database

### Railway Configuration

#### Web Service
- **Start Command**: `node server.js` (default from Dockerfile)
- **Port**: Automatically detected from `PORT` environment variable
- **Health Check Path**: `/`

#### Worker Service
- **Start Command**: `node --env-file-if-exists=.env.local --import tsx worker/index.ts`
- **No port needed** (background worker)

#### PostgreSQL Service
- Railway-managed PostgreSQL
- Connection string provided via `DATABASE_URL` environment variable

### Environment Variables
Set these in Railway dashboard:

```
DATABASE_PROVIDER=postgres
DATABASE_URL=postgres://user:password@host:port/database
SESSION_SECRET=your-32-plus-character-secret
APP_URL=https://your-app.railway.app
WORKER_ID=railway-worker-1
```

### Deployment Steps
1. Connect your GitHub repository to Railway
2. Railway will auto-detect the Dockerfile and build the image
3. Create three services:
   - Web service: Use default Dockerfile command
   - Worker service: Override start command to run worker script
   - PostgreSQL service: Add PostgreSQL plugin
4. Link services together in Railway dashboard
5. Set environment variables on both web and worker services. Leave the worker HTTP health check unset; see [worker deployment](WORKER_DEPLOYMENT.md).
6. Back up the target database and apply migrations with `node --import tsx scripts/migrate.ts` before starting compatible web and worker versions.
7. Enable automatic deploys from GitHub only after the current verification failures are resolved.

### Local Development with Docker
```bash
# Build the image
docker build -t todaytable .

# Run web service
docker run -p 3000:3000 -e DATABASE_PROVIDER=postgres -e DATABASE_URL=... -e SESSION_SECRET=... todaytable

# Run worker service
docker run -e DATABASE_PROVIDER=postgres -e DATABASE_URL=... -e SESSION_SECRET=... todaytable node --import tsx worker/index.ts
```

### Notes
- The Dockerfile is optimized for production with multi-stage build
- Uses Next.js standalone output for smaller image size
- Runs as non-root user for security
- Telemetry disabled in production

## Verified release and recovery (2026-10-18)

Current deployment IDs and evidence are in [current status](docs/STATUS.md). The release source archive is `.data/product-goal-release.tgz`; its allowlist excludes `.env*`, DB backups, original meeting media and unrelated screenshots. Do not upload `.data/` itself.

The PostgreSQL migrations are additive through 019. The original public/provided_data snapshot and row preservation report are kept privately under `.data/production-before-product-goal.json` and `.data/production-preservation-report.json`. The original 50 users, 60 applications/payments, six confirmed tables and 294 source responses were compared, including original workbook bytes. New operator credentials are stored only in `.data/production-operator-credentials.json` with mode 0600.

For a service rollback, use the Railway deployment history to select the prior verified web and worker images as a compatible pair. The API's `canRollback`/`canRedeploy` flags were checked; production services were not rolled back as part of verification. Keep the additive schema and existing data in place. Returning to a pre-extension worker also requires retiring pending `UPDATE_PREFERENCE_SIGNALS` jobs before that old worker starts, because it lacks that handler. Do not drop the new tables or overwrite the production database to roll back application code. Recheck the chosen image's schema expectations and preserve a fresh backup before a recovery action.

Matching policy rollback is independent: compare again and reapply the prior immutable policy. This was executed on a demo event and restored `core-v1` without changing any confirmed table. The production default retains the original matching weights.
