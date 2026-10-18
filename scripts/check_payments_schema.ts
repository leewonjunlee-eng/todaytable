import { db, databaseProvider } from '../lib/db';

async function main() {
  const c = await db.connect();
  const cols = await c.query('PRAGMA table_info(payments)');
  console.log('payments:', cols.rows.map((r: any) => r.name).join(', '));
  const cols2 = await c.query('PRAGMA table_info(applications)');
  console.log('applications:', cols2.rows.map((r: any) => r.name).join(', '));
  await c.release(); await db.end();
}
main();