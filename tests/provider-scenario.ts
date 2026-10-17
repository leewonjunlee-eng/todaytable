import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

(async () => {
const { db } = await import('../lib/db');
const { submitApplication } = await import('../lib/application-service');
const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';
const migrationDir = join(process.cwd(), provider === 'sqlite' ? 'db/sqlite' : 'db/migrations');
if (provider === 'sqlite') for (const name of (await (await import('node:fs/promises')).readdir(migrationDir)).filter((x) => x.endsWith('.sql')).sort()) {
  try { await db.execScript(await readFile(join(migrationDir, name), 'utf8')); } catch (error) {
    if (!String(error).includes('already exists') && !String(error).includes('duplicate')) throw error;
  }
}
const admin = (await db.query<any>(`INSERT INTO users(email,password_hash,role) VALUES($1,'x','ADMIN') RETURNING id`, [`h-${randomUUID()}@test.invalid`])).rows[0].id;
const start = new Date(Date.now() + 48 * 3600_000).toISOString();
const deadline = new Date(Date.now() + 60 * 60_000).toISOString();
const event = (await db.query<any>(`INSERT INTO events(title,starts_at,application_deadline,area,capacity,price_cents,created_by) VALUES($1,$2,$3,$4,30,8000,$5) RETURNING id`, ['provider-harness', start, deadline, '하남', admin])).rows[0].id;
const beforeApplications = Number((await db.query<any>(`SELECT count(*) count FROM applications`)).rows[0].count);
const users = [];
for (let i = 0; i < 4; i += 1) {
  const user = (await db.query<any>(`INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id`, [`p-${randomUUID()}@test.invalid`])).rows[0].id;
const interests = provider === 'postgres' ? '{음악,여행}' : '["음악","여행"]';
  const traits = provider === 'postgres' ? '{대화}' : '["대화"]';
  await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,traits,desired_traits,consent_privacy,consent_operations,consented_at) VALUES($1,$2,'010',1990,'PREFER_NOT_TO_SAY','INTJ',${provider === 'postgres' ? '$3::text[]' : '$3'},${provider === 'postgres' ? '$4::text[]' : '$4'},${provider === 'postgres' ? '$4::text[]' : '$4'},${provider === 'postgres' ? 'true' : '1'},${provider === 'postgres' ? 'true' : '1'},now())`, [user, `P${i}`, interests, traits]);
  const result = await submitApplication(user, { eventIds: [event], pass: 'SINGLE', requestKey: randomUUID() });
  assert.equal(result.payment, 'PAID'); users.push(user);
}
assert.equal(Number((await db.query<any>(`SELECT count(*) count FROM applications`)).rows[0].count), beforeApplications + 4);
console.log(JSON.stringify({ provider, users: users.length, event }));
await db.end();
})();
