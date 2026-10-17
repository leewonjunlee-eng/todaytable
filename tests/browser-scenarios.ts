import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/security';
import { databaseProvider, db } from '../lib/db';
import { submitApplication } from '../lib/application-service';
import { runMatching } from '../lib/lifecycle-service';
import { claimJob, failJob, processJob } from '../worker/index';

type Browser = { newPage(): Promise<any>; close(): Promise<void> };
const baseUrl = process.env.BASE_URL;
if (!baseUrl) throw new Error('BASE_URL is required; point it at the app sharing this isolated database.');
if (databaseProvider === 'postgres' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL browser scenarios.');
const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? '/tmp/todaytable-browser-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightModule) as { chromium: { launch(options: unknown): Promise<{ newContext(): Promise<any>; close(): Promise<void> }> } };
const credentials = `scenario-${randomUUID()}`;
const password = 'Scenario-pass-2026!';
const hash = await hashPassword(password);
const adminEmail = `${credentials}-admin@test.invalid`;
const admin = (await db.query<{ id: string }>(`INSERT INTO users(email,password_hash,role) VALUES($1,$2,'ADMIN') RETURNING id`, [adminEmail, hash])).rows[0].id;
const adminToken = randomUUID();
const { tokenHash } = await import('../lib/security');
await db.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,${databaseProvider === 'postgres' ? "now()+interval '2 hours'" : "datetime('now','+2 hours')"})`, [admin, tokenHash(adminToken)]);
const participantEmails = Array.from({ length: 5 }, (_, i) => `${credentials}-p${i}@test.invalid`);
const participantIds: string[] = [];
const interests = databaseProvider === 'postgres' ? '{music,travel}' : '["music","travel"]';
const traits = databaseProvider === 'postgres' ? '{conversation}' : '["conversation"]';
for (let i = 0; i < participantEmails.length; i += 1) {
  const user = (await db.query<{ id: string }>('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id', [participantEmails[i], hash])).rows[0].id;
  participantIds.push(user);
  await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,traits,desired_traits,consent_privacy,consent_operations,consented_at) VALUES($1,$2,'010-0000-0000',1992,'PREFER_NOT_TO_SAY','INTJ',${databaseProvider === 'postgres' ? '$3::text[]' : '$3'},${databaseProvider === 'postgres' ? '$4::text[]' : '$4'},${databaseProvider === 'postgres' ? '$4::text[]' : '$4'},${databaseProvider === 'postgres' ? 'true' : '1'},${databaseProvider === 'postgres' ? 'true' : '1'},${databaseProvider === 'postgres' ? 'now()' : 'CURRENT_TIMESTAMP'})`, [user, `Scenario ${i}`, interests, traits]);
}

const tableEventTitle = `${credentials}-table`;
const tableStarts = new Date(Date.now() + 5 * 60_000);
const tableDeadline = new Date(Date.now() + 60_000);
const tableEvent = (await db.query<{ id: string }>(`INSERT INTO events(title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by) VALUES($1,$2,$3,$4,'홍대/합정',8,8000,$5) RETURNING id`, [tableEventTitle, tableStarts, new Date(tableStarts.getTime() + 60 * 60_000), tableDeadline, admin])).rows[0].id;
await db.query(`INSERT INTO venues(name,area,address,capacity,active) VALUES($1,'홍대/합정','Scenario address',20,${databaseProvider === 'postgres' ? 'true' : '1'})`, [`${credentials}-venue`]);
for (const userId of participantIds.slice(0, 4)) await submitApplication(userId, { eventIds: [tableEvent], pass: 'SINGLE', requestKey: randomUUID() });
await db.query(`UPDATE events SET application_deadline=${databaseProvider === 'postgres' ? "now()-interval '1 second'" : "datetime('now','-1 second')"} WHERE id=$1`, [tableEvent]);
await runMatching(tableEvent, `browser-${credentials}`);
let tableId = '';
for (let i = 0; i < 100; i += 1) {
  const table = await db.query<{ id: string; provision_status: string }>('SELECT id,provision_status FROM dining_tables WHERE event_id=$1', [tableEvent]);
  if (table.rowCount && table.rows[0].provision_status === 'PROVISIONED') { tableId = table.rows[0].id; break; }
  const job = await claimJob(`browser-${credentials}`);
  if (!job) break;
  try { await processJob(job, job.lease_owner); }
  catch (error) { await failJob(job, job.lease_owner, error); throw error; }
}
assert.ok(tableId, 'matching should provision a table before browser scenarios run');

const cancelTitle = `${credentials}-cancel`;
const cancelStart = new Date(Date.now() + 4 * 86_400_000);
const cancelEvent = (await db.query<{ id: string }>(`INSERT INTO events(title,starts_at,application_deadline,area,capacity,price_cents,created_by) VALUES($1,$2,$3,'홍대/합정',8,8000,$4) RETURNING id`, [cancelTitle, cancelStart, new Date(Date.now() + 2 * 86_400_000), admin])).rows[0].id;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
async function login(email: string) {
  await page.goto(new URL('/login', baseUrl).toString());
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url: URL) => !url.pathname.endsWith('/login'));
}
async function browserFetch(path: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ path, method, body }: { path: string; method: string; body?: unknown }) => {
    const response = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path, method, body });
}
try {
  // Participant login, application UI, and mock payment record.
  await login(participantEmails[0]);
  await page.goto(new URL('/apply', baseUrl).toString());
  await page.locator('label.event-option').filter({ hasText: cancelTitle }).locator('input').check();
  await page.getByRole('button', { name: /신청하고 모의 결제하기/ }).click();
  await page.getByText(/신청이 저장되었어요 · 모의 결제/).waitFor();
  const applications = await browserFetch('/api/applications');
  assert.equal(applications.status, 200);
  const cancelledApplication = applications.body.find((row: any) => row.events?.some((event: any) => event.title === cancelTitle));
  assert.equal(cancelledApplication?.payment_status, 'PAID');

  // Member table access, chat, check-in, and feedback after the event ends.
  const tableResponse = await browserFetch(`/api/tables/${tableId}`);
  assert.equal(tableResponse.status, 200);
  const chat = await browserFetch(`/api/tables/${tableId}/messages`, 'POST', { body: 'Browser scenario chat', requestKey: randomUUID() });
  assert.equal(chat.status, 200);
  const checkin = await browserFetch(`/api/tables/${tableId}/check-in`, 'POST', {});
  assert.equal(checkin.status, 200);
  await db.query(`UPDATE events SET ends_at=${databaseProvider === 'postgres' ? "now()-interval '1 second'" : "datetime('now','-1 second')"} WHERE id=$1`, [tableEvent]);
  await page.goto(new URL(`/tables/${tableId}/feedback`, baseUrl).toString());
  const feedback = await browserFetch(`/api/tables/${tableId}/feedback`, 'POST', { tableScore: 5, conversationScore: 4, venueScore: 5, returnIntent: true, recommendIntent: true, likedUserIds: [], dislikedUserIds: [], comment: 'scenario feedback' });
  assert.equal(feedback.status, 200);

  // Application cancellation policy, then participant access denial to admin endpoints.
  const cancel = await browserFetch(`/api/applications/${cancelledApplication.id}/cancel`, 'POST', { reason: 'scenario cancellation' });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.status, 'CANCELED_EARLY');
  assert.equal((await browserFetch('/api/admin/overview')).status, 403);

  // A nonmember cannot read the table or its chat.
  await context.clearCookies();
  await login(participantEmails[4]);
  assert.equal((await browserFetch(`/api/tables/${tableId}`)).status, 404);
  assert.equal((await browserFetch(`/api/tables/${tableId}/messages`)).status, 404);

  // Admin login and admin dashboard/API access.
  await context.clearCookies();
  await login(adminEmail);
  await page.goto(new URL('/admin', baseUrl).toString());
  assert.equal((await browserFetch('/api/admin/overview')).status, 200);
  console.log(JSON.stringify({ status: 'passed', provider: databaseProvider, tableId, eventTitle: tableEventTitle, applicationPayment: 'PAID', checkedIn: true, feedback: true, cancellation: 'CANCELED_EARLY', participantAdminDenied: true, nonmemberDenied: true, adminAccess: true }));
} finally {
  await context.close();
  await browser.close();
  await db.end();
}
