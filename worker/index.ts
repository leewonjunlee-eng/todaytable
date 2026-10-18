import { randomUUID } from 'node:crypto';
import { databaseProvider, db } from '../lib/db';
import { retryDelayMs } from '../lib/domain';
import { runMatching, provisionTable, repairTable } from '../lib/lifecycle-service';

type Job = {
  id: string;
  job_key: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  lease_owner: string;
};

import webpush from 'web-push';

export type PushTransport = (subscription: Record<string, unknown>, payload: string) => Promise<{ statusCode?: number }>;
const defaultPushTransport: PushTransport = async (subscription, payload) => {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) throw new Error('WebPush VAPID configuration is incomplete.');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const response = await webpush.sendNotification(subscription as any, payload);
  return { statusCode: response.statusCode };
};
let activePushTransport: PushTransport = defaultPushTransport;
export function setPushTransportForTests(transport: PushTransport): () => void {
  const previous = activePushTransport;
  activePushTransport = transport;
  return () => { activePushTransport = previous; };
}
const workerId = `${process.env.WORKER_ID ?? 'worker'}-${randomUUID()}`;
const pollMs = Number(process.env.WORKER_POLL_MS ?? 2000);

export async function claimJob(owner = workerId): Promise<Job | null> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const exhausted = await client.query(
      `UPDATE scheduled_jobs
       SET status='DEAD', lease_owner=NULL, lease_until=NULL,
           last_error=coalesce(last_error,'Worker lease expired after the retry limit.'), completed_at=now()
       WHERE attempts>=max_attempts AND (
         (status='PENDING' AND next_attempt_at<=now() AND run_at<=now()) OR
         (status='RUNNING' AND lease_until<now())
       ) RETURNING id,job_key,last_error,attempts`,
    );
    for (const job of exhausted.rows) {
      await client.query(
        `INSERT INTO audit_logs(action,entity_type,entity_id,after_data)
         VALUES('JOB_DEAD_LETTERED','scheduled_job',$1,$2::jsonb)`,
        [job.job_key, JSON.stringify({ error: job.last_error, attempts: job.attempts })],
      );
    }
    const { rows } = await client.query(
      `WITH candidate AS (
         SELECT id FROM scheduled_jobs
         WHERE ((status='PENDING' AND next_attempt_at<=now() AND run_at<=now())
             OR (status='RUNNING' AND lease_until<now()))
           AND attempts<max_attempts
         ORDER BY run_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE scheduled_jobs j
       SET status='RUNNING', lease_owner=$1,
           lease_until=now()+interval '60 seconds', attempts=j.attempts+1
       FROM candidate WHERE j.id=candidate.id RETURNING j.*`,
      [owner],
      `UPDATE scheduled_jobs SET status='RUNNING', lease_owner=$1,
         lease_until=datetime('now','+60 seconds'), attempts=attempts+1
       WHERE id=(SELECT id FROM scheduled_jobs
         WHERE ((status='PENDING' AND next_attempt_at<=CURRENT_TIMESTAMP AND run_at<=CURRENT_TIMESTAMP)
             OR (status='RUNNING' AND lease_until<CURRENT_TIMESTAMP))
           AND attempts<max_attempts ORDER BY run_at LIMIT 1)
       RETURNING *`,
    );
    await client.query('COMMIT');
    return rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function processJob(job: Job, owner: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT job_type,job_key,payload FROM scheduled_jobs
       WHERE id=$1 AND status='RUNNING' AND lease_owner=$2 AND lease_until>now()
       FOR UPDATE`,
      [job.id, owner],
    );
    if (!locked.rowCount) throw new Error('Job lease lost before processing.');

    const jobType = locked.rows[0].job_type as string;
    if (jobType === 'MATCH_EVENT') {
      const payload = locked.rows[0].payload as { eventId?: string };
      const gate = await client.query<any>('SELECT status,application_deadline FROM events WHERE id=$1', [payload.eventId]);
      if (!gate.rowCount || !['OPEN','CLOSED'].includes(gate.rows[0].status)) {
        await client.query("UPDATE scheduled_jobs SET status='DONE',completed_at=now(),lease_owner=NULL,lease_until=NULL WHERE id=$1", [job.id]);
        await client.query('COMMIT'); return;
      }
      if (new Date(gate.rows[0].application_deadline).getTime() > Date.now()) {
        await client.query(`UPDATE scheduled_jobs SET status='PENDING',run_at=$2,next_attempt_at=$2,lease_owner=NULL,lease_until=NULL WHERE id=$1`, [job.id, gate.rows[0].application_deadline], `UPDATE scheduled_jobs SET status='PENDING',run_at=$2,next_attempt_at=$2,lease_owner=NULL,lease_until=NULL WHERE id=$1`);
        await client.query('COMMIT'); return;
      }
    }

    const isPushJob = jobType === 'PUSH_NOTIFICATION';
    const effect = isPushJob ? { rowCount: 1 } : await client.query(
      `INSERT INTO job_effects(job_id,effect_type)
       VALUES($1,$2) ON CONFLICT(job_id) DO NOTHING RETURNING job_id`,
      [job.id, locked.rows[0].job_type],
    );
    if (effect.rowCount) {
      switch (locked.rows[0].job_type) {
        case 'JOURNEY_REMINDER': {
          const payload = locked.rows[0].payload as { tableId?: string; applicationId?: string };
          if (!payload.tableId || !payload.applicationId) throw new Error('JOURNEY_REMINDER requires tableId/applicationId.');
          const recipient = await client.query<any>(`SELECT tm.user_id,t.event_id,e.title FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.table_id=$1 AND tm.application_id=$2 AND tm.status='ACTIVE' AND t.status='CONFIRMED'`, [payload.tableId, payload.applicationId]);
          if (!recipient.rowCount) break;
          await client.query(`INSERT INTO notifications(event_id,recipient_user_id,message,channel,status,sent_by) VALUES($1,$2,$3,'IN_APP','SENT',$2)`, [recipient.rows[0].event_id, recipient.rows[0].user_id, `${recipient.rows[0].title} 식탁이 내일이에요. 채팅방에서 만남을 준비해 보세요.`]);
          break;
        }
        case 'JOURNEY_FEEDBACK_REQUEST': {
          const payload = locked.rows[0].payload as { tableId?: string };
          if (!payload.tableId) throw new Error('JOURNEY_FEEDBACK_REQUEST requires tableId.');
          const recipients = await client.query<any>(`SELECT tm.user_id,t.event_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE tm.table_id=$1 AND tm.status='ACTIVE' AND t.status='CONFIRMED'`, [payload.tableId]);
          if (!recipients.rowCount) break;
          for (const recipient of recipients.rows) await client.query(`INSERT INTO notifications(event_id,recipient_user_id,message,channel,status,sent_by) VALUES($1,$2,'식탁 후기를 남겨 주세요.','IN_APP','SENT',$2)`, [recipient.event_id, recipient.user_id]);
          await client.query(`UPDATE attendance_records SET feedback_requested_at=now() WHERE application_id IN (SELECT application_id FROM table_members WHERE table_id=$1)`, [payload.tableId]);
          break;
        }
        case 'POST_CONTENT': {
          const payload = locked.rows[0].payload as { tableId?: string; eventId?: string };
          if (!payload.tableId || !payload.eventId) throw new Error('POST_CONTENT requires tableId/eventId.');
          const activeTable = await client.query<any>(`SELECT 1 FROM dining_tables WHERE id=$1 AND status='CONFIRMED'`, [payload.tableId]);
          if (!activeTable.rowCount) break;
          const room = await client.query<any>('SELECT id FROM journey_rooms WHERE table_id=$1', [payload.tableId]);
          if (!room.rowCount) throw new Error('Content room not found.');
          const content = ['오늘 가장 기대하는 것은 무엇인가요?', '요즘 나를 웃게 한 일은 무엇인가요?', '다음 주말에 해 보고 싶은 일은 무엇인가요?', '아이스브레이커: 지금 먹고 싶은 메뉴를 하나씩 말해 볼까요?'];
          for (const [index, body] of content.entries()) await client.query(`INSERT INTO journey_messages(id,room_id,author_user_id,body,request_key,kind) VALUES($1,$2,NULL,$3,$4,'SYSTEM') ON CONFLICT(room_id,request_key) DO NOTHING`, [randomUUID(), room.rows[0].id, body, `content:${payload.tableId}:${index}`]);
          break;
        }
        case 'CLOSE_ATTENDANCE': {
          const payload = locked.rows[0].payload as { tableId?: string };
          if (!payload.tableId) throw new Error('CLOSE_ATTENDANCE requires tableId.');
          await client.query(`UPDATE attendance_records SET candidate_status='NO_SHOW_CANDIDATE' WHERE application_id IN (SELECT tm.application_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE tm.table_id=$1 AND tm.status='ACTIVE' AND t.status='CONFIRMED') AND status='SCHEDULED'`, [payload.tableId]);
          break;
        }
        case 'FEEDBACK_FOLLOWUP': {
          const payload = locked.rows[0].payload as { tableId?: string };
          const recipients = await client.query<any>(`SELECT tm.user_id,t.event_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE tm.table_id=$1 AND tm.status='ACTIVE' AND t.status='CONFIRMED' AND NOT EXISTS (SELECT 1 FROM journey_feedback f WHERE f.table_id=tm.table_id AND f.author_user_id=tm.user_id)`, [payload.tableId]);
          for (const recipient of recipients.rows) await client.query(`INSERT INTO notifications(event_id,recipient_user_id,message,channel,status,sent_by) VALUES($1,$2,'아직 답하지 않은 식탁 후기를 남겨 주세요.','IN_APP','SENT',$2)`, [recipient.event_id, recipient.user_id]);
          break;
        }
        case 'PROVISION_TABLE': {
          const payload = locked.rows[0].payload as { tableId?: string; eventId?: string };
          if (!payload.tableId || !payload.eventId) throw new Error('PROVISION_TABLE requires tableId/eventId.');
          const table = await client.query<any>(`SELECT status,provision_status FROM dining_tables WHERE id=$1 FOR UPDATE`, [payload.tableId]);
          if (!table.rowCount) throw new Error('Provision table not found.');
          if (table.rows[0].status !== 'CONFIRMED') break;
          if (table.rows[0].provision_status === 'PROVISIONED') break;
          const members = await client.query<any>(`SELECT tm.application_id,tm.user_id,pr.birth_year,pr.gender,pr.mbti,pr.interests,pr.traits,pr.desired_traits FROM table_members tm JOIN profiles pr ON pr.user_id=tm.user_id WHERE tm.table_id=$1 AND tm.status='ACTIVE' ORDER BY tm.user_id`, [payload.tableId]);
          if (members.rowCount < 4) throw new Error('RETRYABLE table has fewer than four active members.');
          await provisionTable(client, payload.tableId, payload.eventId, members.rows.map((m: any) => ({ applicationId:m.application_id,userId:m.user_id,birthYear:Number(m.birth_year),gender:m.gender,mbti:m.mbti,interests:typeof m.interests === 'string' ? JSON.parse(m.interests) : (m.interests ?? []),traits:typeof m.traits === 'string' ? JSON.parse(m.traits) : (m.traits ?? []),desiredTraits:typeof m.desired_traits === 'string' ? JSON.parse(m.desired_traits) : (m.desired_traits ?? []),eventIds:[payload.eventId!],paid:true,valid:true })));
          break;
        }
        case 'REPAIR_TABLE': {
          const payload = locked.rows[0].payload as { tableId?: string; eventId?: string };
          if (!payload.tableId) throw new Error('REPAIR_TABLE requires tableId.');
          await repairTable(payload.tableId, payload.eventId, client);
          break;
        }
        case 'PUSH_NOTIFICATION': {
          const payload = locked.rows[0].payload as { recipientUserId?: string; message?: string };
          if (!payload.recipientUserId || typeof payload.message !== 'string') throw new Error('PUSH_NOTIFICATION requires recipientUserId/message.');
          const subscriptions = await client.query<any>(`SELECT id,subscription FROM push_subscriptions WHERE user_id=$1 AND active=true FOR UPDATE`, [payload.recipientUserId]);
          for (const subscription of subscriptions.rows) {
            const delivery = await client.query<any>(`INSERT INTO push_deliveries(id,job_id,subscription_id,recipient_user_id,status,attempts) VALUES($1,$2,$3,$4,'PENDING',1) ON CONFLICT(job_id,subscription_id) DO UPDATE SET attempts=push_deliveries.attempts+1,status='PENDING' RETURNING id`, [randomUUID(), job.id, subscription.id, payload.recipientUserId]);
            try {
              const response = await activePushTransport(typeof subscription.subscription === 'string' ? JSON.parse(subscription.subscription) : subscription.subscription, JSON.stringify({ body: payload.message }));
              if (response.statusCode === 404 || response.statusCode === 410) { await client.query(`UPDATE push_subscriptions SET active=false,updated_at=now() WHERE id=$1`, [subscription.id]); await client.query(`UPDATE push_deliveries SET status='DISABLED',last_error='subscription expired' WHERE id=$1`, [delivery.rows[0].id]); }
              else { await client.query(`UPDATE push_deliveries SET status='SENT',sent_at=now(),last_error=NULL WHERE id=$1`, [delivery.rows[0].id]); }
            } catch (error) {
              const statusCode = Number((error as { statusCode?: unknown })?.statusCode);
              if (statusCode === 404 || statusCode === 410) {
                await client.query(`UPDATE push_subscriptions SET active=false,updated_at=now() WHERE id=$1`, [subscription.id]);
                await client.query(`UPDATE push_deliveries SET status='DISABLED',last_error='subscription expired' WHERE id=$1`, [delivery.rows[0].id]);
                continue;
              }
              const message = String(error).slice(0, 1000);
              await client.query(`UPDATE push_deliveries SET status='FAILED',last_error=$2 WHERE id=$1`, [delivery.rows[0].id, message]);
              await client.query('COMMIT');
              throw new PersistedPushFailure(message);
            }
          }
          break;
        }
        case 'APPLICATION_RECEIVED': {
          await client.query(
            `INSERT INTO audit_logs(action,entity_type,entity_id,after_data)
             VALUES($1,'scheduled_job',$2,$3::jsonb)`,
            [locked.rows[0].job_type, locked.rows[0].job_key,
              JSON.stringify({ payload: locked.rows[0].payload, workerId: owner })],
          );
          break;
        }
        case 'MATCH_EVENT': {
          const payload = locked.rows[0].payload as { eventId?: string };
          if (!payload.eventId) throw new Error('MATCH_EVENT requires eventId.');
          await runMatching(payload.eventId, 'worker-core-v1', client);
          break;
        }
        case 'PROCESS_REFUND': {
          const payload = locked.rows[0].payload as { resolutionId?: string };
          if (!payload.resolutionId) throw new Error('PROCESS_REFUND requires resolutionId.');
          const request = await client.query<any>(`SELECT id,payment_id FROM refund_requests WHERE resolution_id=$1 FOR UPDATE`, [payload.resolutionId]);
          if (!request.rowCount) throw new Error('Refund request not found.');
          await client.query(`UPDATE refund_requests SET status='PROCESSING' WHERE id=$1 AND status='REQUESTED'`, [request.rows[0].id]);
          await client.query(`UPDATE payments SET status='REFUNDED',updated_at=now() WHERE id=$1 AND status IN ('REFUND_REQUESTED','REFUND_PROCESSING')`, [request.rows[0].payment_id]);
          await client.query(`UPDATE refund_requests SET status='COMPLETED',completed_at=now() WHERE id=$1`, [request.rows[0].id]);
          await client.query(`UPDATE resolution_cases SET status='REFUNDED',updated_at=now() WHERE id=$1`, [payload.resolutionId]);
          break;
        }
        case 'UPDATE_PREFERENCE_SIGNALS': {
          const feedbackService = await import('../lib/feedback-service');
          await feedbackService.updatePreferenceSignals(client);
          break;
        }
        default:
          throw new Error(`No handler registered for job type: ${locked.rows[0].job_type}`);
      }
    }

    await client.query(
      `UPDATE scheduled_jobs SET status='DONE',completed_at=now(),
       lease_owner=NULL,lease_until=NULL,last_error=NULL WHERE id=$1 AND lease_owner=$2`,
      [job.id, owner],
    );
    await client.query('COMMIT');
  } catch (error) {
    if (!(error instanceof PersistedPushFailure)) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

class PersistedPushFailure extends Error {}

export async function failJob(job: Job, owner: string, error: unknown) {
  const message = String(error).slice(0, 2000);
  const delay = retryDelayMs(job.attempts);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT job_key,attempts,max_attempts,job_type,payload FROM scheduled_jobs
       WHERE id=$1 AND status='RUNNING' AND lease_owner=$2 FOR UPDATE`,
      [job.id, owner],
    );
    if (!current.rowCount) {
      await client.query('COMMIT');
      return false;
    }
    const terminal = current.rows[0].attempts >= current.rows[0].max_attempts;
    await client.query(
      `UPDATE scheduled_jobs SET status=$3,
       next_attempt_at=CASE WHEN $3='PENDING' THEN now()+($4::text||' milliseconds')::interval ELSE next_attempt_at END,
       lease_owner=NULL,lease_until=NULL,last_error=$5,
       completed_at=CASE WHEN $3='DEAD' THEN now() ELSE completed_at END WHERE id=$1 AND lease_owner=$2`,
      [job.id, owner, terminal ? 'DEAD' : 'PENDING', delay, message],
      `UPDATE scheduled_jobs SET status=$3,
       next_attempt_at=CASE WHEN $3='PENDING' THEN datetime('now','+'||CAST(($4+999)/1000 AS INTEGER)||' seconds') ELSE next_attempt_at END,
       lease_owner=NULL,lease_until=NULL,last_error=$5,
       completed_at=CASE WHEN $3='DEAD' THEN CURRENT_TIMESTAMP ELSE completed_at END
       WHERE id=$1 AND lease_owner=$2`,
    );
    if (terminal) {
      // Keep the compatibility audit even when exception persistence is unavailable.
      await client.query(`INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES('JOB_DEAD_LETTERED','scheduled_job',$1,$2)`, [current.rows[0].job_key, JSON.stringify({ error: message, attempts: current.rows[0].attempts })], `INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES('JOB_DEAD_LETTERED','scheduled_job',$1,$2)`);
      const exceptionTable = databaseProvider === 'postgres' || (await client.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='lifecycle_exceptions'", [], "SELECT name FROM sqlite_master WHERE type='table' AND name='lifecycle_exceptions'")).rowCount > 0;
      if (exceptionTable) await client.query(
        `INSERT INTO lifecycle_exceptions(id,source,entity_id,error,details) VALUES($1,'scheduled_job',$2,$3,${databaseProvider === 'postgres' ? '$4::jsonb' : '$4'})`,
        [randomUUID(), current.rows[0].job_key, message, JSON.stringify({ attempts: current.rows[0].attempts, jobType: current.rows[0].job_type })],
        `INSERT INTO lifecycle_exceptions(id,source,entity_id,error,details) VALUES($1,'scheduled_job',$2,$3,$4)`,
      );
      if (current.rows[0].job_type === 'PROCESS_REFUND') {
        const payload = current.rows[0].payload as { resolutionId?: string };
        if (payload?.resolutionId) {
          await client.query(`UPDATE refund_requests SET status='FAILED',error=$2 WHERE resolution_id=$1`, [payload.resolutionId, message]);
          await client.query(`UPDATE resolution_cases SET status='FAILED',updated_at=now() WHERE id=$1`, [payload.resolutionId]);
        }
      }
    }
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function scheduleDueMatchJobs() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(`SELECT e.id,e.application_deadline FROM events e WHERE e.status IN ('OPEN','CLOSED') AND e.application_deadline<=now()`, [], `SELECT e.id,e.application_deadline FROM events e WHERE e.status IN ('OPEN','CLOSED') AND e.application_deadline<=CURRENT_TIMESTAMP`);
    for (const event of due.rows) await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'MATCH_EVENT',${databaseProvider === 'postgres' ? '$2::jsonb' : '$2'},now()) ON CONFLICT(job_key) DO UPDATE SET run_at=excluded.run_at WHERE scheduled_jobs.status='PENDING'`, [`match-event:${event.id}`, JSON.stringify({ eventId:event.id })], `INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'MATCH_EVENT',$2,CURRENT_TIMESTAMP) ON CONFLICT(job_key) DO UPDATE SET run_at=excluded.run_at WHERE scheduled_jobs.status='PENDING'`);
    await client.query('COMMIT');
    return due.rowCount;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function schedulePeriodicPreferenceSignalUpdates() {
  // A unique six-hour bucket makes concurrent workers and process restarts safe.
  const bucket = Math.floor(Date.now() / (6 * 3600_000));
  await db.query(
    `INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at)
     VALUES($1,'UPDATE_PREFERENCE_SIGNALS',$2,CURRENT_TIMESTAMP) ON CONFLICT(job_key) DO NOTHING`,
    [`pref-signal-update:${bucket}`, JSON.stringify({ bucket })],
  );
}

export async function tick(owner = workerId) {
  await scheduleDueMatchJobs();
  await schedulePeriodicPreferenceSignalUpdates();
  const job = await claimJob(owner);
  if (!job) return;
  try {
    await processJob(job, owner);
  } catch (error) {
    console.error(`Job ${job.job_key} failed`, error);
    await failJob(job, owner, error);
  }
}

async function main() {
  if (databaseProvider === 'postgres' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!Number.isFinite(pollMs) || pollMs < 250 || pollMs > 60_000) {
    throw new Error('WORKER_POLL_MS must be between 250 and 60000.');
  }
  console.log(`Todaytable worker ${workerId} polling ${databaseProvider} every ${pollMs}ms`);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  while (!stopping) {
    try { await tick(workerId); }
    catch (error) { console.error('Worker poll failed', error); }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  await db.end();
}

const launchedAsWorker = /(?:^|[/\\])worker[/\\]index\.(?:ts|js|mjs|cjs)$/.test(process.argv[1] ?? '');
if (launchedAsWorker) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
