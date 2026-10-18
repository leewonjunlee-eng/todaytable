import { db, databaseProvider } from '../lib/db';

async function main() {
  const c = await db.connect();
  const cols = await c.query('PRAGMA table_info(profiles)');
  console.log(cols.rows.map((r: any) => r.name).join(', '));
  await c.release(); await db.end();
}
main();