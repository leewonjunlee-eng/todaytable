import {queueBusinessEvent,scheduleLabel} from './business-events';
import { randomUUID } from 'node:crypto';
import { databaseProvider, db, type QueryClient } from './db';
import { isCanonicalUuid, validateApplicationSelection } from './domain';

type Submission = { eventIds: unknown; pass: unknown; requestKey: unknown; checkoutOutcome?: unknown };

function twoMonthExpiry(from: Date) {
  const monthStart = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 2, 1));
  const lastDay = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    monthStart.getUTCFullYear(), monthStart.getUTCMonth(), Math.min(from.getUTCDate(), lastDay),
    from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds(),
  ));
}

export async function submitApplication(userId: string, body: Submission, connection?: QueryClient) {
  const selected = validateApplicationSelection(body.eventIds, body.pass);
  if (!isCanonicalUuid(body.requestKey)) {
    throw new Error('요청 키가 유효하지 않습니다.');
  }

  const client = connection ?? await db.connect();
  const own = !connection;
  try {
    if (own) await client.query('BEGIN');
    if (databaseProvider === 'postgres') {
      // Same stable lock as matching and resolution; serialize lifecycle decisions.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
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
      if(body.checkoutOutcome && body.checkoutOutcome!=='SUCCEEDED') throw new Error('이미 승인된 결제 요청입니다.');
      const options = await client.query(
        'SELECT event_id FROM application_options WHERE application_id=$1 ORDER BY event_id',
        [replay.rows[0].id],
      );
      const sameEvents = options.rows.map((row: { event_id: string }) => row.event_id).sort().join() === [...selected.eventIds].sort().join();
      if (replay.rows[0].pass_choice !== selected.pass || !sameEvents) {
        throw new Error('이미 처리된 신청 요청입니다.');
      }
      if (own) await client.query('COMMIT');
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
      `SELECT id,starts_at,area,application_deadline,is_demo FROM events
       WHERE id=ANY($1::uuid[]) AND status='OPEN' AND application_deadline>now()
       FOR SHARE`,
      databaseProvider === 'postgres' ? [selected.eventIds] : selected.eventIds,
      `SELECT id,starts_at,area,application_deadline,is_demo FROM events WHERE id IN (${selected.eventIds.map((_, i) => `$${i + 1}`).join(',')})
       AND status='OPEN' AND application_deadline>CURRENT_TIMESTAMP`,
    );
    if (events.rowCount !== selected.eventIds.length) {
      throw new Error('선택한 일정 중 신청할 수 없는 일정이 있습니다.');
    }

    const duplicate = await client.query(
      `SELECT 1 FROM application_options o
       JOIN events existing_event ON existing_event.id=o.event_id
       JOIN applications a ON a.id=o.application_id
       JOIN payments p ON p.application_id=a.id
       WHERE a.user_id=$1 AND a.status='SUBMITTED' AND p.status='PAID'
         AND EXISTS (SELECT 1 FROM events selected_event WHERE selected_event.id=ANY($2::uuid[]) AND selected_event.starts_at=existing_event.starts_at) LIMIT 1`,
      databaseProvider === 'postgres' ? [userId, selected.eventIds] : [userId, ...selected.eventIds],
      `SELECT 1 FROM application_options o
       JOIN events existing_event ON existing_event.id=o.event_id
       JOIN applications a ON a.id=o.application_id JOIN payments p ON p.application_id=a.id
       WHERE a.user_id=$1 AND a.status='SUBMITTED' AND p.status='PAID'
         AND EXISTS (SELECT 1 FROM events selected_event WHERE selected_event.id IN (${selected.eventIds.map((_, i) => `$${i + 2}`).join(',')}) AND selected_event.starts_at=existing_event.starts_at) LIMIT 1`,
    );
    if (duplicate.rowCount) throw new Error('이미 신청한 저녁이 포함되어 있습니다.');

    if(new Set(events.rows.map(e=>Boolean(e.is_demo))).size>1)throw new Error('선택하신 일정은 함께 신청할 수 없습니다. 일정을 나누어 신청해 주세요.');
    const demoUser=(await client.query('SELECT is_demo FROM users WHERE id=$1',[userId])).rows[0]?.is_demo;
    const outcome = body.checkoutOutcome ?? 'SUCCEEDED';
    if (!['SUCCEEDED','FAILED','CANCELED'].includes(String(outcome))) throw new Error('결제 결과를 확인해 주세요.');
    const selection = JSON.stringify({eventIds:[...selected.eventIds].sort(),pass:selected.pass});
    const attempt = (await client.query<any>('SELECT * FROM payment_attempts WHERE request_key=$1',[body.requestKey])).rows[0];
    if (attempt && (attempt.user_id!==userId || attempt.selection!==selection || attempt.outcome!==outcome)) throw new Error('이미 다른 결제 요청에 사용된 키입니다.');
    if(outcome!=='SUCCEEDED') {
      if(!attempt) await client.query('INSERT INTO payment_attempts(id,user_id,request_key,amount_cents,outcome,selection) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),userId,body.requestKey,selected.amount,outcome,selection]);
      if(own) await client.query('COMMIT');
      return {id:'',payment:outcome==='FAILED'?'FAILED':'CANCELED',amount:selected.amount,created:!attempt};
    }
    const application = await client.query(
      `INSERT INTO applications(user_id,request_key,pass_choice,pass_uses,amount_cents,is_demo)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [userId, body.requestKey, selected.pass, selected.uses, selected.amount,Boolean(demoUser||events.rows.some(e=>e.is_demo))],
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
      [applicationId, `virtual-payment:${applicationId}`, selected.amount],
    );
    const paymentId = payment.rows[0].id as string;
    await client.query(`INSERT INTO payment_ledger(id,payment_id,request_key,kind,amount_cents) VALUES($1,$2,$3,'CHARGE',$4)`,[randomUUID(),paymentId,`charge:${paymentId}`,selected.amount]);
    await client.query(`INSERT INTO payment_attempts(id,user_id,request_key,application_id,amount_cents,outcome,selection) VALUES($1,$2,$3,$4,$5,'SUCCEEDED',$6)`,[randomUUID(),userId,body.requestKey,applicationId,selected.amount,selection]);

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
    for (const event of events.rows as Array<{ id: string; application_deadline: string }>) {
      await client.query(
        `INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at)
         VALUES($1,'MATCH_EVENT',$2::jsonb,$3) ON CONFLICT(job_key) DO NOTHING`,
        [`match-event:${event.id}`, JSON.stringify({ eventId: event.id }), event.application_deadline],
      );
    }
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
       VALUES($1,'APPLICATION_SUBMITTED','application',$2,$3::jsonb)`,
      [userId, applicationId, JSON.stringify({ eventIds: selected.eventIds, pass: selected.pass, amount: selected.amount })],
    );
    await queueBusinessEvent(client,{key:`application:${applicationId}`,kind:'APPLICATION_RECEIVED',userId,applicationId,variables:{schedule:scheduleLabel(events.rows),deadline:events.rows.map(e=>new Date(e.application_deadline).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})).join(' / ')}});
    if (own) await client.query('COMMIT');
    return { id: applicationId, payment: 'PAID', amount: selected.amount, created: true };
  } catch (error) {
    if (own) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (own) client.release();
  }
}
