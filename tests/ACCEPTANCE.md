# Provider acceptance regression

Run from this directory:

```sh
npm run test:providers
TEST_DATABASE_URL=postgres://tt_test@127.0.0.1:55439/todaytable_test npm run test:providers
```

The harness launches `node --import tsx tests/provider-acceptance.ts` in an isolated child process for SQLite and, when configured, PostgreSQL. SQLite uses a temporary directory. PostgreSQL requires the exact dedicated URL above, creates a unique `tt_acceptance_*` schema through `PGOPTIONS`, runs the repository migrator twice, and drops the schema in `finally`. Every migration file is read by `scripts/migrate.ts` in lexical chronological order; no SQL is rewritten or duplicate errors ignored.

The suite intentionally continues after assertion failures and exits nonzero when any named case fails. Full child stdout/stderr and exit codes are written to `tests/scratchacceptance-newresults.json`. The file is scratch output and should not be committed. Failure messages identify the missing or broken route/service behavior; this suite does not weaken expectations to make a red case green.
