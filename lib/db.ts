import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type QueryResult<Row = any> = {
  rows: Row[];
  rowCount: number;
};

export interface QueryClient {
  query<Row = any>(
    sql: string,
    params?: unknown[],
    sqliteSql?: string,
  ): Promise<QueryResult<Row>>;
  release(): void;
}

export type DatabaseProvider = 'sqlite' | 'postgres';

function selectedProvider(): DatabaseProvider {
  const configured = process.env.DATABASE_PROVIDER;
  if (configured && configured !== 'sqlite' && configured !== 'postgres') {
    throw new Error('DATABASE_PROVIDER must be sqlite or postgres.');
  }
  if (configured) return configured as DatabaseProvider;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Set DATABASE_PROVIDER=postgres in production.');
  }
  return 'sqlite';
}

export const databaseProvider = selectedProvider();

const sqlitePath = resolve(process.env.SQLITE_PATH ?? './data/todaytable.sqlite');
const sqliteHandles = new Set<any>();
let sqliteInitialized = false;

function loadNodeModule(name: string) {
  const moduleApi = (process as any).getBuiltinModule('node:module');
  const localRequire = moduleApi.createRequire(`${process.cwd()}/package.json`);
  return localRequire(name);
}

function openSqlite() {
  mkdirSync(dirname(sqlitePath), { recursive: true, mode: 0o700 });
  const { DatabaseSync } = loadNodeModule('node:sqlite') as { DatabaseSync: new (path: string) => any };
  const db = new DatabaseSync(sqlitePath);
  chmodSync(sqlitePath, 0o600);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 250;');
  if (!sqliteInitialized) {
    db.exec('PRAGMA journal_mode = WAL;');
    sqliteInitialized = true;
  }
  sqliteHandles.add(db);
  return db;
}

function sqliteValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('Z', '');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return new Date(value).toISOString().replace('T', ' ').replace('Z', '');
  }
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
  return value;
}

function parseJsonColumns(row: Record<string, unknown>) {
  for (const key of ['payload', 'before_data', 'after_data', 'interests', 'traits', 'desired_traits', 'food_budgets', 'events', 'event_titles', 'areas']) {
    const value = row[key];
    if (typeof value === 'string') {
      try { row[key] = JSON.parse(value); } catch { /* preserve malformed legacy data for inspection */ }
    }
  }
  for (const key of ['consent_privacy', 'consent_operations', 'active']) {
    if (row[key] === 0 || row[key] === 1) row[key] = row[key] === 1;
  }
  for (const key of ['created_at', 'updated_at', 'expires_at', 'run_at', 'next_attempt_at', 'lease_until', 'completed_at', 'consented_at', 'starts_at', 'application_deadline']) {
    const value = row[key];
    if (typeof value === 'string') {
      try {
        const utc = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
        row[key] = new Date(utc).toISOString();
      } catch { /* preserve invalid legacy timestamps */ }
    }
  }
  return row;
}

function runSqlite<Row>(connection: any, sql: string, params: unknown[] = []): QueryResult<Row> {
  const statement = connection.prepare(sql);
  const bindings = params.map(sqliteValue);
  if (statement.columns().length > 0) {
    const rows = statement.all(...bindings).map((row: Record<string, unknown>) => parseJsonColumns({ ...row })) as Row[];
    return { rows, rowCount: rows.length };
  }
  const result = statement.run(...bindings);
  return { rows: [], rowCount: Number(result.changes) };
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function withBusyRetry<T>(run: () => T): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return run(); }
    catch (error) {
      const sqliteError = error as { code?: string; errcode?: number };
      const busy = sqliteError.errcode === 5 || sqliteError.errcode === 6
        || sqliteError.code === 'SQLITE_BUSY' || sqliteError.code === 'SQLITE_LOCKED';
      if (!busy || attempt >= 9) throw error;
      await sleep(Math.min(20 * 2 ** attempt, 400));
    }
  }
}

async function loadPostgres() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when DATABASE_PROVIDER=postgres.');
  const { Pool } = loadNodeModule('pg') as { Pool: new (options: Record<string, unknown>) => any };
  const globalDb = globalThis as unknown as { todaytablePool?: any };
  if (!globalDb.todaytablePool) {
    globalDb.todaytablePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      ssl: process.env.DATABASE_SSL === 'require'
        ? { rejectUnauthorized: true, ca: process.env.DATABASE_SSL_CA }
        : undefined,
    });
  }
  return globalDb.todaytablePool;
}

async function runQuery<Row>(
  connection: any | undefined,
  sql: string,
  params: unknown[] = [],
  sqliteSql?: string,
): Promise<QueryResult<Row>> {
  if (databaseProvider === 'postgres') {
    const pool = await loadPostgres();
    const result = connection
      ? await connection.query(sql, params)
      : await pool.query(sql, params);
    return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
  }
  const db = connection ?? openSqlite();
  try {
    if (!sqliteSql && /\b(ANY\s*\(|array_agg\s*\(|json_build_object\s*\(|pg_advisory|SKIP LOCKED|::[a-z]+\[\]|\bdate_trunc\s*\(|\bextract\s*\()/i.test(sql)) {
      throw new Error(`PostgreSQL-only SQL requires an explicit SQLite query: ${sql.slice(0, 100)}`);
    }
    const selectedSql = sqliteSql ? sqliteSql.replace(/\$([1-9][0-9]*)/g, '?$1') : translateSqlite(sql);
    return await withBusyRetry(() => runSqlite<Row>(db, selectedSql, params));
  } finally {
    if (!connection) {
      db.close();
      sqliteHandles.delete(db);
    }
  }
}

function translateSqlite(sql: string) {
  return sql
    .replace(/::(?:uuid|jsonb|text|int|integer|smallint|timestamptz|timestamp|date)\b/gi, '')
    .replace(/\bnow\(\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\s+FOR\s+(?:NO\s+KEY\s+)?UPDATE\b/gi, '')
    .replace(/\s+FOR\s+SHARE\b/gi, '')
    .replace(/\bcount\(([^)]+)\)::int/gi, 'count($1)')
    .replace(/\bcoalesce\(sum\(([^)]+)\),0\)::int/gi, 'coalesce(sum($1),0)')
    .replace(/\$([1-9][0-9]*)/g, '?$1');
}

export const db = {
  async query<Row = any>(sql: string, params: unknown[] = [], sqliteSql?: string) {
    return runQuery<Row>(undefined, sql, params, sqliteSql);
  },
  async connect(): Promise<QueryClient> {
    if (databaseProvider === 'postgres') {
      const pool = await loadPostgres();
      const client = await pool.connect();
      return {
        query: (sql, params = [], sqliteSql) => runQuery(client, sql, params, sqliteSql),
        release: () => client.release(),
      };
    }
    const connection = openSqlite();
    let inTransaction = false;
    return {
      query: async <Row = any>(sql: string, params: unknown[] = [], sqliteSql?: string) => {
        if (/^\s*BEGIN\b/i.test(sql)) {
          await withBusyRetry(() => connection.exec('BEGIN IMMEDIATE'));
          inTransaction = true;
          return { rows: [], rowCount: 0 } as QueryResult<Row>;
        }
        if (/^\s*COMMIT\b/i.test(sql)) {
          connection.exec('COMMIT');
          inTransaction = false;
          return { rows: [], rowCount: 0 } as QueryResult<Row>;
        }
        if (/^\s*ROLLBACK\b/i.test(sql)) {
          if (inTransaction) connection.exec('ROLLBACK');
          inTransaction = false;
          return { rows: [], rowCount: 0 } as QueryResult<Row>;
        }
        if (!params.length && /;\s*\S/.test(sql.trim())) {
          await withBusyRetry(() => connection.exec(sql));
          return { rows: [], rowCount: 0 } as QueryResult<Row>;
        }
        return runQuery<Row>(connection, sql, params, sqliteSql);
      },
      release: () => {
        if (inTransaction) connection.exec('ROLLBACK');
        connection.close();
        sqliteHandles.delete(connection);
      },
    };
  },
  async end() {
    if (databaseProvider === 'postgres') {
      const globalDb = globalThis as unknown as { todaytablePool?: { end(): Promise<void> } };
      await globalDb.todaytablePool?.end();
      delete globalDb.todaytablePool;
      return;
    }
    for (const handle of sqliteHandles) {
      try { handle.close(); } catch { /* already released */ }
    }
    sqliteHandles.clear();
  },
  async execScript(sql: string) {
    if (databaseProvider === 'postgres') {
      const pool = await loadPostgres();
      await pool.query(sql);
      return;
    }
    const connection = openSqlite();
    try { await withBusyRetry(() => connection.exec(sql)); }
    finally {
      connection.close();
      sqliteHandles.delete(connection);
    }
  },
};

