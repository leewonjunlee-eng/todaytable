import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, before, after } from 'node:test';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

let db: typeof import('../lib/db').db;
let runMatching: typeof import('../lib/lifecycle-service').runMatching;
let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'todaytable-journey-'));
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.SQLITE_PATH = join(dir, 'journey.sqlite');
  ({ db } = await import('../lib/db'));
  ({ runMatching } = await import('../lib/lifecycle-service'));
  for (const name of (await readdir(join(process.cwd(), 'db/sqlite'))).filter(name => name.endsWith('.sql')).sort()) await db.execScript(await readFile(join(process.cwd(), 'db/sqlite', name), 'utf8'));
});
after(async () => { await db.end(); await rm(dir, { recursive: true, force: true }); });

test('real SQLite worker slice provisions reservation, room, topics, attendance and jobs idempotently', async () => {
  const admin = (await db.query<any>(`INSERT INTO users(email,password_hash,role) VALUES($1,'x','ADMIN') RETURNING id`, [`admin-${randomUUID()}@test.invalid`])).rows[0].id;
  const venue = (await db.query<any>(`INSERT INTO venues(name,area,address,capacity) VALUES('Mock venue','홍대/합정','mock address',6) RETURNING id`)).rows[0].id;
  const event = (await db.query<any>(`INSERT INTO events(title,starts_at,application_deadline,area,capacity,price_cents,created_by,venue_id) VALUES('journey',datetime('now','+2 day'),datetime('now','-1 minute'),'홍대/합정',6,8000,$1,$2) RETURNING id`, [admin, venue])).rows[0].id;
  for (let i = 0; i < 4; i += 1) {
    const user = (await db.query<any>(`INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id`, [`journey-${randomUUID()}@test.invalid`])).rows[0].id;
    await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,traits,desired_traits,consent_privacy,consent_operations,consented_at) VALUES($1,$2,'010',1990,'PREFER_NOT_TO_SAY','INTJ','["음악","여행"]','["대화"]','["대화"]',1,1,CURRENT_TIMESTAMP)`, [user, `J${i}`]);
    const application = (await db.query<any>(`INSERT INTO applications(user_id,request_key,pass_choice,pass_uses,amount_cents) VALUES($1,$2,'SINGLE',1,8000) RETURNING id`, [user, randomUUID()])).rows[0].id;
    const payment = (await db.query<any>(`INSERT INTO payments(application_id,idempotency_key,amount_cents,status) VALUES($1,$2,8000,'PAID') RETURNING id`, [application, `pay-${application}`])).rows[0].id;
    await db.query(`INSERT INTO application_options(application_id,event_id) VALUES($1,$2)`, [application, event]);
    await db.query(`INSERT INTO entitlements(user_id,source_payment_id,original_uses,remaining_uses) VALUES($1,$2,1,0)`, [user, payment]);
  }
  const result = await runMatching(event, 'journey-real');
  assert.equal(result.matchedCount, 4);
  assert.equal((await db.query(`SELECT count(*) count FROM table_reservations`)).rows[0].count, 0);
  const { claimJob, processJob } = await import('../worker/index');
  const provision = await claimJob('journey-provision');
  assert.equal(provision?.job_type, 'PROVISION_TABLE');
  await processJob(provision!, 'journey-provision');
  assert.equal((await db.query(`SELECT count(*) count FROM table_reservations`)).rows[0].count, 1);
  assert.equal((await db.query(`SELECT count(*) count FROM journey_rooms`)).rows[0].count, 1);
  assert.equal((await db.query(`SELECT json_array_length(topics) count FROM journey_rooms`)).rows[0].count >= 3, true);
  assert.equal((await db.query(`SELECT count(*) count FROM attendance_records`)).rows[0].count, 4);
  assert.equal((await db.query(`SELECT count(*) count FROM scheduled_jobs WHERE job_type IN ('JOURNEY_REMINDER','JOURNEY_FEEDBACK_REQUEST')`)).rows[0].count, 5);
  await db.query(`UPDATE scheduled_jobs SET run_at=CURRENT_TIMESTAMP,next_attempt_at=CURRENT_TIMESTAMP WHERE job_type='JOURNEY_REMINDER'`);
  const { tick } = await import('../worker/index');
  await tick('journey-test');
  await tick('journey-test');
  assert.equal((await db.query(`SELECT count(*) count FROM notifications WHERE channel='IN_APP'`)).rows[0].count >= 5, true);
  const replay = await runMatching(event, 'journey-real');
  assert.equal(replay.runId, result.runId);
});
