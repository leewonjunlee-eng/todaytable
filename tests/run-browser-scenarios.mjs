#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const root = process.cwd();
const provider = process.env.BROWSER_DATABASE_PROVIDER ?? 'sqlite';
if (!['sqlite', 'postgres'].includes(provider)) throw new Error('BROWSER_DATABASE_PROVIDER must be sqlite or postgres.');
const dir = await mkdtemp(join(tmpdir(), 'todaytable-browser-'));
const schema = `tt_browser_${randomUUID().replaceAll('-', '')}`;
const appEnv = { ...process.env, NODE_ENV: 'development', DATABASE_PROVIDER: provider, SESSION_SECRET: `browser-scenario-${randomUUID()}-session-secret`, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE ?? '/tmp/todaytable-browser-tools/node_modules/playwright/index.mjs' };
let pg;
let server;
let serverSchemaCreated = false;

function run(command, args, env, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
    child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${label} exited with ${code ?? signal}`)));
  });
}

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next server exited early with ${child.exitCode}.`);
    try { const response = await fetch(url); if (response.status < 500) return; } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Next server did not become ready at ${url}.`);
}

try {
  if (provider === 'postgres') {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('Set TEST_DATABASE_URL to the dedicated local browser test database.');
    const parsed = new URL(url);
    if (decodeURIComponent(parsed.username) !== 'tt_test' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55439' || !parsed.pathname.slice(1).endsWith('_test')) throw new Error('Refusing PostgreSQL target; require local tt_test@127.0.0.1:55439/*_test.');
    const pgModule = await import('pg');
    pg = new pgModule.default.Client({ connectionString: url });
    await pg.connect();
    await pg.query(`CREATE SCHEMA "${schema}"`);
    serverSchemaCreated = true;
    appEnv.DATABASE_URL = url;
    appEnv.PGOPTIONS = `-c search_path=${schema},public`;
  } else {
    appEnv.SQLITE_PATH = join(dir, 'todaytable.sqlite');
  }

  await run(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], appEnv, 'migrate');
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  appEnv.PORT = String(port);
  appEnv.APP_URL = baseUrl;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env: appEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => process.stdout.write(`[next] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[next] ${chunk}`));
  await waitForServer(`${baseUrl}/login`, server);
  await run(process.execPath, ['--import', 'tsx', 'tests/browser-scenarios.ts'], { ...appEnv, BASE_URL: baseUrl }, 'browser-scenarios');
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise((resolve) => server.once('exit', resolve)); }
  if (serverSchemaCreated && pg) await pg.query(`DROP SCHEMA "${schema}" CASCADE`);
  if (pg) await pg.end();
  await rm(dir, { recursive: true, force: true });
}
