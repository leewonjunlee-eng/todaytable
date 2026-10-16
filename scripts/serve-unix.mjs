#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { chmod, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configuredSocketPath = process.env.TODAYTABLE_SOCKET ?? '/tmp/todaytable.sock';
if (!path.isAbsolute(configuredSocketPath)) throw new Error('TODAYTABLE_SOCKET must be an absolute path.');
const socketPath = path.resolve(configuredSocketPath);
const moduleRoot = path.resolve(process.env.TODAYTABLE_NODE_MODULES ?? path.join(projectRoot, 'node_modules'));
const dev = process.env.NODE_ENV !== 'production';

if (socketPath.length > 100) throw new Error('TODAYTABLE_SOCKET path is too long for a Unix socket.');

process.env.NODE_PATH = [moduleRoot, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
const { Module } = await import('node:module');
Module._initPaths();

const appRequire = createRequire(path.join(path.dirname(moduleRoot), 'package.json'));
let next;
try {
  next = appRequire('next');
} catch (error) {
  throw new Error(
    `Could not load Next.js from ${moduleRoot}. Install project dependencies or set TODAYTABLE_NODE_MODULES.`,
    { cause: error },
  );
}

async function removeStaleSocket() {
  let stat;
  try {
    stat = await lstat(socketPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isSocket()) throw new Error(`Refusing to replace non-socket path: ${socketPath}`);

  await new Promise((resolve, reject) => {
    const probe = connect(socketPath);
    probe.once('connect', () => {
      probe.destroy();
      reject(new Error(`Another server is already listening on ${socketPath}`));
    });
    probe.once('error', (error) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolve();
      else reject(error);
    });
  });
  await unlink(socketPath);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
}

await removeStaleSocket();
let handler;
const server = createServer((request, response) => {
  if (!handler) {
    response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Server is starting');
    return;
  }
  Promise.resolve(handler(request, response)).catch((error) => {
    console.error('Next.js request failed', error);
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Internal Server Error');
  });
});
const app = next({ dev, dir: projectRoot, hostname: 'localhost', httpServer: server });
let ownsSocket = false;
let shuttingDown = false;
try {
  await app.prepare();
  handler = app.getRequestHandler();
  await listen(server);
  ownsSocket = true;
  await chmod(socketPath, 0o600);
  console.log(`Todaytable ${dev ? 'development' : 'production'} server listening on ${socketPath}`);
} catch (error) {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await app.close?.();
  if (ownsSocket) {
    try { await unlink(socketPath); } catch (cleanupError) { if (cleanupError?.code !== 'ENOENT') throw cleanupError; }
  }
  throw error;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing Todaytable server.`);
  await new Promise((resolve) => server.close(resolve));
  await app.close?.();
  if (ownsSocket) {
    try { await unlink(socketPath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
