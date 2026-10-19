import { db } from '../lib/db';

async function main() {
  const c = await db.connect();
  const u = await c.query("SELECT email, role FROM users WHERE role='ADMIN'");
  console.log(u.rows);
  await c.release(); await db.end();
}
main();