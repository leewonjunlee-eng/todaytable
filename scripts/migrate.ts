import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { databaseProvider, db } from '../lib/db';

async function migrate() {
  const directory = join(process.cwd(), databaseProvider === 'sqlite' ? 'db/sqlite' : 'db/migrations');
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    [],
    'CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of names) {
    const existing = await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
    if (existing.rowCount) continue;
    const sql = await readFile(join(directory, name), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied ${databaseProvider} migration ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  await db.end();
}

migrate().catch(async (error) => {
  console.error(error);
  await db.end();
  process.exit(1);
});
