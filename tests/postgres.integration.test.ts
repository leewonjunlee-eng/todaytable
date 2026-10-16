import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'pg';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skipReason = testDatabaseUrl
  ? false
  : 'Set TEST_DATABASE_URL to a dedicated PostgreSQL test database to run live integration tests.';
const schema = `tt_test_${randomUUID().replaceAll('-', '')}`;
const originalEnv = {
  DATABASE_PROVIDER: process.env.DATABASE_PROVIDER,
  DATABASE_URL: process.env.DATABASE_URL,
  PGOPTIONS: process.env.PGOPTIONS,
  SESSION_SECRET: process.env.SESSION_SECRET,
};
let client: Client;
let submitApplication: (userId: string, body: {eventIds: unknown; pass: unknown; requestKey: unknown}) => Promise<{id:string; payment:string; amount:number; created:boolean}>;
let worker: typeof import('../worker/index');
let closePool: (() => Promise<void>) | undefined;
let applicationOwnerId: string;
let adminUserId: string;

before(async () => {
  if (!testDatabaseUrl) return;
  const parsed = new URL(testDatabaseUrl!);
  const dbName = decodeURIComponent(parsed.pathname.slice(1));
  if (!/(^|[_-])test([_-]|$)/i.test(dbName)) {
    throw new Error(`Refusing integration tests against database "${dbName}". TEST_DATABASE_URL must name a dedicated *_test database.`);
  }
  const { Client: PgClient } = await import('pg');
  client = new PgClient({ connectionString: testDatabaseUrl });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  const migrationsDir = join(process.cwd(), 'db/migrations');
  for (const name of (await readdir(migrationsDir)).filter(x => x.endsWith('.sql')).sort()) {
    await client.query(await readFile(join(migrationsDir, name), 'utf8'));
  }
  // Application and worker services use the shared Pool. Route its connections
  // into this test's schema before loading those modules.
  process.env.DATABASE_PROVIDER = 'postgres';
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.PGOPTIONS = `-c search_path=${schema},public`;
  process.env.SESSION_SECRET = `integration-test-${randomUUID()}-secret-material`;
  const { db } = await import('../lib/db');
  closePool = () => db.end();
  ({ submitApplication } = await import('../lib/application-service'));
  worker = await import('../worker/index');
});

after(async () => {
  if (!client) return;
  try {
    await closePool?.();
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  } finally {
    await client.end();
    restoreEnv('DATABASE_PROVIDER', originalEnv.DATABASE_PROVIDER);
    restoreEnv('DATABASE_URL', originalEnv.DATABASE_URL);
    restoreEnv('PGOPTIONS', originalEnv.PGOPTIONS);
    restoreEnv('SESSION_SECRET', originalEnv.SESSION_SECRET);
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('schema preserves one payment per application and one entitlement grant per payment', { skip: skipReason }, async () => {
  const u = await client.query(`INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id`, [`${randomUUID()}@test.invalid`]);
  const userId = u.rows[0].id;
  const a = await client.query(`INSERT INTO applications(user_id,request_key,pass_choice,pass_uses,amount_cents) VALUES($1,$2,'THREE_PASS',3,15000) RETURNING id`, [userId, randomUUID()]);
  const appId = a.rows[0].id;
  const p = await client.query(`INSERT INTO payments(application_id,idempotency_key,amount_cents,status) VALUES($1,$2,15000,'PAID') RETURNING id`, [appId, `test:${appId}`]);
  const paymentId = p.rows[0].id;
  await assert.rejects(client.query(`INSERT INTO payments(application_id,idempotency_key,amount_cents) VALUES($1,$2,15000)`, [appId, `duplicate:${appId}`]));
  await client.query(`INSERT INTO entitlements(user_id,source_payment_id,original_uses,remaining_uses) VALUES($1,$2,3,3)`, [userId, paymentId]);
  await assert.rejects(client.query(`INSERT INTO entitlements(user_id,source_payment_id,original_uses,remaining_uses) VALUES($1,$2,3,3)`, [userId, paymentId]));
});

test('application replay is concurrency-safe, reuses payment, debits owned passes, and rejects invalid reuse', { skip: skipReason }, async () => {
  const user = await client.query(`INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id`, [`${randomUUID()}@test.invalid`]);
  const userId = user.rows[0].id;
  applicationOwnerId = userId;
  const otherUser = await client.query(`INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id`, [`${randomUUID()}@test.invalid`]);
  const admin = await client.query(`INSERT INTO users(email,password_hash,role) VALUES($1,'x','ADMIN') RETURNING id`, [`${randomUUID()}@test.invalid`]);
  adminUserId = admin.rows[0].id;
  await client.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,consent_privacy,consent_operations,consented_at) VALUES($1,'Test','01000000000',1990,'PREFER_NOT_TO_SAY','INTJ',true,true,now())`, [userId]);
  await client.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,consent_privacy,consent_operations,consented_at) VALUES($1,'Other','01000000001',1990,'PREFER_NOT_TO_SAY','INTJ',true,true,now())`, [otherUser.rows[0].id]);
  const intruder = await client.query(`INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id`, [`${randomUUID()}@test.invalid`]);
  await client.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,consent_privacy,consent_operations,consented_at) VALUES($1,'Intruder','01000000002',1990,'PREFER_NOT_TO_SAY','INTJ',true,true,now())`, [intruder.rows[0].id]);
  const events = await client.query(`INSERT INTO events(title,starts_at,application_deadline,area,capacity,price_cents,created_by) VALUES ('one',now()+interval '1 day',now()+interval '1 hour','홍대',10,8000,$1),('two',now()+interval '2 days',now()+interval '1 hour','강남',10,8000,$1),('three',now()+interval '3 days',now()+interval '1 hour','을지로',10,8000,$1) RETURNING id`, [admin.rows[0].id]);
  const requestKey = randomUUID();
  const concurrent = await Promise.all([
    submitApplication(userId, {eventIds: [events.rows[0].id], pass: 'THREE_PASS', requestKey}),
    submitApplication(userId, {eventIds: [events.rows[0].id], pass: 'THREE_PASS', requestKey}),
  ]);
  const submitted = concurrent[0];
  assert.equal(concurrent.filter((x) => x.created).length, 1);
  assert.equal(concurrent[0].id, concurrent[1].id);
  const replay = await submitApplication(userId, {eventIds: [events.rows[0].id], pass: 'THREE_PASS', requestKey});
  assert.equal(replay.id, submitted.id);
  assert.equal(replay.created, false);
  await assert.rejects(submitApplication(userId, {eventIds: [events.rows[1].id], pass: 'THREE_PASS', requestKey}));
  await assert.rejects(submitApplication(userId, {eventIds: [events.rows[0].id], pass: 'SINGLE', requestKey: randomUUID()}));
  const counts = await client.query(`SELECT
    (SELECT count(*) FROM applications WHERE user_id=$1) applications,
    (SELECT count(*) FROM payments p JOIN applications a ON a.id=p.application_id WHERE a.user_id=$1) payments,
    (SELECT count(*) FROM entitlements WHERE user_id=$1) entitlements,
    (SELECT count(*) FROM entitlement_entries e JOIN applications a ON a.id=e.application_id WHERE a.user_id=$1 AND e.entry_type='USE') uses,
    (SELECT remaining_uses FROM entitlements WHERE user_id=$1) remaining`, [userId]);
  assert.deepEqual(counts.rows[0], {applications: '1', payments: '1', entitlements: '1', uses: '1', remaining: 2});

  const foreignPass = await client.query(`INSERT INTO entitlements(user_id,original_uses,remaining_uses) VALUES($1,1,1) RETURNING id`, [otherUser.rows[0].id]);
  await assert.rejects(submitApplication(intruder.rows[0].id, {eventIds: [events.rows[1].id], pass: 'EXISTING_PASS', requestKey: randomUUID()}));
  const stillAvailable = await client.query('SELECT remaining_uses FROM entitlements WHERE id=$1', [foreignPass.rows[0].id]);
  assert.equal(stillAvailable.rows[0].remaining_uses, 1);

  const usedExisting = await submitApplication(userId, {eventIds: [events.rows[1].id], pass: 'EXISTING_PASS', requestKey: randomUUID()});
  assert.equal(usedExisting.created, true);
  const remainingAfterReuse = await client.query('SELECT remaining_uses FROM entitlements WHERE user_id=$1', [userId]);
  assert.equal(remainingAfterReuse.rows[0].remaining_uses, 1);
  await client.query('UPDATE entitlements SET remaining_uses=0 WHERE user_id=$1', [userId]);
  await assert.rejects(submitApplication(userId, {eventIds: [events.rows[2].id], pass: 'EXISTING_PASS', requestKey: randomUUID()}));
  const expired = await client.query(`INSERT INTO entitlements(user_id,original_uses,remaining_uses,expires_at) VALUES($1,1,1,now()-interval '1 day') RETURNING id`, [intruder.rows[0].id]);
  assert.ok(expired.rows[0].id);
  await assert.rejects(submitApplication(intruder.rows[0].id, {eventIds: [events.rows[2].id], pass: 'EXISTING_PASS', requestKey: randomUUID()}));
  const rolledBack = await client.query(`SELECT
    (SELECT count(*) FROM applications WHERE user_id=$1) owner_applications,
    (SELECT count(*) FROM applications WHERE user_id=$2) intruder_applications`, [userId, intruder.rows[0].id]);
  assert.deepEqual(rolledBack.rows[0], {owner_applications: '2', intruder_applications: '0'});
});

test('application listing route scopes results to the authenticated participant', { skip: skipReason }, async () => {
  const { tokenHash } = await import('../lib/security');
  const token = randomUUID();
  await client.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [applicationOwnerId, tokenHash(token)]);
  const foreign = await client.query(`INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id`, [`${randomUUID()}@test.invalid`]);
  const foreignApp = await client.query(`INSERT INTO applications(user_id,request_key,pass_choice,pass_uses,amount_cents) VALUES($1,$2,'SINGLE',1,8000) RETURNING id`, [foreign.rows[0].id, randomUUID()]);
  await client.query(`INSERT INTO payments(application_id,idempotency_key,amount_cents,status) VALUES($1,$2,8000,'PAID')`, [foreignApp.rows[0].id, `foreign:${foreignApp.rows[0].id}`]);
  const { GET } = await import('../app/api/applications/route');
  const response = await GET(new Request('http://localhost/api/applications', {headers: {cookie: `todaytable_session=${token}`}}));
  assert.equal(response.status, 200);
  const rows = await response.json() as Array<{id:string}>;
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((row) => row.id !== foreignApp.rows[0].id));

  const adminRoute = await import('../app/api/admin/overview/route');
  const forbidden = await adminRoute.GET(new Request('http://localhost/api/admin/overview', {headers: {cookie: `todaytable_session=${token}`}}));
  assert.equal(forbidden.status, 403);

  const { PUT } = await import('../app/api/profile/route');
  const domain = await import('../lib/domain');
  const profileResponse = await PUT(new Request('http://localhost/api/profile', {
    method: 'PUT',
    headers: {cookie: `todaytable_session=${token}`, origin: 'http://localhost', 'content-type': 'application/json'},
    body: JSON.stringify({
      name: 'Profile Route Test', phone: '010-1234-5678', birthYear: 1990,
      gender: 'PREFER_NOT_TO_SAY', occupation: 'Tester', mbti: 'INTJ',
      interests: [domain.INTERESTS[0]], traits: [domain.TRAITS[0]],
      desiredTraits: [domain.DESIRED_TRAITS[0]], foodBudgets: ['ANY'],
      dietaryNotes: '', privacy: true, operations: true,
    }),
  }));
  assert.equal(profileResponse.status, 200);
  const savedProfile = await client.query('SELECT display_name,consent_privacy,consent_operations FROM profiles WHERE user_id=$1', [applicationOwnerId]);
  assert.deepEqual(savedProfile.rows[0], {display_name: 'Profile Route Test', consent_privacy: true, consent_operations: true});
  const profileAudit = await client.query(`SELECT count(*) FROM audit_logs WHERE actor_user_id=$1 AND action='PROFILE_UPDATED' AND entity_type='profile' AND entity_id=$2`, [applicationOwnerId, applicationOwnerId]);
  assert.equal(profileAudit.rows[0].count, '1');
  const foreignProfile = await client.query('SELECT count(*) FROM profiles WHERE user_id=$1', [foreign.rows[0].id]);
  assert.equal(foreignProfile.rows[0].count, '0');

  const unknown = await GET(new Request('http://localhost/api/applications', {headers: {cookie: `todaytable_session=${randomUUID()}`}}));
  assert.equal(unknown.status, 401);
  const expiredToken = randomUUID();
  await client.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()-interval '1 second')`, [applicationOwnerId, tokenHash(expiredToken)]);
  const expired = await GET(new Request('http://localhost/api/applications', {headers: {cookie: `todaytable_session=${expiredToken}`}}));
  assert.equal(expired.status, 401);

  const adminToken = randomUUID();
  await client.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [adminUserId, tokenHash(adminToken)]);
  const eventRoutes = await import('../app/api/admin/events/route');
  const venueRoutes = await import('../app/api/admin/venues/route');
  const adminHeaders = {cookie: `todaytable_session=${adminToken}`, origin: 'http://localhost', 'content-type': 'application/json'};
  const startsAt = '2030-06-15T19:00:00+09:00';
  const deadline = '2030-06-10T23:59:00+09:00';
  const eventResponse = await eventRoutes.POST(new Request('http://localhost/api/admin/events', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({title: 'KST event test', startsAt, deadline, area: '홍대/합정', capacity: 24, price: 8000}),
  }));
  assert.equal(eventResponse.status, 201);
  const eventData = await eventResponse.json() as {id:string;starts_at:string;area:string;capacity:number};
  assert.equal(new Date(eventData.starts_at).toISOString(), new Date(startsAt).toISOString());
  assert.equal(eventData.area, '홍대/합정');
  assert.equal(eventData.capacity, 24);
  const eventListResponse = await eventRoutes.GET(new Request('http://localhost/api/admin/events', {headers: {cookie: `todaytable_session=${adminToken}`}}));
  const listedEvents = await eventListResponse.json() as Array<{id:string}>;
  assert.ok(listedEvents.some((event) => event.id === eventData.id));
  const invalidEvent = await eventRoutes.POST(new Request('http://localhost/api/admin/events', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({title: 'x', startsAt, deadline, area: 'Mars', capacity: 3, price: 1}),
  }));
  assert.equal(invalidEvent.status, 400);
  const participantEvent = await eventRoutes.POST(new Request('http://localhost/api/admin/events', {
    method: 'POST', headers: {...adminHeaders, cookie: `todaytable_session=${token}`},
    body: JSON.stringify({title: 'Blocked', startsAt, deadline, area: '홍대/합정', capacity: 24, price: 8000}),
  }));
  assert.equal(participantEvent.status, 403);

  const venueResponse = await venueRoutes.POST(new Request('http://localhost/api/admin/venues', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({name: 'Venue Integration Test', area: '잠실', address: '서울 송파구 테스트로 1', capacity: 48}),
  }));
  assert.equal(venueResponse.status, 201);
  const venueData = await venueResponse.json() as {id:string;name:string;area:string;address:string;capacity:number};
  assert.equal(venueData.name, 'Venue Integration Test');
  assert.equal(venueData.area, '잠실');
  assert.equal(venueData.address, '서울 송파구 테스트로 1');
  assert.equal(venueData.capacity, 48);
  const venueListResponse = await venueRoutes.GET(new Request('http://localhost/api/admin/venues', {headers: {cookie: `todaytable_session=${adminToken}`}}));
  const listedVenues = await venueListResponse.json() as Array<{id:string}>;
  assert.ok(listedVenues.some((venue) => venue.id === venueData.id));
  const invalidVenue = await venueRoutes.POST(new Request('http://localhost/api/admin/venues', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({name: 'x', area: 'Mars', address: '', capacity: 0}),
  }));
  assert.equal(invalidVenue.status, 400);
  const participantVenue = await venueRoutes.POST(new Request('http://localhost/api/admin/venues', {
    method: 'POST', headers: {...adminHeaders, cookie: `todaytable_session=${token}`},
    body: JSON.stringify({name: 'Blocked Venue', area: '잠실', address: 'address', capacity: 20}),
  }));
  assert.equal(participantVenue.status, 403);

  const loginEmail = `login-${randomUUID()}@test.invalid`;
  const authUser = await client.query(`INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id`, [loginEmail, 'placeholder']);
  const { hashPassword } = await import('../lib/security');
  const password = 'integration-test-login-password';
  const passwordHash = await hashPassword(password);
  await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [authUser.rows[0].id, passwordHash]);
  const loginRoute = await import('../app/api/auth/login/route');
  const loginRequest = (pass: string) => new Request('http://localhost/api/auth/login', {
    method: 'POST', headers: {origin: 'http://localhost', 'content-type': 'application/json'},
    body: JSON.stringify({email: loginEmail, password: pass}),
  });
  const failedLogin = await loginRoute.POST(loginRequest('wrong-password'));
  assert.equal(failedLogin.status, 401);
  const login = await loginRoute.POST(loginRequest(password));
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\//i);
  const loginToken = cookie.match(/todaytable_session=([^;]+)/)?.[1];
  assert.ok(loginToken);
  const loginSession = await client.query('SELECT user_id,expires_at FROM sessions WHERE token_hash=$1', [tokenHash(loginToken!)]);
  assert.equal(loginSession.rows[0].user_id, authUser.rows[0].id);
  assert.ok(new Date(loginSession.rows[0].expires_at).getTime() > Date.now());

  const logoutRoute = await import('../app/api/auth/logout/route');
  const logout = await logoutRoute.POST(new Request('http://localhost/api/auth/logout', {
    method: 'POST', headers: {cookie: `todaytable_session=${loginToken}`, origin: 'http://localhost'},
  }));
  assert.equal(logout.status, 303);
  assert.equal(new URL(logout.headers.get('location')!).pathname, '/login');
  assert.match(logout.headers.get('set-cookie') ?? '', /HttpOnly/i);
  assert.match(logout.headers.get('set-cookie') ?? '', /Path=\//i);
  const deletedSession = await client.query('SELECT count(*) FROM sessions WHERE token_hash=$1', [tokenHash(loginToken!)]);
  assert.equal(deletedSession.rows[0].count, '0');
});

test('worker claims safely, recovers leases, deduplicates effects, and retries to a dead letter', { skip: skipReason }, async () => {
  // Drain application notifications created by the application service tests.
  for (;;) {
    const pending = await worker.claimJob('integration-drain');
    if (!pending) break;
    await worker.processJob(pending, 'integration-drain');
  }
  await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,run_at) VALUES($1,'APPLICATION_RECEIVED',now()+interval '1 hour')`, [`future:${randomUUID()}`]);
  assert.equal(await worker.claimJob('future-check'), null);
  await client.query(`UPDATE scheduled_jobs SET status='DONE',completed_at=now() WHERE status='PENDING' AND job_key LIKE 'future:%'`);
  const job = await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,run_at) VALUES($1,'APPLICATION_RECEIVED',now()) RETURNING id`, [`test:${randomUUID()}`]);
  const id = job.rows[0].id;
  const competing = await Promise.all([worker.claimJob('test-a'), worker.claimJob('test-b')]);
  const claimed = competing.filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]!.id, id);
  const lease = await client.query('SELECT lease_owner FROM scheduled_jobs WHERE id=$1', [id]);
  const owner = lease.rows[0].lease_owner as string;
  await assert.rejects(worker.processJob(claimed[0]!, 'stale-owner'), /lease lost/i);
  const stillClaimed = await client.query('SELECT status,lease_owner FROM scheduled_jobs WHERE id=$1', [id]);
  assert.equal(stillClaimed.rows[0].status, 'RUNNING');
  assert.equal(stillClaimed.rows[0].lease_owner, owner);
  await worker.processJob(claimed[0]!, owner);
  const completed = await client.query(`SELECT status,lease_owner FROM scheduled_jobs WHERE id=$1`, [id]);
  assert.equal(completed.rows[0].status, 'DONE');
  assert.equal(completed.rows[0].lease_owner, null);
  const effectCount = await client.query(`SELECT count(*) FROM job_effects WHERE job_id=$1`, [id]);
  assert.equal(effectCount.rows[0].count, '1');
  await client.query(`UPDATE scheduled_jobs SET status='RUNNING',lease_owner='expired',lease_until=now()-interval '1 second' WHERE id=$1`, [id]);
  const recovered = await worker.claimJob('test-recovery');
  assert.equal(recovered?.id, id);
  assert.equal(recovered?.attempts, 2);
  await worker.processJob(recovered!, 'test-recovery');
  await client.query(`UPDATE scheduled_jobs SET status='RUNNING',lease_owner='duplicate-run',lease_until=now()+interval '60 seconds' WHERE id=$1`, [id]);
  await worker.processJob(recovered!, 'duplicate-run');
  const state = await client.query(`SELECT lease_owner,attempts,status FROM scheduled_jobs WHERE id=$1`, [id]);
  assert.equal(state.rows[0].lease_owner, null);
  assert.equal(state.rows[0].attempts, 2);
  assert.equal(state.rows[0].status, 'DONE');
  const once = await client.query(`SELECT count(*) FROM job_effects WHERE job_id=$1`, [id]);
  assert.equal(once.rows[0].count, '1');

  const bad = await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,max_attempts,run_at) VALUES($1,'UNREGISTERED_TEST_JOB',2,now()) RETURNING id`, [`bad:${randomUUID()}`]);
  const badId = bad.rows[0].id;
  const attemptOne = await worker.claimJob('bad-worker-one');
  assert.equal(attemptOne?.id, badId);
  assert.equal(await worker.failJob(attemptOne!, 'wrong-owner', new Error('stale')), false);
  const untouched = await client.query('SELECT status,lease_owner,attempts FROM scheduled_jobs WHERE id=$1', [badId]);
  assert.equal(untouched.rows[0].status, 'RUNNING');
  assert.equal(untouched.rows[0].lease_owner, 'bad-worker-one');
  await assert.rejects(worker.processJob(attemptOne!, 'bad-worker-one'), /No handler registered/i);
  assert.equal(await worker.failJob(attemptOne!, 'bad-worker-one', new Error('unknown handler')), true);
  const retry = await client.query('SELECT status,attempts,next_attempt_at>now() retry_delayed FROM scheduled_jobs WHERE id=$1', [badId]);
  assert.equal(retry.rows[0].status, 'PENDING');
  assert.equal(retry.rows[0].retry_delayed, true);
  await client.query('UPDATE scheduled_jobs SET next_attempt_at=now() WHERE id=$1', [badId]);
  const attemptTwo = await worker.claimJob('bad-worker-two');
  assert.equal(attemptTwo?.id, badId);
  await assert.rejects(worker.processJob(attemptTwo!, 'bad-worker-two'), /No handler registered/i);
  await worker.failJob(attemptTwo!, 'bad-worker-two', new Error('unknown handler'));
  const dead = await client.query('SELECT status,attempts FROM scheduled_jobs WHERE id=$1', [badId]);
  assert.equal(dead.rows[0].status, 'DEAD');
  assert.equal(dead.rows[0].attempts, 2);
  const actualDeadAudit = await client.query(`SELECT count(*) FROM audit_logs WHERE action='JOB_DEAD_LETTERED' AND entity_id=(SELECT job_key FROM scheduled_jobs WHERE id=$1)`, [badId]);
  assert.equal(actualDeadAudit.rows[0].count, '1');
});
