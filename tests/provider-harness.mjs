#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const root = process.cwd();
const results = join(root, 'tests/scratchacceptance-newresults.json');
const run = (env) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/provider-acceptance.ts'], { cwd: root, env: { ...process.env, ...env, ACCEPTANCE_RESULTS: results }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (b) => { stdout += b; process.stdout.write(b); });
  child.stderr.on('data', (b) => { stderr += b; process.stderr.write(b); });
  child.on('exit', (code, signal) => resolve({ code: code ?? 1, signal, stdout, stderr }));
});
const dir = await mkdtemp(join(tmpdir(), 'todaytable-provider-harness-'));
const runs = [];
try {
  runs.push({ provider: 'sqlite', ...(await run({ DATABASE_PROVIDER: 'sqlite', SQLITE_PATH: join(dir, 'isolated.sqlite') })) });
  if (process.env.TEST_DATABASE_URL) {
    if (process.env.TEST_DATABASE_URL !== 'postgres://tt_test@127.0.0.1:55439/todaytable_test') throw new Error('TEST_DATABASE_URL must be exactly postgres://tt_test@127.0.0.1:55439/todaytable_test');
    runs.push({ provider: 'postgres', ...(await run({ DATABASE_PROVIDER: 'postgres', DATABASE_URL: process.env.TEST_DATABASE_URL })) });
  } else console.warn('PG acceptance not run: set TEST_DATABASE_URL=postgres://tt_test@127.0.0.1:55439/todaytable_test');
} finally {
  await writeFile(results, JSON.stringify({ runs }, null, 2) + '\n');
  await rm(dir, { recursive: true, force: true });
}
if (runs.some((run) => run.code !== 0)) process.exitCode = 1;
