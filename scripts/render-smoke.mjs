#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestResponseMocks } from 'next/dist/server/lib/mock-request.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(projectRoot, 'package.json'));
const next = require('next');

const app = next({ dev: true, webpack: true, dir: projectRoot, hostname: 'localhost' });
const rendered = new Map();

async function request(handler, pathname, { method = 'GET', cookie, json } = {}) {
  const url = new URL(pathname, 'http://localhost:3000');
  const headers = { host: 'localhost:3000' };
  let body;
  if (cookie) headers.cookie = cookie;
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    headers.origin = 'http://localhost:3000';
    body = JSON.stringify(json);
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  const chunks = [];
  const socket = new Socket();
  const { req, res } = createRequestResponseMocks({
    url: `${url.pathname}${url.search}`,
    method,
    headers,
    socket,
    resWriter(chunk) { chunks.push(Buffer.from(chunk)); return true; },
  });
  if (body !== undefined) {
    req.push(body);
    req.push(null);
  }
  await handler(req, res);
  await res.headPromise;
  return {
    status: res.statusCode,
    headers: res.getHeaders(),
    text: Buffer.concat(chunks).toString('utf8'),
  };
}

function assertPage(response, pathname) {
  assert.equal(response.status, 200, `${pathname} should render successfully; got ${response.status}`);
  assert.match(response.text, /<!DOCTYPE html>/i, `${pathname} should return rendered HTML`);
  rendered.set(pathname, response.text);
}

async function login(handler, email, password) {
  const response = await request(handler, '/api/auth/login', {
    method: 'POST',
    json: { email, password },
  });
  assert.equal(response.status, 200, `login for ${email} should succeed; received ${response.status}: ${response.text}`);
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie, `login for ${email} should issue a session cookie`);
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie])
    .map(String)
    .find((value) => value.startsWith('todaytable_session='));
  assert.ok(cookie, `login for ${email} should issue todaytable_session`);
  return cookie.split(';', 1)[0];
}

let failure;
try {
  await app.prepare();
  const handler = app.getRequestHandler();

  assertPage(await request(handler, '/'), '/');
  assertPage(await request(handler, '/login'), '/login');

  const guestEmail = process.env.SEED_PARTICIPANT_EMAIL ?? 'guest@todaytable.local';
  const guestPassword = process.env.SEED_PARTICIPANT_PASSWORD ?? 'GuestDemo!2026';
  const guestCookie = await login(handler, guestEmail, guestPassword);
  for (const pathname of ['/profile', '/apply', '/applications']) {
    assertPage(await request(handler, pathname, { cookie: guestCookie }), pathname);
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@todaytable.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'AdminDemo!2026';
  const adminCookie = await login(handler, adminEmail, adminPassword);
  for (const pathname of ['/admin/events', '/admin/venues', '/admin/applications']) {
    assertPage(await request(handler, pathname, { cookie: adminCookie }), pathname);
  }

  const outputDir = path.join(projectRoot, '.data', 'render-smoke');
  await mkdir(outputDir, { recursive: true });
  for (const pathname of ['/', '/profile', '/apply', '/admin/events']) {
    const filename = `${pathname === '/' ? 'home' : pathname.slice(1).replaceAll('/', '-')}.html`;
    await writeFile(path.join(outputDir, filename), rendered.get(pathname));
  }
  console.log('Render smoke passed: landing, login, participant pages, and admin pages.');
  console.log(`Representative HTML saved under ${path.relative(projectRoot, outputDir)}/`);
} catch (error) {
  failure = error;
} finally {
  await app.close();
}

// Next's server bundle owns the SQLite handles opened by these requests, so
// app.close() cannot close that module-local set. Finish cleanup, flush output,
// and let process exit release those handles.
if (failure) {
  console.error(failure);
  await new Promise((resolve) => process.stderr.write('', resolve));
  process.exit(1);
}
await new Promise((resolve) => process.stdout.write('', resolve));
process.exit(0);
