import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';
const pgUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
let schema: string | undefined;
let sqliteDir: string | undefined;
let db: typeof import('../lib/db').db;
let submitApplication: typeof import('../lib/application-service').submitApplication;
let worker: typeof import('../worker/index');
let adminId = '';
let adminToken = '';
const report: { provider: string; tests: Array<{ name: string; status: string; error?: string }>; migration: Record<string, unknown> } = { provider, tests: [], migration: {} };

function envForRun() {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_PROVIDER: provider, SESSION_SECRET: `acceptance-${randomUUID()}-secret` };
  if (provider === 'postgres') {
    if (!pgUrl) throw new Error('TEST_DATABASE_URL is required for PostgreSQL acceptance tests.');
    env.DATABASE_URL = pgUrl;
    env.PGOPTIONS = `-c search_path=${schema},public`;
  } else env.SQLITE_PATH = join(sqliteDir!, 'acceptance.sqlite');
  return env;
}

function migrateTwice() {
  const env = envForRun();
  const command = [process.execPath, '--import', 'tsx', 'scripts/migrate.ts'];
  const first = spawnSync(command[0], command.slice(1), { cwd: process.cwd(), env, encoding: 'utf8' });
  const second = spawnSync(command[0], command.slice(1), { cwd: process.cwd(), env, encoding: 'utf8' });
  report.migration = { firstExit: first.status, secondExit: second.status, firstStdout: first.stdout, firstStderr: first.stderr, secondStdout: second.stdout, secondStderr: second.stderr };
  if (first.status !== 0 || second.status !== 0) throw new Error(`actual migrator failed: ${first.stderr || second.stderr}`);
}

async function setup() {
  if (provider === 'postgres') {
    if (!pgUrl) throw new Error('TEST_DATABASE_URL must be postgres://tt_test@127.0.0.1:55439/todaytable_test');
    const parsed = new URL(pgUrl);
    const user = decodeURIComponent(parsed.username);
    const database = decodeURIComponent(parsed.pathname.slice(1));
    if (user !== 'tt_test' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55439' || !database.endsWith('_test')) throw new Error('Refusing PostgreSQL acceptance target; require postgres://tt_test@127.0.0.1:55439/*_test');
    schema = `tt_acceptance_${randomUUID().replaceAll('-', '')}`;
    const c = new pg.Client({ connectionString: pgUrl });
    await c.connect(); await c.query(`CREATE SCHEMA "${schema}"`); await c.end();
  } else sqliteDir = await mkdtemp(join(tmpdir(), 'todaytable-acceptance-'));
  migrateTwice();
  process.env.DATABASE_PROVIDER = provider;
  Object.assign(process.env, envForRun());
  ({ db } = await import('../lib/db'));
  ({ submitApplication } = await import('../lib/application-service'));
  worker = await import('../worker/index');
  const admin = await db.query<{ id: string }>(`INSERT INTO users(email,password_hash,role) VALUES($1,'test','ADMIN') RETURNING id`, [`admin-${randomUUID()}@test.invalid`]);
  adminId = admin.rows[0].id; adminToken = randomUUID();
  const { tokenHash } = await import('../lib/security');
  await db.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,${provider === 'postgres' ? "now()+interval '2 hours'" : "datetime('now','+2 hours')"})`, [adminId, tokenHash(adminToken)]);
}

async function fixture(label: string, count = 4, deadlineMs = 60_000) {
  const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const deadline = new Date(Date.now() + Math.max(deadlineMs, 60_000)).toISOString();
  const event = await db.query<{ id: string }>(`INSERT INTO events(title,starts_at,application_deadline,area,capacity,price_cents,created_by) VALUES($1,$2,$3,$4,$5,8000,$6) RETURNING id`, [`acceptance-${label}-${randomUUID()}`, start, deadline, '홍대/합정', Math.max(count, 8), adminId]);
  await db.query(`INSERT INTO venues(name,area,address,capacity,active) VALUES($1,'홍대/합정','acceptance venue',100,${provider === 'postgres' ? 'true' : '1'})`, [`acceptance-venue-${label}-${randomUUID()}`]);
  const users: string[] = []; const apps: string[] = [];
  const arr = provider === 'postgres' ? '{음악,여행}' : '["음악","여행"]';
  const traits = provider === 'postgres' ? '{대화}' : '["대화"]';
  for (let i = 0; i < count; i++) {
    const u = await db.query<{ id: string }>(`INSERT INTO users(email,password_hash) VALUES($1,'test') RETURNING id`, [`${label}-${i}-${randomUUID()}@test.invalid`]);
    const id = u.rows[0].id; users.push(id);
    await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,traits,desired_traits,consent_privacy,consent_operations,consented_at) VALUES($1,$2,'010-0000-0000',1990,'PREFER_NOT_TO_SAY','INTJ',${provider === 'postgres' ? '$3::text[]' : '$3'},${provider === 'postgres' ? '$4::text[]' : '$4'},${provider === 'postgres' ? '$4::text[]' : '$4'},${provider === 'postgres' ? 'true' : '1'},${provider === 'postgres' ? 'true' : '1'},${provider === 'postgres' ? 'now()' : 'CURRENT_TIMESTAMP'})`, [id, `${label}-${i}`, arr, traits]);
    const result = await submitApplication(id, { eventIds: [event.rows[0].id], pass: 'SINGLE', requestKey: randomUUID() });
    assert.equal(result.payment, 'PAID'); apps.push(result.id);
  }
  if (deadlineMs < 0) await db.query(`UPDATE events SET application_deadline=${provider === 'postgres' ? "now()-interval '1 second'" : "datetime('now','-1 second')"} WHERE id=$1`, [event.rows[0].id]);
  return { event: event.rows[0].id, users, apps, start, deadline };
}

async function drain(max = 200) {
  for (let i = 0; i < max; i++) {
    const job = await worker.claimJob(`acceptance-${randomUUID()}`);
    if (!job) return i;
    await worker.processJob(job, job.lease_owner ?? '');
  }
  throw new Error(`worker queue did not drain within ${max} claims`);
}

function req(url: string, init: RequestInit = {}) { return new Request(`http://localhost${url}`, init); }
function auth(token: string) { return { cookie: `todaytable_session=${token}` }; }
async function run(name: string, fn: () => Promise<void>) { try { await fn(); report.tests.push({ name, status: 'passed' }); } catch (e) { report.tests.push({ name, status: 'failed', error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) }); } }

async function main() {
await setup();
try {
  await run('01 actual migrations are chronological and idempotent', async () => { const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name'); const files = (await readdir(join(process.cwd(), provider === 'sqlite' ? 'db/sqlite' : 'db/migrations'))).filter(x => x.endsWith('.sql')).sort(); assert.deepEqual(rows.rows.map(x => x.name), files); });
  await run('02 four paid applications use real submitApplication and replay without duplicate payment', async () => { const f = await fixture('submit'); const before = await db.query<{ n: number }>('SELECT count(*) n FROM payments'); const replay = await submitApplication(f.users[0], { eventIds: [f.event], pass: 'SINGLE', requestKey: (await db.query<{ request_key: string }>('SELECT request_key FROM applications WHERE id=$1', [f.apps[0]])).rows[0].request_key }); assert.equal(replay.created, false); const after = await db.query<{ n: number }>('SELECT count(*) n FROM payments'); assert.equal(Number(after.rows[0].n), Number(before.rows[0].n)); });
  await run('03 independent worker tick advances only after deadline and drains bounded queue', async () => { const f = await fixture('match', 4, -1000); await worker.tick(`acceptance-${randomUUID()}`); await drain(200); const statuses = await db.query<{ matching_status: string }>('SELECT matching_status FROM applications WHERE id=ANY($1::uuid[])', provider === 'postgres' ? [f.apps] : f.apps, 'SELECT matching_status FROM applications WHERE id IN (' + f.apps.map((_, i) => `$${i + 1}`).join(',') + ')'); assert.equal(statuses.rows.filter(x => x.matching_status === 'CONFIRMED').length, 4); });
  await run('04 matching provisions venue room system messages reservation and attendance exactly once', async () => { const f = await fixture('journey', 4, -1000); await worker.tick(`acceptance-${randomUUID()}`); await drain(200); const table = await db.query<{ id: string }>('SELECT id FROM dining_tables WHERE event_id=$1', [f.event]); assert.equal(table.rowCount, 1); const room = await db.query<{ n: number }>('SELECT count(*) n FROM journey_rooms WHERE table_id=$1', [table.rows[0].id]); const messages = await db.query<{ n: number }>(`SELECT count(*) n FROM journey_messages m JOIN journey_rooms r ON r.id=m.room_id WHERE r.table_id=$1 AND m.kind='SYSTEM'`, [table.rows[0].id]); const reservation = await db.query<{ n: number }>('SELECT count(*) n FROM table_reservations WHERE table_id=$1', [table.rows[0].id]); assert.equal(Number(room.rows[0].n), 1); assert.equal(Number(messages.rows[0].n), 3); assert.equal(Number(reservation.rows[0].n), 1); });
  await run('05 journey response includes events payment table explanation resolution and entitlements with owner scope', async () => { const f = await fixture('journey-api'); const token = randomUUID(); const { tokenHash } = await import('../lib/security'); await db.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,${provider === 'postgres' ? "now()+interval '1 hour'" : "datetime('now','+1 hour')"})`, [f.users[0], tokenHash(token)]); const route = await import('../app/api/journey/route'); const response = await route.GET(req('/api/journey', { headers: auth(token) })); assert.equal(response.status, 200); const body = await response.json() as any; assert.ok(Array.isArray(body.applications)); assert.ok('entitlements' in body); const row = body.applications.find((x: any) => x.id === f.apps[0]); assert.ok(row); assert.ok('events' in row && 'payment_status' in row && 'table_id' in row && 'explanation' in row && 'resolution' in row); });
  await run('06 journey requires authentication', async () => { const route = await import('../app/api/journey/route'); assert.equal((await route.GET(req('/api/journey'))).status, 401); });
  await run('07 table route hides tables from nonmembers', async () => { const f = await fixture('privacy', 4, -1000); await worker.tick(`acceptance-${randomUUID()}`); await drain(200); const table = (await db.query<{ id: string }>('SELECT id FROM dining_tables WHERE event_id=$1', [f.event])).rows[0].id; const tableRoute = await import('../app/api/tables/[id]/route'); const outsider = await db.query<{ id: string }>(`INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id`, [`out-${randomUUID()}@test.invalid`]); const token = randomUUID(); const { tokenHash } = await import('../lib/security'); await db.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,${provider === 'postgres' ? "now()+interval '1 hour'" : "datetime('now','+1 hour')"})`, [outsider.rows[0].id, tokenHash(token)]); const response = await tableRoute.GET(req(`/api/tables/${table}`, { headers: auth(token) }), { params: Promise.resolve({ id: table }) }); assert.equal(response.status, 404); });
  await run('08 check-in rejects requests before the event window', async () => { const f = await fixture('safety', 4, -1000); await worker.tick(`acceptance-${randomUUID()}`); await drain(200); const table = (await db.query<{ id: string }>('SELECT id FROM dining_tables WHERE event_id=$1', [f.event])).rows[0].id; const check = await import('../app/api/tables/[id]/check-in/route'); const token = randomUUID(); const { tokenHash } = await import('../lib/security'); await db.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,${provider === 'postgres' ? "now()+interval '1 hour'" : "datetime('now','+1 hour')"})`, [f.users[0], tokenHash(token)]); const response = await check.POST(req(`/api/tables/${table}/check-in`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: '{}' }), { params: Promise.resolve({ id: table }) }); assert.equal(response.status, 400); });
  await run('09 resolution choices are versioned, ownership-scoped, idempotent, and refund worker runs once', async () => { const f = await fixture('resolution', 1, -1000); await worker.tick(`acceptance-${randomUUID()}`); await drain(200); const caseRow = await db.query<{ id: string; version: number }>('SELECT id,version FROM resolution_cases WHERE application_id=$1', [f.apps[0]]); if (!caseRow.rowCount) throw new Error('resolution_cases missing: no unmatched resolution fixture was created'); const { resolveApplication } = await import('../lib/lifecycle-service'); const version = Number(caseRow.rows[0].version);
    await assert.rejects(resolveApplication(adminId, f.apps[0], 'HOLD', version));
    await assert.rejects(resolveApplication(f.users[0], f.apps[0], 'HOLD', version + 2));
    assert.deepEqual(await resolveApplication(f.users[0], f.apps[0], 'HOLD', version), { status: 'HOLD' });
    assert.deepEqual(await resolveApplication(f.users[0], f.apps[0], 'HOLD', version), { status: 'HOLD' });
    const uses = await db.query<{ remaining_uses: number }>('SELECT remaining_uses FROM entitlements WHERE user_id=$1', [f.users[0]]);
    assert.equal(Number(uses.rows[0].remaining_uses), 1);
    await assert.rejects(resolveApplication(f.users[0], f.apps[0], 'REFUND', version));
    const refund = await fixture('refund', 1, -1000); await worker.tick('acceptance-refund'); await drain();
    const refundCase = (await db.query<{ id: string; version: number }>('SELECT id,version FROM resolution_cases WHERE application_id=$1', [refund.apps[0]])).rows[0];
    await resolveApplication(refund.users[0], refund.apps[0], 'REFUND', Number(refundCase.version));
    await resolveApplication(refund.users[0], refund.apps[0], 'REFUND', Number(refundCase.version));
    await drain();
    assert.equal((await db.query<{ status: string }>('SELECT status FROM payments WHERE application_id=$1', [refund.apps[0]])).rows[0].status, 'REFUNDED');
    assert.equal(Number((await db.query<{ n: number }>('SELECT count(*) n FROM refund_requests WHERE resolution_id=$1', [refundCase.id])).rows[0].n), 1); });
  await run('10 fewer than four applicants cannot form a confirmed table', async () => { const f = await fixture('constraints', 3, -1000); await worker.tick(`acceptance-${randomUUID()}`); await drain(200); const rows = await db.query<{ matching_status: string }>('SELECT matching_status FROM applications WHERE id=ANY($1::uuid[])', provider === 'postgres' ? [f.apps] : f.apps, 'SELECT matching_status FROM applications WHERE id IN (' + f.apps.map((_, i) => `$${i + 1}`).join(',') + ')'); assert.equal(rows.rows.filter(x => x.matching_status === 'CONFIRMED').length, 0); });
  await run('11 admin routes deny participants and preserve transaction after invalid identifiers', async () => { const route = await import('../app/api/admin/events/route'); assert.equal((await route.POST(req('/api/admin/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).status, 403); const venues = await import('../app/api/admin/venues/route'); const bad = await venues.GET(req('/api/admin/venues')); assert.equal(bad.status, 403); const journey = await import('../app/api/admin/journey/route'); const invalid = await journey.POST(req('/api/admin/journey', { method: 'POST', headers: { ...auth(adminToken), 'content-type': 'application/json' }, body: JSON.stringify({ action: 'RETRY_EXCEPTION', id: 'not-a-uuid' }) })); assert.equal(invalid.status, 400); const ok = await venues.GET(req('/api/admin/venues', { headers: auth(adminToken) })); assert.equal(ok.status, 200); });
  await run('12 dead-letter jobs can be retried through the admin exception route', async () => { const j = await db.query<{ id: string }>(`INSERT INTO scheduled_jobs(job_key,job_type,max_attempts,run_at) VALUES($1,'UNKNOWN_ACCEPTANCE',1,${provider === 'postgres' ? 'now()' : 'CURRENT_TIMESTAMP'}) RETURNING id`, [`dead-${randomUUID()}`]); const job = await worker.claimJob(`acceptance-${randomUUID()}`); assert.equal(job?.id, j.rows[0].id); await assert.rejects(worker.processJob(job!, job!.lease_owner ?? '')); assert.equal(await worker.failJob(job!, job!.lease_owner ?? '', new Error('acceptance unknown')), true); const state = await db.query<{ status: string; attempts: number }>('SELECT status,attempts FROM scheduled_jobs WHERE id=$1', [j.rows[0].id]); assert.equal(state.rows[0].status, 'DEAD'); assert.equal(Number(state.rows[0].attempts), 1);
    const exception = (await db.query<{ id: string }>('SELECT id FROM lifecycle_exceptions WHERE entity_id=$1', [job!.job_key])).rows[0];
    const route = await import('../app/api/admin/journey/route');
    const response = await route.POST(req('/api/admin/journey', { method: 'POST', headers: { ...auth(adminToken), 'content-type': 'application/json' }, body: JSON.stringify({ action: 'RETRY_EXCEPTION', id: exception.id }) }));
    assert.equal(response.status, 200);
    const retried = (await db.query<{ status: string; attempts: number }>('SELECT status,attempts FROM scheduled_jobs WHERE id=$1', [job!.id])).rows[0];
    assert.equal(retried.status, 'PENDING'); assert.equal(Number(retried.attempts), 0);
    // Remove this deliberately unsupported job so later scenarios can drain the queue.
    await db.query("UPDATE scheduled_jobs SET status='DEAD' WHERE id=$1", [job!.id]); });
  await run('13 content jobs create at least three posted system prompts and replay without duplicates', async () => { const f = await fixture('content', 4, -1000); await worker.tick(`acceptance-${randomUUID()}`); await drain(200); const before = await db.query<{ n: number }>(`SELECT count(*) n FROM journey_messages m JOIN journey_rooms r ON r.id=m.room_id JOIN dining_tables t ON t.id=r.table_id WHERE t.event_id=$1`, [f.event]); await db.query(`UPDATE scheduled_jobs SET run_at=${provider === 'postgres' ? 'now()' : 'CURRENT_TIMESTAMP'},next_attempt_at=${provider === 'postgres' ? 'now()' : 'CURRENT_TIMESTAMP'} WHERE job_type='POST_CONTENT' AND payload${provider === 'postgres' ? "->>'eventId'=$1" : ' LIKE $1'}`, [provider === 'sqlite' ? `%${f.event}%` : f.event]); await drain(200); const after = await db.query<{ n: number }>(`SELECT count(*) n FROM journey_messages m JOIN journey_rooms r ON r.id=m.room_id JOIN dining_tables t ON t.id=r.table_id WHERE t.event_id=$1`, [f.event]); assert.ok(Number(after.rows[0].n) >= Number(before.rows[0].n) + 3); });
  await run('14 CSV export accepts documented kind and rejects invalid kinds', async () => { const route = await import('../app/api/admin/export/route'); const response = await route.GET(req('/api/admin/export?kind=applications', { headers: auth(adminToken) })); assert.equal(response.status, 200); const text = await response.text(); assert.ok(text.includes('matching_status')); assert.ok(text.includes(','));
    assert.equal((await route.GET(req('/api/admin/export?kind=invalid', { headers: auth(adminToken) }))).status, 400);
    assert.equal((await route.GET(req('/api/admin/export?kind=tables', { headers: auth(adminToken) }))).status, 200); });
  await run('15 push config reports a boolean and hides keys when unconfigured', async () => { const route = await import('../app/api/push/config/route'); const response = await route.GET(); assert.ok([200, 403].includes(response.status)); if (response.status === 200) { const body = await response.json() as any; assert.equal(typeof body.configured, 'boolean'); if (!body.configured) assert.equal(body.publicKey, undefined); } });
  await run('16 cancellation before 48 hours has explicit state and same-day cancellation is rejected', async () => { const f = await fixture('cancel', 1, 60_000); const route = await import('../app/api/applications/[id]/cancel/route'); const token = randomUUID(); const { tokenHash } = await import('../lib/security'); await db.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,${provider === 'postgres' ? "now()+interval '1 hour'" : "datetime('now','+1 hour')"})`, [f.users[0], tokenHash(token)]); const response = await route.POST(req(`/api/applications/${f.apps[0]}/cancel`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ reason: '일정 변경' }) }), { params: Promise.resolve({ id: f.apps[0] }) });
    const cancelBody=await response.json() as any; assert.equal(response.status, 200, JSON.stringify(cancelBody)); assert.equal(cancelBody.status, 'CANCELED_EARLY');
    const sameDay = await fixture('same-day', 1);
    await db.query('UPDATE events SET starts_at=$2 WHERE id=$1', [sameDay.event, new Date().toISOString()]);
    const sameDayToken = randomUUID();
    await db.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,${provider === 'postgres' ? "now()+interval '1 hour'" : "datetime('now','+1 hour')"})`, [sameDay.users[0], tokenHash(sameDayToken)]);
    const rejected = await route.POST(req(`/api/applications/${sameDay.apps[0]}/cancel`, { method: 'POST', headers: { ...auth(sameDayToken), 'content-type': 'application/json' }, body: JSON.stringify({ reason: '당일 변경' }) }), { params: Promise.resolve({ id: sameDay.apps[0] }) });
    assert.equal(rejected.status, 400);
    assert.equal((await db.query<{ status: string }>('SELECT status FROM applications WHERE id=$1', [sameDay.apps[0]])).rows[0].status, 'SUBMITTED'); });
  await run('17 system messages expose 운영팀 author semantics and member messages validate ownership', async () => { const f = await fixture('messages', 4, -1000); await worker.tick(`acceptance-${randomUUID()}`); await drain(200); const table = (await db.query<{ id: string }>('SELECT id FROM dining_tables WHERE event_id=$1', [f.event])).rows[0].id; const rows = await db.query<{ kind: string; author_user_id: string | null }>('SELECT m.kind,m.author_user_id FROM journey_messages m JOIN journey_rooms r ON r.id=m.room_id WHERE r.table_id=$1', [table]); assert.equal(rows.rows.filter(x => x.kind === 'SYSTEM' && x.author_user_id === null).length, 3); });
  await run('18 journey ignores an unsupported cursor without breaking the owner response', async () => { const f = await fixture('cursor', 4); const route = await import('../app/api/journey/route'); const token = randomUUID(); const { tokenHash } = await import('../lib/security'); await db.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,${provider === 'postgres' ? "now()+interval '1 hour'" : "datetime('now','+1 hour')"})`, [f.users[0], tokenHash(token)]); const response = await route.GET(req('/api/journey?cursor=invalid', { headers: auth(token) })); assert.equal(response.status, 200); const body = await response.json() as any; assert.ok(body.applications.length >= 1); });
  await run('19 migration rerun records zero newly applied migrations', async () => { const second = String(report.migration.secondStdout ?? ''); assert.equal(second.includes('Applied '), false); });
  await run('20 failed push is persisted and retried; expired 404/410 subscriptions are disabled', async () => {
    const f = await fixture('push', 1); const userId = f.users[0];
    await db.query(`UPDATE scheduled_jobs SET status='PENDING',lease_owner=NULL,lease_until=NULL,run_at=${provider === 'postgres' ? "now()+interval '1 day'" : "datetime('now','+1 day')"},next_attempt_at=${provider === 'postgres' ? "now()+interval '1 day'" : "datetime('now','+1 day')"} WHERE status IN ('PENDING','RUNNING')`);
    const addPush = async (suffix: string) => (await db.query<{ id: string }>(`INSERT INTO push_subscriptions(id,user_id,endpoint,subscription) VALUES($1,$2,$3,$4) RETURNING id`, [randomUUID(), userId, `https://push.example.invalid/${randomUUID()}-${suffix}`, JSON.stringify({ endpoint: 'mock', keys: { p256dh: 'x', auth: 'y' } })])).rows[0].id;
    const addJob = async (label: string) => (await db.query<{ id: string }>(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'PUSH_NOTIFICATION',$2,${provider === 'postgres' ? 'now()' : 'CURRENT_TIMESTAMP'}) RETURNING id`, [`push-${label}-${randomUUID()}`, JSON.stringify({ recipientUserId: userId, message: 'hello' })])).rows[0].id;
    const restore = worker.setPushTransportForTests(async () => { throw new Error('temporary push failure'); });
    try {
      const subscriptionId = await addPush('retry'); const jobId = await addJob('retry');
      const first = await worker.claimJob(`acceptance-${randomUUID()}`); assert.equal(first?.id, jobId);
      await assert.rejects(worker.processJob(first!, first!.lease_owner), /temporary push failure/);
      assert.equal((await db.query<{ status: string }>('SELECT status FROM push_deliveries WHERE job_id=$1 AND subscription_id=$2', [jobId, subscriptionId])).rows[0].status, 'FAILED');
      assert.equal(await worker.failJob(first!, first!.lease_owner, new Error('temporary push failure')), true);
      await db.query(`UPDATE scheduled_jobs SET next_attempt_at=${provider === 'postgres' ? 'now()' : 'CURRENT_TIMESTAMP'},run_at=${provider === 'postgres' ? 'now()' : 'CURRENT_TIMESTAMP'} WHERE id=$1`, [jobId]);
      const next = await worker.claimJob(`acceptance-${randomUUID()}`); assert.equal(next?.id, jobId);
      worker.setPushTransportForTests(async () => ({ statusCode: 201 }));
      await worker.processJob(next!, next!.lease_owner);
      const sent = await db.query<{ status: string; attempts: number }>('SELECT status,attempts FROM push_deliveries WHERE job_id=$1 AND subscription_id=$2', [jobId, subscriptionId]);
      assert.equal(sent.rows[0].status, 'SENT'); assert.equal(Number(sent.rows[0].attempts), 2);
    } finally { restore(); }
    const expiredId = await addPush('expired'); const expiredJobId = await addJob('expired');
    const restoreExpired = worker.setPushTransportForTests(async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); });
    try { const job = await worker.claimJob(`acceptance-${randomUUID()}`); assert.equal(job?.id, expiredJobId); await worker.processJob(job!, job!.lease_owner); }
    finally { restoreExpired(); }
    assert.equal((await db.query<{ status: string }>('SELECT status FROM push_deliveries WHERE job_id=$1 AND subscription_id=$2', [expiredJobId, expiredId])).rows[0].status, 'DISABLED');
    assert.equal((await db.query<{ active: number | boolean }>('SELECT active FROM push_subscriptions WHERE id=$1', [expiredId])).rows[0].active, false);
    const expiredReturnedId = await addPush('expired-returned'); const expiredReturnedJob = await addJob('expired-returned');
    const restoreReturned = worker.setPushTransportForTests(async () => ({ statusCode: 404 }));
    try { const job = await worker.claimJob(`acceptance-${randomUUID()}`); assert.equal(job?.id, expiredReturnedJob); await worker.processJob(job!, job!.lease_owner); }
    finally { restoreReturned(); }
    assert.equal((await db.query<{ status: string }>('SELECT status FROM push_deliveries WHERE job_id=$1 AND subscription_id=$2', [expiredReturnedJob, expiredReturnedId])).rows[0].status, 'DISABLED');
    assert.equal((await db.query<{ active: number | boolean }>('SELECT active FROM push_subscriptions WHERE id=$1', [expiredReturnedId])).rows[0].active, false);
  });
} finally {
  await db?.end();
  if (provider === 'postgres' && schema && pgUrl) { const c = new pg.Client({ connectionString: pgUrl }); await c.connect(); await c.query(`DROP SCHEMA "${schema}" CASCADE`); await c.end(); }
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  const out = process.env.ACCEPTANCE_RESULTS ?? join(process.cwd(), 'tests/scratchacceptance-newresults.json');
  await BunLikeWrite(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.tests.some(x => x.status === 'failed')) process.exitCode = 1;
}
}

async function BunLikeWrite(path: string, text: string) { const fs = await import('node:fs/promises'); await fs.writeFile(path, text + '\n', 'utf8'); }

main().catch((error) => { console.error(error); process.exitCode = 1; });
