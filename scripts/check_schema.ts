import { db, databaseProvider } from '../lib/db';

async function main() {
  const c = await db.connect();
  const cols = await c.query('PRAGMA table_info(users)');
  console.log('users:', cols.rows.map((r: any) => r.name).join(', '));
  const cols2 = await c.query('PRAGMA table_info(profiles)');
  console.log('profiles:', cols2.rows.map((r: any) => r.name).join(', '));
  const fk = await c.query('PRAGMA foreign_key_list(profiles)');
  console.log('fk on profiles:', JSON.stringify(fk.rows, null, 2));
  await c.release(); await db.end();
}
main();