import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';

type Db = typeof import('../lib/db').db;
let db: Db;
let submitApplication: typeof import('../lib/application-service').submitApplication;
let worker: typeof import('../worker/index');
let tempDir: string;
let sqlitePath: string;
let participantId: string;
let adminId: string;
let intruderId: string;
let participantEmail: string;
let participantPassword: string;
let participantToken: string;
let adminToken: string;
let eventIds: string[];
let appRequestKey: string;
let startupEnv: Record<string, string | undefined>;

before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'todaytable-sqlite-'));
    sqlitePath = join(tempDir, 'integration.sqlite');
    startupEnv = {
      DATABASE_PROVIDER: process.env.DATABASE_PROVIDER,
      SQLITE_PATH: process.env.SQLITE_PATH,
      SESSION_SECRET: process.env.SESSION_SECRET,
      APP_URL: process.env.APP_URL,
    };
    process.env.DATABASE_PROVIDER = 'sqlite';
    process.env.SQLITE_PATH = sqlitePath;
    process.env.APP_URL = 'http://localhost';
    process.env.SESSION_SECRET = `sqlite-integration-${randomUUID()}-secret-key`;

    ({ db } = await import('../lib/db'));
    await db.query('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    for (const name of (await readdir(join(process.cwd(), 'db/sqlite'))).filter(name => name.endsWith('.sql')).sort()) {
      await db.execScript(await readFile(join(process.cwd(), 'db/sqlite', name), 'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
    ({ submitApplication } = await import('../lib/application-service'));
    worker = await import('../worker/index');

    const { hashPassword } = await import('../lib/security');
    participantEmail = `sqlite-participant-${randomUUID()}@test.invalid`;
    participantPassword = 'sqlite-integration-password';
    const participant = await db.query<{id:string}>('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id', [participantEmail, await hashPassword(participantPassword)]);
    participantId = participant.rows[0].id;
    const admin = await db.query<{id:string}>('INSERT INTO users(email,password_hash,role) VALUES($1,$2,\'ADMIN\') RETURNING id', [`sqlite-admin-${randomUUID()}@test.invalid`, await hashPassword('admin-password')]);
    adminId = admin.rows[0].id;
    const intruder = await db.query<{id:string}>('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id', [`sqlite-intruder-${randomUUID()}@test.invalid`, 'placeholder']);
    intruderId = intruder.rows[0].id;
    await db.query(
      `INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,consent_privacy,consent_operations,consented_at)
       VALUES($1,'No Pass','01000000000',1990,'PREFER_NOT_TO_SAY','INTJ',1,1,CURRENT_TIMESTAMP)`, [intruderId],
    );
    await db.query(
      `INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,consent_privacy,consent_operations,consented_at)
       VALUES($1,'SQLite Test Participant','01012345678',1992,'PREFER_NOT_TO_SAY','ENFJ',1,1,CURRENT_TIMESTAMP)`, [participantId],
    );
    const { tokenHash } = await import('../lib/security');
    participantToken = randomUUID();
    adminToken = randomUUID();
    await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,datetime(\'now\',\'+1 day\'))', [participantId, tokenHash(participantToken)]);
    await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,datetime(\'now\',\'+1 day\'))', [adminId, tokenHash(adminToken)]);

    eventIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const dates = [1, 2, 3, 4].map((days) => {
      const startsAt = new Date(Date.now() + days * 86_400_000).toISOString();
      const deadline = new Date(Date.now() + (days * 86_400_000) - 3_600_000).toISOString();
      return [startsAt, deadline];
    });
    for (let i = 0; i < eventIds.length; i += 1) {
      await db.query(
        'INSERT INTO events(id,title,starts_at,application_deadline,area,capacity,price_cents,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [eventIds[i], `SQLite fixture ${i + 1}`, dates[i][0], dates[i][1], '홍대/합정', 20, 8000, adminId],
      );
    }
});

after(async () => {
    try { await db?.end(); }
    finally {
      if (startupEnv) {
        restoreEnv('DATABASE_PROVIDER', startupEnv.DATABASE_PROVIDER);
        restoreEnv('SQLITE_PATH', startupEnv.SQLITE_PATH);
        restoreEnv('SESSION_SECRET', startupEnv.SESSION_SECRET);
        restoreEnv('APP_URL', startupEnv.APP_URL);
      }
      if (tempDir) await rm(tempDir, {recursive: true, force: true});
    }
});

test('actual login, profile, application replay, and entitlement ownership work on SQLite', async () => {
    const loginRoute = await import('../app/api/auth/login/route');
    const failed = await loginRoute.POST(new Request('http://localhost/api/auth/login', {
      method: 'POST', headers: {origin: 'http://localhost', 'content-type': 'application/json'},
      body: JSON.stringify({email: participantEmail, password: 'incorrect-password'}),
    }));
    assert.equal(failed.status, 401);
    const login = await loginRoute.POST(new Request('http://localhost/api/auth/login', {
      method: 'POST', headers: {origin: 'http://localhost', 'content-type': 'application/json'},
      body: JSON.stringify({email: participantEmail, password: participantPassword}),
    }));
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get('set-cookie') ?? '';
    assert.match(loginCookie, /HttpOnly/i);
    assert.match(loginCookie, /SameSite=Strict/i);
    const token = loginCookie.match(/todaytable_session=([^;]+)/)?.[1];
    assert.ok(token);
    const { tokenHash } = await import('../lib/security');
    const session = await db.query<{user_id:string}>('SELECT user_id FROM sessions WHERE token_hash=$1', [tokenHash(token!)]);
    assert.equal(session.rows[0].user_id, participantId);

    const profileRoute = await import('../app/api/profile/route');
    const domain = await import('../lib/domain');
    const profileBody = {
      name: 'SQLite Test Participant', phone: '010-1234-5678', birthYear: 1990,
      gender: 'PREFER_NOT_TO_SAY', occupation: 'Tester', mbti: 'INTJ',
      interests: [domain.INTERESTS[0]], traits: [domain.TRAITS[0]],
      desiredTraits: [domain.DESIRED_TRAITS[0]], foodBudgets: ['ANY'],
      dietaryNotes: '', privacy: true, operations: true,
    };
    const profile = await profileRoute.PUT(new Request('http://localhost/api/profile', {
      method: 'PUT', headers: {cookie: `todaytable_session=${token}`, origin: 'http://localhost', 'content-type': 'application/json'},
      body: JSON.stringify(profileBody),
    }));
    assert.equal(profile.status, 200);
    const saved = await db.query<{display_name:string;consent_privacy:number}>('SELECT display_name,consent_privacy FROM profiles WHERE user_id=$1', [participantId]);
    assert.equal(saved.rows[0].display_name, profileBody.name);
    assert.equal(Boolean(saved.rows[0].consent_privacy), true);
    const audit = await db.query<{count:number}>("SELECT count(*) count FROM audit_logs WHERE actor_user_id=$1 AND action='PROFILE_UPDATED'", [participantId]);
    assert.equal(audit.rows[0].count, 1);

    const applicationRoute = await import('../app/api/applications/route');
    appRequestKey = randomUUID();
    const apply = () => applicationRoute.POST(new Request('http://localhost/api/applications', {
      method: 'POST', headers: {cookie: `todaytable_session=${token}`, origin: 'http://localhost', 'content-type': 'application/json'},
      body: JSON.stringify({eventIds: [eventIds[0]], pass: 'THREE_PASS', requestKey: appRequestKey}),
    }));
    const parallel = await Promise.all([apply(), apply()]);
    const unexpectedBodies = await Promise.all(parallel.map(async (response) => response.status === 400 ? response.json() : null));
    if (unexpectedBodies.some(Boolean)) assert.fail(`Unexpected SQLite application response: ${JSON.stringify(unexpectedBodies)}`);
    assert.deepEqual(parallel.map((response) => response.status).sort(), [200, 201]);
    const bodies = await Promise.all(parallel.map((response) => response.json() as Promise<{id:string}>));
    assert.equal(bodies[0].id, bodies[1].id);
    const counts = await db.query<{applications:number;payments:number;entitlements:number;uses:number;remaining_uses:number}>(
      `SELECT (SELECT count(*) FROM applications WHERE user_id=$1) applications,
       (SELECT count(*) FROM payments p JOIN applications a ON a.id=p.application_id WHERE a.user_id=$1) payments,
       (SELECT count(*) FROM entitlements WHERE user_id=$1) entitlements,
       (SELECT count(*) FROM entitlement_entries e JOIN applications a ON a.id=e.application_id WHERE a.user_id=$1 AND e.entry_type='USE') uses,
       (SELECT remaining_uses FROM entitlements WHERE user_id=$1) remaining_uses`, [participantId]);
    assert.deepEqual(counts.rows[0], {applications:1,payments:1,entitlements:1,uses:1,remaining_uses:2});
    const replay = await apply();
    assert.equal(replay.status, 200);
    const mismatch = await applicationRoute.POST(new Request('http://localhost/api/applications', {
      method: 'POST', headers: {cookie: `todaytable_session=${token}`, origin: 'http://localhost', 'content-type': 'application/json'},
      body: JSON.stringify({eventIds: [eventIds[1]], pass: 'THREE_PASS', requestKey: appRequestKey}),
    }));
    assert.equal(mismatch.status, 400);
    const duplicateEvent = await applicationRoute.POST(new Request('http://localhost/api/applications', {
      method: 'POST', headers: {cookie: `todaytable_session=${token}`, origin: 'http://localhost', 'content-type': 'application/json'},
      body: JSON.stringify({eventIds: [eventIds[0]], pass: 'SINGLE', requestKey: randomUUID()}),
    }));
    assert.equal(duplicateEvent.status, 400);
    const paidOption = await db.query<{id:string;status:string;payment_status:string}>(
      `SELECT a.id,a.status,p.status payment_status FROM applications a
       JOIN application_options o ON o.application_id=a.id JOIN payments p ON p.application_id=a.id
       WHERE a.user_id=$1 AND o.event_id=$2`, [participantId, eventIds[0]],
    );
    assert.equal(paidOption.rowCount, 1);
    assert.equal(paidOption.rows[0].status, 'SUBMITTED');
    assert.equal(paidOption.rows[0].payment_status, 'PAID');
    await assert.rejects(submitApplication(intruderId, {eventIds: [eventIds[1]], pass: 'EXISTING_PASS', requestKey: randomUUID()}));
    const ownerPass = await db.query<{remaining_uses:number}>('SELECT remaining_uses FROM entitlements WHERE user_id=$1', [participantId]);
    assert.equal(ownerPass.rows[0].remaining_uses, 2);
    const used = await submitApplication(participantId, {eventIds: [eventIds[1]], pass: 'EXISTING_PASS', requestKey: randomUUID()});
    assert.equal(used.created, true);
    const remaining = await db.query<{remaining_uses:number}>('SELECT remaining_uses FROM entitlements WHERE user_id=$1', [participantId]);
    assert.equal(remaining.rows[0].remaining_uses, 1);
    await db.query('UPDATE entitlements SET remaining_uses=0 WHERE user_id=$1', [participantId]);
    await assert.rejects(submitApplication(participantId, {eventIds: [eventIds[2]], pass: 'EXISTING_PASS', requestKey: randomUUID()}));

    const listed = await applicationRoute.GET(new Request('http://localhost/api/applications', {headers:{cookie:`todaytable_session=${token}`}}));
    assert.equal(listed.status, 200);
    assert.equal((await listed.json() as Array<{id:string}>).length, 2);
    const logoutRoute = await import('../app/api/auth/logout/route');
    const logout = await logoutRoute.POST(new Request('http://localhost/api/auth/logout', {
      method:'POST',headers:{cookie:`todaytable_session=${token}`,origin:'http://localhost'},
    }));
    assert.equal(logout.status, 303);
    assert.equal(new URL(logout.headers.get('location')!).pathname, '/login');
    const loggedOut = await db.query<{count:number}>('SELECT count(*) count FROM sessions WHERE token_hash=$1', [tokenHash(token!)]);
    assert.equal(loggedOut.rows[0].count, 0);
});

test('authenticated admin creates and lists events and venues while participants are denied', async () => {
    const { tokenHash } = await import('../lib/security');
    const adminTokenHash = tokenHash(adminToken);
    const eventRoutes = await import('../app/api/admin/events/route');
    const venueRoutes = await import('../app/api/admin/venues/route');
    const adminHeaders = {cookie: `todaytable_session=${adminToken}`, origin: 'http://localhost', 'content-type': 'application/json'};
    const startsAt = '2030-06-15T19:00:00+09:00';
    const deadline = '2030-06-10T23:59:00+09:00';
    const createdEvent = await eventRoutes.POST(new Request('http://localhost/api/admin/events', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({title:'Admin SQLite event',startsAt,deadline,area:'잠실',capacity:24,price:8000}),
    }));
    assert.equal(createdEvent.status, 201);
    const event = await createdEvent.json() as {id:string;starts_at:string;area:string;capacity:number};
    assert.equal(new Date(event.starts_at).toISOString(), new Date(startsAt).toISOString());
    assert.equal(event.area, '잠실');
    assert.equal(event.capacity, 24);
    const eventList = await eventRoutes.GET(new Request('http://localhost/api/admin/events', {headers:{cookie:`todaytable_session=${adminToken}`}}));
    assert.ok((await eventList.json() as Array<{id:string}>).some((row) => row.id === event.id));
    const invalidEvent = await eventRoutes.POST(new Request('http://localhost/api/admin/events', {
      method:'POST',headers:adminHeaders,body:JSON.stringify({title:'x',startsAt,deadline,area:'Mars',capacity:2,price:1}),
    }));
    assert.equal(invalidEvent.status, 400);

    const createdVenue = await venueRoutes.POST(new Request('http://localhost/api/admin/venues', {
      method:'POST',headers:adminHeaders,body:JSON.stringify({name:'SQLite Venue',area:'잠실',address:'서울 송파구 테스트로 1',capacity:48}),
    }));
    assert.equal(createdVenue.status, 201);
    const venue = await createdVenue.json() as {id:string;name:string;area:string;address:string;capacity:number};
    assert.deepEqual({name:venue.name,area:venue.area,address:venue.address,capacity:venue.capacity},{name:'SQLite Venue',area:'잠실',address:'서울 송파구 테스트로 1',capacity:48});
    const venueList = await venueRoutes.GET(new Request('http://localhost/api/admin/venues', {headers:{cookie:`todaytable_session=${adminToken}`}}));
    assert.ok((await venueList.json() as Array<{id:string}>).some((row) => row.id === venue.id));
    const invalidVenue = await venueRoutes.POST(new Request('http://localhost/api/admin/venues', {
      method:'POST',headers:adminHeaders,body:JSON.stringify({name:'x',area:'Mars',address:'',capacity:0}),
    }));
    assert.equal(invalidVenue.status, 400);
    const { tokenHash: hash } = await import('../lib/security');
    const participant = await eventRoutes.POST(new Request('http://localhost/api/admin/events', {
      method:'POST',headers:{...adminHeaders,cookie:`todaytable_session=${participantToken}`},body:JSON.stringify({title:'Denied event',startsAt,deadline,area:'잠실',capacity:20,price:8000}),
    }));
    assert.equal(participant.status, 403);
    const participantVenue = await venueRoutes.POST(new Request('http://localhost/api/admin/venues', {
      method:'POST',headers:{...adminHeaders,cookie:`todaytable_session=${participantToken}`},body:JSON.stringify({name:'Denied venue',area:'잠실',address:'서울',capacity:20}),
    }));
    assert.equal(participantVenue.status, 403);
    assert.equal(adminTokenHash, hash(adminToken));
});

test('worker processes effects once, recovers leases, and retries unknown work through DEAD', async () => {
    for (;;) {
      const pending = await worker.claimJob('sqlite-drain');
      if (!pending) break;
      await worker.processJob(pending, 'sqlite-drain');
    }
    const jobKey = `sqlite-worker:${randomUUID()}`;
    const inserted = await db.query<{id:string}>('INSERT INTO scheduled_jobs(job_key,job_type,run_at) VALUES($1,$2,CURRENT_TIMESTAMP) RETURNING id', [jobKey, 'APPLICATION_RECEIVED']);
    const jobId = inserted.rows[0].id;
    const concurrent = await Promise.all([worker.claimJob('sqlite-one'), worker.claimJob('sqlite-two')]);
    const claimed = concurrent.filter(Boolean);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]!.id, jobId);
    const owner = (await db.query<{lease_owner:string}>('SELECT lease_owner FROM scheduled_jobs WHERE id=$1', [jobId])).rows[0].lease_owner;
    await assert.rejects(worker.processJob(claimed[0]!, 'stale-owner'));
    await worker.processJob(claimed[0]!, owner);
    await db.query("UPDATE scheduled_jobs SET status='RUNNING',lease_owner='expired-worker',lease_until=datetime('now','-1 second') WHERE id=$1", [jobId]);
    const recovered = await worker.claimJob('sqlite-recovery');
    assert.equal(recovered?.id, jobId);
    assert.equal(recovered?.attempts, 2);
    await worker.processJob(recovered!, 'sqlite-recovery');
    await db.query("UPDATE scheduled_jobs SET status='RUNNING',lease_owner='duplicate-worker',lease_until=datetime('now','+60 seconds') WHERE id=$1", [jobId]);
    await worker.processJob(recovered!, 'duplicate-worker');
    const effects = await db.query<{count:number}>('SELECT count(*) count FROM job_effects WHERE job_id=$1', [jobId]);
    assert.equal(effects.rows[0].count, 1);

    const bad = await db.query<{id:string}>('INSERT INTO scheduled_jobs(job_key,job_type,max_attempts,run_at) VALUES($1,$2,2,CURRENT_TIMESTAMP) RETURNING id', [`sqlite-bad:${randomUUID()}`, 'UNKNOWN']);
    const first = await worker.claimJob('bad-one');
    assert.equal(first?.id, bad.rows[0].id);
    await assert.rejects(worker.processJob(first!, 'bad-one'), /No handler registered/i);
    assert.equal(await worker.failJob(first!, 'bad-one', new Error('unknown handler')), true);
    const retry = await db.query<{status:string;attempts:number}>('SELECT status,attempts FROM scheduled_jobs WHERE id=$1', [bad.rows[0].id]);
    assert.equal(retry.rows[0].status, 'PENDING');
    await db.query("UPDATE scheduled_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE id=$1", [bad.rows[0].id]);
    const second = await worker.claimJob('bad-two');
    assert.equal(second?.attempts, 2);
    await assert.rejects(worker.processJob(second!, 'bad-two'), /No handler registered/i);
    await worker.failJob(second!, 'bad-two', new Error('unknown handler'));
    const dead = await db.query<{status:string;attempts:number}>('SELECT status,attempts FROM scheduled_jobs WHERE id=$1', [bad.rows[0].id]);
    assert.deepEqual(dead.rows[0], {status:'DEAD',attempts:2});

    await db.end();
    const reopened = await db.query<{display_name:string}>('SELECT display_name FROM profiles WHERE user_id=$1', [participantId]);
    assert.equal(reopened.rows[0].display_name, 'SQLite Test Participant');
    const persistentApplication = await db.query<{count:number}>(
      'SELECT count(*) count FROM applications WHERE user_id=$1 AND request_key=$2',
      [participantId, appRequestKey],
    );
    assert.equal(persistentApplication.rows[0].count, 1);
});

test('separate processes see persisted SQLite data and serialize an application replay', async (context) => {
  const capability = spawnSync(process.execPath, ['--version'], {encoding:'utf8'});
  if (capability.error && (capability.error as NodeJS.ErrnoException).code === 'EPERM') {
    context.skip('This environment prohibits child processes; file persistence and same-process concurrency are covered above.');
    return;
  }
  assert.equal(capability.status, 0, capability.stderr);
  const env = {
    ...process.env,
    DATABASE_PROVIDER: 'sqlite',
    SQLITE_PATH: sqlitePath,
    PROBE_USER_ID: participantId,
    PROBE_EVENT_ID: eventIds[3],
    PROBE_REQUEST_KEY: randomUUID(),
  };
  const submissions = await Promise.all([runProcessProbe('submit', env), runProcessProbe('submit', env)]);
  const results = submissions as Array<{id:string;created:boolean}>;
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(results[0].id, results[1].id);
  const profile = await runProcessProbe('read-profile', env) as {display_name:string};
  assert.equal(profile.display_name, 'SQLite Test Participant');
});

function runProcessProbe(mode: 'submit'|'read-profile', env: NodeJS.ProcessEnv): Promise<unknown> {
  const loaderArgs: string[] = [];
  for (let i = 0; i < process.execArgv.length; i += 1) {
    if ((process.execArgv[i] === '--import' || process.execArgv[i] === '--loader') && process.execArgv[i + 1]) {
      loaderArgs.push(process.execArgv[i], process.execArgv[i + 1]);
      i += 1;
    }
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [...loaderArgs, join(process.cwd(), 'tests/sqlite-process-probe.mjs'), mode], {
      cwd: process.cwd(), env, stdio: ['ignore','pipe','pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`SQLite ${mode} process failed (${code}): ${stderr}`));
      try { resolvePromise(JSON.parse(stdout.trim())); }
      catch { reject(new Error(`SQLite ${mode} process returned invalid output: ${stdout} ${stderr}`)); }
    });
  });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
