import { createHash, randomUUID } from 'node:crypto';
import { databaseProvider, db, type QueryClient } from './db';

export type SourceResponse = {
  dataset_sha256: string; sheet_name: string; sheet_row: number;
  raw_values: string[]; fields: Record<string, string>; issues: string[];
  conversion?: { user_id: string; event_id: string; application_id: string; payment_id: string; assumptions: Record<string, unknown> } | null;
};

function parse<T>(value: T | string): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export async function listSourceResponses({ q = '', issue = '', page = 1, pageSize = 30 }: { q?: string; issue?: string; page?: number; pageSize?: number }) {
  const sql = databaseProvider === 'postgres'
    ? `SELECT r.dataset_sha256,r.sheet_name,r.sheet_row,r.raw_values,r.fields,r.issues,
         c.user_id,c.event_id,c.application_id,c.payment_id,c.assumptions
       FROM provided_data.survey_responses r LEFT JOIN source_demo_conversions c
       USING(dataset_sha256,sheet_name,sheet_row) ORDER BY r.sheet_row`
    : `SELECT r.dataset_sha256,r.sheet_name,r.sheet_row,r.raw_values,r.fields,r.issues,
         c.user_id,c.event_id,c.application_id,c.payment_id,c.assumptions
       FROM source_data_responses r LEFT JOIN source_demo_conversions c
       USING(dataset_sha256,sheet_name,sheet_row) ORDER BY r.sheet_row`;
  const { rows } = await db.query<any>(sql);
  const query = q.trim().toLocaleLowerCase();
  const filtered: SourceResponse[] = rows.map((row) => ({
    dataset_sha256: row.dataset_sha256, sheet_name: row.sheet_name, sheet_row: Number(row.sheet_row),
    raw_values: parse<string[]>(row.raw_values), fields: parse<Record<string, string>>(row.fields), issues: parse<string[]>(row.issues),
    conversion: row.user_id ? { user_id: row.user_id, event_id: row.event_id, application_id: row.application_id, payment_id: row.payment_id, assumptions: parse(row.assumptions) } : null,
  })).filter((row) => (!issue || row.issues.includes(issue)) && (!query || JSON.stringify(row.fields).toLocaleLowerCase().includes(query) || String(row.sheet_row).includes(query)));
  return { total: filtered.length, rows: filtered.slice((page - 1) * pageSize, page * pageSize) };
}

const DEMO_YEAR = 2027;
const AGE_REFERENCE_YEAR = 2026;
const baseAssumptions = {
  identity: 'Synthetic demo identity. Not a real or verified person; no source contact fields are copied.',
  birth_year: `Approximate: ${AGE_REFERENCE_YEAR} minus the supplied age; not a verified birth year.`,
  event_date: `Yearless month/day mapped to ${DEMO_YEAR} at 19:00 KST; dates are demonstration dates, not confirmed attendance. Missing/unreadable dates map to Dec 31, ${DEMO_YEAR}.`,
  mbti: 'A valid MBTI value is uppercased; invalid or unreadable values use INFP solely as a demo placeholder.',
  area: 'The first supplied area is used; missing area uses 홍대/합정 as a demo placeholder.',
  payment: 'MOCK payment marked PAID only to exercise demo flows; no money was received.',
  consent: 'The admin explicitly authorizes matching consent for this synthetic demo identity; source consent is not copied.',
};

function parseAge(raw: string) { const age = Number.parseInt(raw, 10); return Number.isFinite(age) && age >= 18 && age <= 100 ? age : 30; }
function parseDate(raw: string) {
  const match = raw.match(/(?:^|\D)(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/);
  if (!match) return `${DEMO_YEAR}-12-31T10:00:00.000Z`;
  const month = Number(match[1]), day = Number(match[2]);
  const candidate = new Date(Date.UTC(DEMO_YEAR, month - 1, day, 10));
  if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return `${DEMO_YEAR}-12-31T10:00:00.000Z`;
  return candidate.toISOString();
}
function choices(raw: string) { return raw.split(/,\s*(?![^()]*\))/).map((v) => v.trim()).filter(Boolean); }
function amountAndUses(pass: string) {
  if (/4\s*회/.test(pass)) return { amount: 18000, uses: 3 };
  if (/3\s*회/.test(pass)) return { amount: 15000, uses: 3 };
  return { amount: 8000, uses: 1 };
}

function deterministicUuid(value: string) {
  const bytes = createHash('sha256').update(value).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export async function convertSourceResponse(key: { dataset_sha256: string; sheet_name: string; sheet_row: number }, adminId: string, demoConsent: boolean) {
  if (demoConsent !== true) throw new Error('Synthetic demo matching consent is required.');
  const { rows } = await listSourceResponses({ page: 1, pageSize: 1000 });
  const source = rows.find((row) => row.dataset_sha256 === key.dataset_sha256 && row.sheet_name === key.sheet_name && row.sheet_row === key.sheet_row);
  if (!source) throw new Error('Source response was not found.');
  if (source.conversion) return source.conversion;
  const fields = source.fields;
  const client = await db.connect();
  const userId = randomUUID(), appId = randomUUID(), paymentId = randomUUID(), requestKey = randomUUID();
  const pseudo = createHash('sha256').update(`${source.dataset_sha256}:${source.sheet_name}:${source.sheet_row}`).digest('hex').slice(0, 12);
  const age = parseAge(fields.age ?? ''), startsAt = parseDate(fields.dates ?? '');
  const starts = new Date(startsAt), deadline = new Date(starts.getTime() - 2 * 86400000).toISOString();
  const area = choices(fields.areas ?? '')[0] || '홍대/합정';
  const eventId = deterministicUuid(`todaytable-demo-event:${startsAt}:${area}`);
  const gender = fields.gender === '남' ? 'MAN' : fields.gender === '여' ? 'WOMAN' : 'PREFER_NOT_TO_SAY';
  const mbti = /^[IE][NS][FT][JP]$/i.test(fields.mbti ?? '') ? fields.mbti.toUpperCase() : 'XXXX';
  const profileMbti = mbti === 'XXXX' ? 'INFP' : mbti;
  const { amount, uses } = amountAndUses(fields.pass_choice ?? '');
  try {
    await client.query('BEGIN');
    if (databaseProvider === 'postgres') await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${key.dataset_sha256}:${key.sheet_name}:${key.sheet_row}`]);
    const existing = await client.query<any>('SELECT user_id,event_id,application_id,payment_id,assumptions FROM source_demo_conversions WHERE dataset_sha256=$1 AND sheet_name=$2 AND sheet_row=$3', [key.dataset_sha256,key.sheet_name,key.sheet_row]);
    if (existing.rows[0]) { await client.query('COMMIT'); return { ...existing.rows[0], assumptions: parse(existing.rows[0].assumptions) }; }
    await client.query("INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,'PARTICIPANT')", [userId, `demo+${pseudo}@todaytable.invalid`, `DEMO_ONLY_${pseudo}`]);
    await client.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,occupation,mbti,interests,traits,desired_traits,food_budgets,dietary_notes,consent_privacy,consent_operations,consent_version)
      VALUES($1,$2,'',$3,$4,'',$5,$6,$7,$8,$9,'',true,true,'demo-only')`, [userId, `DEMO · source row ${source.sheet_row} · ${pseudo}`, AGE_REFERENCE_YEAR - age, gender, profileMbti, choices(fields.interests ?? ''), choices(fields.traits ?? ''), choices(fields.desired_traits ?? ''), choices(fields.food_budgets ?? '')]);
    await client.query(`INSERT INTO events(id,title,starts_at,application_deadline,area,capacity,price_cents,status,created_by)
      VALUES($1,$2,$3,$4,$5,1000,$6,'CLOSED',$7) ON CONFLICT(id) DO NOTHING`, [eventId, `DEMO ONLY · ${new Date(startsAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})} · ${area}`, startsAt, deadline, area, amount, adminId]);
    await client.query(`INSERT INTO applications(id,user_id,request_key,status,matching_status,pass_choice,pass_uses,amount_cents)
      VALUES($1,$2,$3,'SUBMITTED','WAITING',$4,$5,$6)`, [appId,userId,requestKey,uses === 3 ? 'THREE_PASS' : 'SINGLE',uses,amount]);
    await client.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)', [appId,eventId]);
    await client.query(`INSERT INTO payments(id,application_id,idempotency_key,status,amount_cents,provider)
      VALUES($1,$2,$3,'PAID',$4,'MOCK')`, [paymentId,appId,`demo:${pseudo}`,amount]);
    const entitlementExpiry = uses > 1 ? new Date(starts.getTime() + 60 * 86400000).toISOString() : null;
    const entitlement = await client.query<any>(`INSERT INTO entitlements(user_id,source_payment_id,original_uses,remaining_uses,expires_at)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [userId,paymentId,uses,uses-1,entitlementExpiry]);
    await client.query("INSERT INTO entitlement_entries(entitlement_id,application_id,entry_type) VALUES($1,$2,'USE')", [entitlement.rows[0].id,appId]);
    const assumptions = { ...baseAssumptions, pass_choice: `Demo override: ${uses} use(s), ${amount} KRW mock price. Original choice: ${fields.pass_choice || '(blank)'}. A source 4-pass choice is capped at 3 uses because the app supports at most 3.` };
    await client.query(`INSERT INTO source_demo_conversions(dataset_sha256,sheet_name,sheet_row,user_id,event_id,application_id,payment_id,assumptions)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [key.dataset_sha256,key.sheet_name,key.sheet_row,userId,eventId,appId,paymentId,assumptions]);
    await client.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'SOURCE_RESPONSE_CONVERTED','source_response',$2,$3)", [adminId, `${key.sheet_name}:${key.sheet_row}`, { source_sha256:key.dataset_sha256, user_id:userId,event_id:eventId,application_id:appId,payment_id:paymentId,assumptions }]);
    await client.query('COMMIT');
    return { user_id:userId,event_id:eventId,application_id:appId,payment_id:paymentId,assumptions };
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
  finally { client.release(); }
}

export async function removeSourceConversion(key: { dataset_sha256: string; sheet_name: string; sheet_row: number }, adminId: string) {
  const client: QueryClient = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<any>('SELECT user_id,event_id,application_id,payment_id FROM source_demo_conversions WHERE dataset_sha256=$1 AND sheet_name=$2 AND sheet_row=$3', [key.dataset_sha256,key.sheet_name,key.sheet_row]);
    const row = rows[0];
    if (!row) { await client.query('COMMIT'); return false; }
    await client.query('DELETE FROM source_demo_conversions WHERE dataset_sha256=$1 AND sheet_name=$2 AND sheet_row=$3', [key.dataset_sha256,key.sheet_name,key.sheet_row]);
    await client.query('DELETE FROM entitlement_entries WHERE entitlement_id IN (SELECT id FROM entitlements WHERE source_payment_id=$1)', [row.payment_id]);
    await client.query('DELETE FROM entitlements WHERE source_payment_id=$1', [row.payment_id]);
    await client.query('DELETE FROM payments WHERE id=$1', [row.payment_id]);
    await client.query('DELETE FROM application_options WHERE application_id=$1', [row.application_id]);
    await client.query('DELETE FROM applications WHERE id=$1', [row.application_id]);
    await client.query('DELETE FROM profiles WHERE user_id=$1', [row.user_id]);
    await client.query('DELETE FROM users WHERE id=$1', [row.user_id]);
    const remaining = await client.query<any>('SELECT 1 FROM applications a JOIN application_options o ON o.application_id=a.id WHERE o.event_id=$1 LIMIT 1', [row.event_id]);
    if (!remaining.rowCount) await client.query('DELETE FROM events WHERE id=$1', [row.event_id]);
    await client.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'SOURCE_RESPONSE_DEMO_REMOVED','source_response',$2)", [adminId, `${key.sheet_name}:${key.sheet_row}`]);
    await client.query('COMMIT'); return true;
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
  finally { client.release(); }
}
