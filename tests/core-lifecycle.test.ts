import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

let db: typeof import('../lib/db').db; let runMatching: typeof import('../lib/lifecycle-service').runMatching; let repairTable: typeof import('../lib/lifecycle-service').repairTable; let dir: string; let fixtureEvent=''; let fixtureApps:string[]=[];
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'todaytable-core-')); process.env.DATABASE_PROVIDER='sqlite'; process.env.SQLITE_PATH=join(dir,'core.sqlite');
  ({ db } = await import('../lib/db')); ({ runMatching, repairTable } = await import('../lib/lifecycle-service'));
  for (const name of ['001_foundation.sql','002_matching.sql','003_reservation.sql','004_attendance.sql','005_notification.sql','006_core_lifecycle.sql','007_lifecycle_hardening.sql','008_journey_backend.sql','009_backend_hardening.sql','010_attendance_candidates.sql','011_provisioning_push.sql']) await db.execScript(await readFile(join(process.cwd(),'db/sqlite',name),'utf8'));
});
after(async () => { await db.end(); await rm(dir,{recursive:true,force:true}); });
test('SQLite lifecycle persists deterministic 4+4 groups and rejects a 9-year span', async () => {
  const admin = (await db.query<any>(`INSERT INTO users(email,password_hash,role) VALUES($1,'x','ADMIN') RETURNING id`, [`a-${randomUUID()}@test.invalid`])).rows[0].id;
  const event = (await db.query<any>(`INSERT INTO events(title,starts_at,application_deadline,area,capacity,price_cents,created_by) VALUES('core',datetime('now','+1 day'),datetime('now','-1 minute'),'홍대/합정',30,8000,$1) RETURNING id`,[admin])).rows[0].id;
  fixtureEvent=event;
  for (let i=0;i<8;i+=1) {
    const user=(await db.query<any>(`INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id`,[`u-${randomUUID()}@test.invalid`])).rows[0].id;
    await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,traits,desired_traits,consent_privacy,consent_operations,consented_at) VALUES($1,$2,'010',${1990+i%7},'PREFER_NOT_TO_SAY','INTJ','["음악"]','["깊은 대화를 좋아함"]','["깊은 대화가 되는 사람"]',1,1,CURRENT_TIMESTAMP)`,[user,`U${i}`]);
    const app=(await db.query<any>(`INSERT INTO applications(user_id,request_key,pass_choice,pass_uses,amount_cents) VALUES($1,$2,'SINGLE',1,8000) RETURNING id`,[user,randomUUID()])).rows[0].id;
    fixtureApps.push(app);
    const pay=(await db.query<any>(`INSERT INTO payments(application_id,idempotency_key,amount_cents,status) VALUES($1,$2,8000,'PAID') RETURNING id`,[app,`p-${app}`])).rows[0].id;
    await db.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',[app,event]); await db.query('INSERT INTO entitlements(user_id,source_payment_id,original_uses,remaining_uses) VALUES($1,$2,1,0)',[user,pay]);
  }
  const result=await runMatching(event,'sqlite-test'); assert.equal(result.matchedCount,8); assert.equal(result.groups.length,2);
  assert.equal((await db.query<any>('SELECT count(*) count FROM table_members WHERE status=\'ACTIVE\'')).rows[0].count,8);
  const replay=await runMatching(event,'sqlite-test'); assert.equal(replay.runId,result.runId);
});

test('repairTable fills a three-person table with a paid, consented eligible applicant', async () => {
  const table=(await db.query<any>("SELECT id FROM dining_tables WHERE event_id=$1 ORDER BY table_number LIMIT 1",[fixtureEvent])).rows[0].id;
  const removed=(await db.query<any>("SELECT application_id FROM table_members WHERE table_id=$1 AND status='ACTIVE' ORDER BY user_id LIMIT 1",[table])).rows[0].application_id;
  await db.query("UPDATE table_members SET status='REMOVED' WHERE table_id=$1 AND application_id=$2",[table,removed]);
  await db.query("UPDATE applications SET status='CANCELED',matching_status='NO_MATCH' WHERE id=$1",[removed]);
  const alternate=(await db.query<any>(`INSERT INTO events(title,starts_at,application_deadline,area,capacity,price_cents,created_by) VALUES('alternate',datetime('now','+2 day'),datetime('now','-1 minute'),'홍대/합정',20,8000,(SELECT id FROM users WHERE role='ADMIN' LIMIT 1)) RETURNING id`,[])).rows[0].id;
  const survivors=await db.query<any>("SELECT application_id FROM table_members WHERE table_id=$1 AND status='ACTIVE'",[table]);
  for(const member of survivors.rows) await db.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',[member.application_id,alternate]);
  await db.query('UPDATE events SET capacity=7 WHERE id=$1',[fixtureEvent]);
  const user=(await db.query<any>(`INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id`,[`repair-${randomUUID()}@test.invalid`])).rows[0].id;
  await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,traits,desired_traits,consent_privacy,consent_operations,consented_at) VALUES($1,'Repair','010',1992,'WOMAN','INTJ','["음악"]','[]','[]',1,1,CURRENT_TIMESTAMP)`,[user]);
  const app=(await db.query<any>(`INSERT INTO applications(user_id,request_key,pass_choice,pass_uses,amount_cents) VALUES($1,$2,'SINGLE',1,8000) RETURNING id`,[user,randomUUID()])).rows[0].id;
  await db.query(`INSERT INTO payments(application_id,idempotency_key,amount_cents,status) VALUES($1,$2,8000,'PAID')`,[app,`repair-${app}`]);
  await db.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',[app,fixtureEvent]);
  await db.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',[app,alternate]);
  const result=await repairTable(table,fixtureEvent);
  assert.equal(result.status,'REPAIRED');
  assert.equal((await db.query<any>('SELECT event_id FROM dining_tables WHERE id=$1',[table])).rows[0].event_id,alternate);
  assert.equal(Number((await db.query<any>("SELECT count(*) count FROM table_members WHERE table_id=$1 AND status='ACTIVE'",[table])).rows[0].count),4);
  assert.equal((await db.query<any>("SELECT matching_status FROM applications WHERE id=$1",[app])).rows[0].matching_status,'CONFIRMED');
});

test('repairTable records an admin exception when the compatible cohort stays below four', async () => {
  const table=(await db.query<any>("SELECT id FROM dining_tables WHERE event_id=$1 ORDER BY table_number DESC LIMIT 1",[fixtureEvent])).rows[0].id;
  const removed=(await db.query<any>("SELECT application_id FROM table_members WHERE table_id=$1 AND status='ACTIVE' ORDER BY user_id LIMIT 1",[table])).rows[0].application_id;
  await db.query("UPDATE table_members SET status='REMOVED' WHERE table_id=$1 AND application_id=$2",[table,removed]);
  await db.query("UPDATE applications SET status='CANCELED',matching_status='NO_MATCH' WHERE id=$1",[removed]);
  const result=await repairTable(table,fixtureEvent);
  assert.equal(result.status,'EXCEPTION');
  assert.equal(Number((await db.query<any>("SELECT count(*) count FROM lifecycle_exceptions WHERE source='repair_table' AND entity_id=$1",[table])).rows[0].count),1);
});
