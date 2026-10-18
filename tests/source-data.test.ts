import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

let db: typeof import('../lib/db').db;
let listSourceResponses: typeof import('../lib/source-data').listSourceResponses;
let convertSourceResponse: typeof import('../lib/source-data').convertSourceResponse;
let removeSourceConversion: typeof import('../lib/source-data').removeSourceConversion;
let dir: string;
let savedProvider: string | undefined;
let savedPath: string | undefined;
let adminId: string;
const key = { dataset_sha256: 'a'.repeat(64), sheet_name: '설문지 응답 시트1', sheet_row: 3 };

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'todaytable-source-data-'));
  savedProvider = process.env.DATABASE_PROVIDER; savedPath = process.env.SQLITE_PATH;
  process.env.DATABASE_PROVIDER = 'sqlite'; process.env.SQLITE_PATH = join(dir, 'source.sqlite');
  ({ db } = await import('../lib/db'));
  for (const name of (await readdir(join(process.cwd(),'db/sqlite'))).filter(n=>n.endsWith('.sql')).sort()) {
    await db.execScript(await readFile(join(process.cwd(),'db/sqlite',name),'utf8'));
  }
  ({ listSourceResponses, convertSourceResponse, removeSourceConversion } = await import('../lib/source-data'));
  const admin = await db.query<{id:string}>("INSERT INTO users(email,password_hash,role) VALUES($1,'placeholder','ADMIN') RETURNING id", [`admin-${randomUUID()}@test.invalid`]);
  adminId = admin.rows[0].id;
  const preparedPath=join(dir,'provided-data.json');
  execFileSync('python3',['scripts/prepare_source_data.py','--output',preparedPath],{cwd:process.cwd(),stdio:'ignore'});
  const payload=JSON.parse(await readFile(preparedPath,'utf8'));
  key.dataset_sha256=payload.sha256;
  execFileSync('node',['--import','tsx','scripts/import_source_data_sqlite.ts',preparedPath],{cwd:process.cwd(),env:process.env});
});

after(async () => {
  await db?.end();
  if (savedProvider === undefined) delete process.env.DATABASE_PROVIDER; else process.env.DATABASE_PROVIDER = savedProvider;
  if (savedPath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = savedPath;
  if (dir) await rm(dir,{recursive:true,force:true});
});

test('source responses are searchable and demo conversion is explicit, repeat-safe, and removable', async () => {
  const found = await listSourceResponses({ q:'한우석', issue:'PAYMENT_STATUS_UNKNOWN' });
  assert.equal(found.total,1); assert.equal(found.rows[0].sheet_row,3);
  await assert.rejects(convertSourceResponse(key,adminId,false),/matching consent/);
  const created = await convertSourceResponse(key,adminId,true);
  const again = await convertSourceResponse(key,adminId,true);
  assert.equal(created.user_id,again.user_id);
  const profile = await db.query<any>('SELECT display_name,contact_phone,birth_year,consent_privacy,consent_operations FROM profiles WHERE user_id=$1',[created.user_id]);
  assert.match(profile.rows[0].display_name,/^DEMO · source row 3 ·/);
  assert.equal(profile.rows[0].contact_phone,''); assert.equal(profile.rows[0].birth_year,1999); assert.equal(profile.rows[0].consent_privacy,true); assert.equal(profile.rows[0].consent_operations,true);
  const event=await db.query<any>('SELECT title,status,starts_at FROM events WHERE id=$1',[created.event_id]);
  assert.match(event.rows[0].title,/^DEMO ONLY/); assert.equal(event.rows[0].status,'CLOSED'); assert.match(event.rows[0].starts_at,/2027-05-28T10:00:00/);
  const payment = await db.query<any>('SELECT status,provider FROM payments WHERE id=$1',[created.payment_id]);
  assert.deepEqual(payment.rows[0],{status:'PAID',provider:'MOCK'});
  const grant=await db.query<any>('SELECT original_uses,remaining_uses FROM entitlements WHERE source_payment_id=$1',[created.payment_id]);
  assert.deepEqual(grant.rows[0],{original_uses:1,remaining_uses:0});
  assert.match(created.assumptions.birth_year,/2026 minus/);
  assert.match(created.assumptions.pass_choice,/Original choice/);
  assert.equal(await removeSourceConversion(key,adminId),true);
  assert.equal((await db.query('SELECT 1 FROM profiles WHERE user_id=$1',[created.user_id])).rowCount,0);
  assert.equal((await listSourceResponses({})).total,294,'removal preserves every original source row');
});
