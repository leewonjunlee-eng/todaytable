import { randomUUID } from 'node:crypto';
import { databaseProvider, db } from '../lib/db';
import { retryDelayMs } from '../lib/domain';

type Job = {
  id: string;
  job_key: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

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

    const effect = await client.query(
      `INSERT INTO job_effects(job_id,effect_type)
       VALUES($1,$2) ON CONFLICT(job_id) DO NOTHING RETURNING job_id`,
      [job.id, locked.rows[0].job_type],
    );
    if (effect.rowCount) {
      switch (locked.rows[0].job_type) {
        case 'APPLICATION_RECEIVED':
          await client.query(
            `INSERT INTO audit_logs(action,entity_type,entity_id,after_data)
             VALUES($1,'scheduled_job',$2,$3::jsonb)`,
            [locked.rows[0].job_type, locked.rows[0].job_key,
              JSON.stringify({ payload: locked.rows[0].payload, workerId: owner })],
          );
          break;
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
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function failJob(job: Job, owner: string, error: unknown) {
  const message = String(error).slice(0, 2000);
  const delay = retryDelayMs(job.attempts);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT job_key,attempts,max_attempts FROM scheduled_jobs
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
      await client.query(
        `INSERT INTO audit_logs(action,entity_type,entity_id,after_data)
         VALUES('JOB_DEAD_LETTERED','scheduled_job',$1,$2::jsonb)`,
        [current.rows[0].job_key, JSON.stringify({ error: message, attempts: current.rows[0].attempts })],
      );
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

export async function tick(owner = workerId) {
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

const launchedAsWorker = /(?:^|[/\\])worker[/\\]index\.ts$/.test(process.argv[1] ?? '');
if (launchedAsWorker) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
