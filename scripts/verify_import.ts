import { db } from '../lib/db';

async function main() {
  const c = await db.connect();
  const u = await c.query('SELECT COUNT(*) as c FROM users WHERE is_demo=1');
  const a = await c.query('SELECT COUNT(*) as c FROM applications WHERE is_demo=1');
  const p = await c.query('SELECT status, COUNT(*) as c FROM payments GROUP BY status');
  const e = await c.query('SELECT COUNT(*) as c FROM entitlements');
  const n = await c.query('SELECT COUNT(*) as c FROM notifications');
  console.log('users:', u.rows[0].c);
  console.log('applications:', a.rows[0].c);
  console.log('payments:', p.rows);
  console.log('entitlements:', e.rows[0].c);
  console.log('notifications:', n.rows[0].c);
  await c.release(); await db.end();
}
main();