# Backend contract delta

- Matching creates `dining_tables` with `status=CONFIRMED` and `provision_status=PENDING`; it only inserts one deterministic `PROVISION_TABLE` job (`provision:<tableId>`). Venue allocation, mock reservation, journey room/system messages, attendance, and notifications occur only in the worker handler.
- `PROVISION_TABLE` is retryable and records `lifecycle_exceptions` with `source='dining_table'`; retry-exception resolves/re-enqueues `provision:<tableId>` rather than treating the table UUID as a job key.
- Admin journey POST and application cancellation now commit or rollback before every response. Cancellation rejects same-calendar-day cancellation, never falsely confirms a remaining three-person table, marks it `EXCEPTION`, and queues `REPAIR_TABLE`.
- Attendance admin aggregation returns the actual `tm.table_id` and joins it to the event's dining table.
- Push subscription endpoints require HTTPS and an allowlisted public push-service host; IP/private/arbitrary endpoints are rejected. Push config is true only with structurally valid VAPID public/private keys and subject. `web-push@3.6.7` is pinned in package files; no credentials are present or published.
- `PUSH_NOTIFICATION` uses `push_deliveries` uniqueness, disables 404/410 subscriptions, records failures for retry, and refuses to mark work sent when VAPID config is incomplete. The worker transport is injectable at the transport seam for tests.

## Remaining verification / known gap

- VAPID credentials are intentionally not configured and no real push was sent. On 2026-10-17, typecheck, SQLite acceptance (19 cases), the full test command, in-process TypeScript production build, and Next.js render smoke passed. PostgreSQL and browser interaction verification remain pending; see `RESUME_STATUS.md`.
- Automatic post-cancellation reallocation still requires a consented rematch implementation; the repair job deliberately preserves `EXCEPTION` rather than hard-relaxing constraints or falsely confirming a table.
