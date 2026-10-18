# PostgreSQL integration tests

These tests execute the checked-in SQL migrations and actual application/worker services against PostgreSQL. They report explicit skips if `TEST_DATABASE_URL` is unset. Use a dedicated database whose name includes `test` (for example `todaytable_test`); the harness creates and drops only a uniquely named `tt_test_*` schema inside it. It never resets `public` or the database itself.

Run after installing project dependencies:

```sh
TEST_DATABASE_URL=postgres://localhost/todaytable_test npm run test:integration
```

The database role needs permission to create a schema in the dedicated test database. The tests use real PostgreSQL transactions and row locks; they do not replace them with mocks or an in-memory database.

# In-process rendered page smoke check

With the seeded development database and project dependencies available, run:

```sh
npm run test:render
```

This prepares the real Next.js app and passes requests directly to its request handler, without opening a TCP or Unix listener. It logs in through the real auth route, renders participant and admin pages against the configured database, and saves representative HTML under `.data/render-smoke/` (ignored by git).

# Product and keyboard browser scenarios

See [validation guide](../docs/VALIDATION.md) for the isolated browser fixture setup, production bundle checks and PostgreSQL product suites.
