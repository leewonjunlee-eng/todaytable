# Todaytable Deployment Guide

## Railway Deployment

This project is configured for deployment to Railway using Docker.

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
5. Set environment variables as needed
6. Enable automatic deploys from GitHub

### Local Development with Docker
```bash
# Build the image
docker build -t todaytable .

# Run web service
docker run -p 3000:3000 -e DATABASE_URL=... -e SESSION_SECRET=... todaytable

# Run worker service
docker run -e DATABASE_URL=... -e SESSION_SECRET=... todaytable node --import tsx worker/index.ts
```

### Notes
- The Dockerfile is optimized for production with multi-stage build
- Uses Next.js standalone output for smaller image size
- Runs as non-root user for security
- Telemetry disabled in production