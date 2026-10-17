# Railway worker service

Create a second Railway service from the same repository and select the existing `Dockerfile`. Set its start command to:

```sh
node --import tsx worker/index.ts
```

Set `DATABASE_PROVIDER=postgres`, `DATABASE_URL`, and the same database SSL settings used by the web service. Set a unique `WORKER_ID` for each worker process. `WORKER_POLL_MS` is optional and defaults to `2000`.

Leave the worker service's healthcheck path unset. The web service listens on port 3000 and uses `/` as its healthcheck; the worker process does not open an HTTP port. Keep the web service's `/` healthcheck on the web service only.

The image includes `db/` and `scripts/migrate.ts` so the migration command remains available for a controlled migration step:

```sh
node --import tsx scripts/migrate.ts
```

Apply migrations before starting the worker. The worker does not migrate the database during polling. Keep database credentials and VAPID private keys in Railway variables, never in image files.
