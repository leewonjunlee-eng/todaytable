import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('operations demo is transactional, repeat-safe, and feeds actual participant and finance APIs', async () => {
  const dir=await mkdtemp(join(tmpdir(),'todaytable-operations-'));
  process.env.DATABASE_PROVIDER='sqlite'; process.env.SQLITE_PATH=join(dir,'demo.sqlite');
  process.env.SESSION_SECRET=`operations-${randomUUID()}-secret`;
  const {db}=await import('../lib/db');
  try {
    for (const name of (await readdir('db/sqlite')).filter(n=>n.endsWith('.sql')).sort()) await db.execScript(await readFile(join('db/sqlite',name),'utf8'));
    const admin=(await db.query<any>("INSERT INTO users(email,password_hash,role) VALUES('admin@test.invalid','x','ADMIN') RETURNING id")).rows[0].id;
    const viewer=(await db.query<any>("INSERT INTO users(email,password_hash) VALUES('user@todaytable.local','unchanged') RETURNING id")).rows[0].id;
    const {seedOperations}=await import('../scripts/seed-operations');
    const seeded=await seedOperations(); assert.equal(seeded.created,true); assert.equal(seeded.applications,60); assert.equal(seeded.tables,6);
    const counts=async()=> (await db.query<any>(`SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM payments) payments,(SELECT COUNT(*) FROM notifications) notifications`)).rows[0];
    const before=await counts(); assert.equal((await seedOperations()).created,false); assert.deepEqual(await counts(),before);
    assert.equal((await db.query<any>('SELECT password_hash FROM users WHERE id=$1',[viewer])).rows[0].password_hash,'unchanged');
    assert.equal((await db.query("SELECT 1 FROM payments WHERE provider<>'MOCK'")).rowCount,0);
    assert.equal((await db.query("SELECT 1 FROM entitlement_entries WHERE entry_type='USE'")).rowCount,60);
    assert.equal((await db.query('SELECT 1 FROM table_reservations')).rowCount,6);
    assert.equal((await db.query('SELECT 1 FROM journey_feedback')).rowCount,15);
    const {tokenHash}=await import('../lib/security');
    const token=randomUUID(), viewerToken=randomUUID();
    for (const [user,t] of [[admin,token],[viewer,viewerToken]]) await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,datetime('now','+1 hour'))",[user,tokenHash(t)]);
    const {GET}=await import('../app/api/admin/journey/route');
    const response=await GET(new Request('http://localhost/api/admin/journey',{headers:{cookie:`todaytable_session=${token}`}}));
    assert.equal(response.status,200); const body=await response.json();
    assert.equal(body.demo,true); assert.equal(body.finance.simulated,true); assert.equal(body.finance.paymentCount,60);
    assert.equal(body.finance.refunded,23000); assert.ok(body.finance.paid>400000); assert.equal(body.payments.length,20);
    assert.equal((await GET(new Request('http://localhost/api/admin/journey',{headers:{cookie:`todaytable_session=${viewerToken}`}}))).status,403);
    const journey=await import('../app/api/journey/route');
    const own=await (await journey.GET(new Request('http://localhost/api/journey',{headers:{cookie:`todaytable_session=${viewerToken}`}}))).json();
    assert.equal(own.applications.length,3); assert.equal(own.history.length,1); assert.equal(own.upcoming.length,1); assert.ok(own.notifications.length>0); assert.ok(own.entitlements.length>0);
  } finally {await db.end(); await rm(dir,{recursive:true,force:true});}
});
