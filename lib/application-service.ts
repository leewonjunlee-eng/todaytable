import { databaseProvider, db } from './db';
import { isCanonicalUuid, validateApplicationSelection } from './domain';

type Submission = { eventIds: unknown; pass: unknown; requestKey: unknown };

function twoMonthExpiry(from: Date) {
  const monthStart = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 2, 1));
  const lastDay = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    monthStart.getUTCFullYear(), monthStart.getUTCMonth(), Math.min(from.getUTCDate(), lastDay),
    from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds(),
  ));
}

export async function submitApplication(userId: string, body: Submission) {
  const selected = validateApplicationSelection(body.eventIds, body.pass);
  if (!isCanonicalUuid(body.requestKey)) {
    throw new Error('요청 키가 유효하지 않습니다.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (databaseProvider === 'postgres') {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [userId]);
    }

    const profile = await client.query(
      'SELECT user_id FROM profiles WHERE user_id=$1 AND consent_privacy AND consent_operations FOR UPDATE',
      [userId],
    );
    if (!profile.rowCount) throw new Error('프로필과 필수 동의를 먼저 저장해 주세요.');

    const replay = await client.query(
      `SELECT a.id,a.pass_choice,a.amount_cents,p.status payment_status
       FROM applications a JOIN payments p ON p.application_id=a.id
       WHERE a.user_id=$1 AND a.request_key=$2`,
      [userId, body.requestKey],
    );
    if (replay.rowCount) {
      const options = await client.query(
        'SELECT event_id FROM application_options WHERE application_id=$1 ORDER BY event_id',
        [replay.rows[0].id],
      );
      const sameEvents = options.rows.map((row: { event_id: string }) => row.event_id).sort().join() === [...selected.eventIds].sort().join();
      if (replay.rows[0].pass_choice !== selected.pass || !sameEvents) {
        throw new Error('이미 처리된 신청 요청입니다.');
      }
      await client.query('COMMIT');
      return {
        id: replay.rows[0].id,
        payment: replay.rows[0].payment_status,
        amount: replay.rows[0].amount_cents,
        created: false,
      };
    }

    const profileRow = await client.query(
      'SELECT birth_year FROM profiles WHERE user_id=$1',
      [userId],
    );
    const currentKstYear = Number(new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Seoul', year: 'numeric',
    }).format(new Date()));
    if (currentKstYear - Number(profileRow.rows[0].birth_year) < 19) {
      throw new Error('만 19세 이상만 신청할 수 있습니다.');
    }

    const events = await client.query(
      `SELECT id FROM events
       WHERE id=ANY($1::uuid[]) AND status='OPEN' AND application_deadline>now()
       FOR SHARE`,
      databaseProvider === 'postgres' ? [selected.eventIds] : selected.eventIds,
      `SELECT id FROM events WHERE id IN (${selected.eventIds.map((_, i) => `$${i + 1}`).join(',')})
       AND status='OPEN' AND application_deadline>CURRENT_TIMESTAMP`,
    );
    if (events.rowCount !== selected.eventIds.length) {
      throw new Error('선택한 일정 중 신청할 수 없는 일정이 있습니다.');
    }

    const duplicate = await client.query(
      `SELECT 1 FROM application_options o
       JOIN applications a ON a.id=o.application_id
       JOIN payments p ON p.application_id=a.id
       WHERE a.user_id=$1 AND a.status='SUBMITTED' AND p.status='PAID'
         AND o.event_id=ANY($2::uuid[]) LIMIT 1`,
      databaseProvider === 'postgres' ? [userId, selected.eventIds] : [userId, ...selected.eventIds],
      `SELECT 1 FROM application_options o
       JOIN applications a ON a.id=o.application_id JOIN payments p ON p.application_id=a.id
       WHERE a.user_id=$1 AND a.status='SUBMITTED' AND p.status='PAID'
         AND o.event_id IN (${selected.eventIds.map((_, i) => `$${i + 2}`).join(',')}) LIMIT 1`,
    );
    if (duplicate.rowCount) throw new Error('이미 신청한 저녁이 포함되어 있습니다.');

    const application = await client.query(
      `INSERT INTO applications(user_id,request_key,pass_choice,pass_uses,amount_cents)
       VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [userId, body.requestKey, selected.pass, selected.uses, selected.amount],
    );
    const applicationId = application.rows[0].id as string;
    for (const eventId of selected.eventIds) {
      await client.query(
        'INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',
        [applicationId, eventId],
      );
    }

    const payment = await client.query(
      `INSERT INTO payments(application_id,idempotency_key,amount_cents,status)
       VALUES($1,$2,$3,'PAID') RETURNING id`,
      [applicationId, `mock-payment:${applicationId}`, selected.amount],
    );
    const paymentId = payment.rows[0].id as string;

    let entitlementId: string;
    if (selected.pass === 'EXISTING_PASS') {
      const available = await client.query(
        `SELECT id FROM entitlements
         WHERE user_id=$1 AND remaining_uses>0 AND (expires_at IS NULL OR expires_at>now())
         ORDER BY expires_at NULLS LAST,created_at FOR UPDATE LIMIT 1`,
        [userId],
      );
      if (!available.rowCount) throw new Error('사용 가능한 이용권이 없거나 유효기간이 지났습니다.');
      entitlementId = available.rows[0].id as string;
    } else {
      const grant = await client.query(
        `INSERT INTO entitlements(user_id,source_payment_id,original_uses,remaining_uses,expires_at)
         VALUES($1,$2,$3,$3,CASE WHEN $4='THREE_PASS' THEN now()+interval '2 months' ELSE NULL END)
         RETURNING id`,
        databaseProvider === 'postgres'
          ? [userId, paymentId, selected.uses, selected.pass]
          : [userId, paymentId, selected.uses, selected.pass, twoMonthExpiry(new Date())],
        `INSERT INTO entitlements(user_id,source_payment_id,original_uses,remaining_uses,expires_at)
         VALUES($1,$2,$3,$3,CASE WHEN $4='THREE_PASS' THEN $5 ELSE NULL END)
         RETURNING id`,
      );
      entitlementId = grant.rows[0].id as string;
    }

    const debit = await client.query(
      'UPDATE entitlements SET remaining_uses=remaining_uses-1 WHERE id=$1 AND remaining_uses>0 RETURNING id',
      [entitlementId],
    );
    if (!debit.rowCount) throw new Error('이용권 잔여 횟수가 없습니다.');
    await client.query(
      `INSERT INTO entitlement_entries(entitlement_id,application_id,entry_type)
       VALUES($1,$2,'USE')`,
      [entitlementId, applicationId],
    );

    await client.query(
      `INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at)
       VALUES($1,'APPLICATION_RECEIVED',$2::jsonb,now()) ON CONFLICT(job_key) DO NOTHING`,
      [`application-received:${applicationId}`, JSON.stringify({ applicationId })],
    );
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
       VALUES($1,'APPLICATION_SUBMITTED','application',$2,$3::jsonb)`,
      [userId, applicationId, JSON.stringify({ eventIds: selected.eventIds, pass: selected.pass, amount: selected.amount })],
    );
    await client.query('COMMIT');
    return { id: applicationId, payment: 'PAID', amount: selected.amount, created: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
