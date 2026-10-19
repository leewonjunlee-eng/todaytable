import { NextResponse } from 'next/server';
import {requestOperator} from '@/lib/operators';
import {updatePreferenceSignals} from '@/lib/feedback-service';
import { db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { isCanonicalUuid } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await requestOperator(request); if (!user) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  const [tables, jobs, exceptions, reports, attendance, notifications, feedback] = await Promise.all([
    db.query(`SELECT t.id,e.title,e.area,e.starts_at,t.status,count(tm.user_id)::int member_count,v.name venue_name FROM dining_tables t JOIN events e ON e.id=t.event_id LEFT JOIN table_members tm ON tm.table_id=t.id AND tm.status='ACTIVE' LEFT JOIN venues v ON v.id=t.venue_id GROUP BY t.id,e.title,e.area,e.starts_at,t.status,v.name ORDER BY e.starts_at DESC LIMIT 100`, [], `SELECT t.id,e.title,e.area,e.starts_at,t.status,count(tm.user_id) member_count,v.name venue_name FROM dining_tables t JOIN events e ON e.id=t.event_id LEFT JOIN table_members tm ON tm.table_id=t.id AND tm.status='ACTIVE' LEFT JOIN venues v ON v.id=t.venue_id GROUP BY t.id,e.title,e.area,e.starts_at,t.status,v.name ORDER BY e.starts_at DESC LIMIT 100`),
    db.query(`SELECT id,job_type,status,attempts,last_error,job_key FROM scheduled_jobs ORDER BY created_at DESC LIMIT 100`),
    db.query(`SELECT id,source kind,error reason,status,created_at,entity_id FROM lifecycle_exceptions ORDER BY CASE WHEN status='RESOLVED' THEN 1 ELSE 0 END,created_at DESC LIMIT 100`),
    db.query(`SELECT r.id,r.reason,r.decision status,p.display_name reporter_name,t.display_name target_name,r.created_at FROM safety_reports r JOIN profiles p ON p.user_id=r.reporter_user_id JOIN profiles t ON t.user_id=r.target_user_id ORDER BY r.created_at DESC LIMIT 100`),
    db.query(`SELECT ar.id,tm.table_id,ar.event_id,tm.user_id,p.display_name,ar.status FROM attendance_records ar JOIN table_members tm ON tm.application_id=ar.application_id JOIN dining_tables t ON t.id=tm.table_id AND t.event_id=ar.event_id JOIN profiles p ON p.user_id=tm.user_id ORDER BY ar.created_at DESC LIMIT 100`),
    db.query(`SELECT id,message,channel,status,created_at FROM notifications ORDER BY created_at DESC LIMIT 100`),
    db.query(`SELECT table_id,table_score,conversation_score,venue_score FROM journey_feedback ORDER BY created_at DESC LIMIT 100`),
  ]);
  const count = await db.query<any>(`SELECT count(*)::int total,count(*) FILTER (WHERE matching_status='CONFIRMED')::int confirmed FROM applications`, [], `SELECT count(*) total,sum(CASE WHEN matching_status='CONFIRMED' THEN 1 ELSE 0 END) confirmed FROM applications`);
  const c = count.rows[0] ?? { total: 0, confirmed: 0 };
  const [money, recentPayments, demo] = await Promise.all([
    db.query<any>(`SELECT
      COALESCE(SUM(CASE WHEN status='PAID' THEN amount_cents ELSE 0 END),0) paid,
      COALESCE(SUM(CASE WHEN status='REFUNDED' THEN amount_cents ELSE 0 END),0) refunded,
      COALESCE(SUM(CASE WHEN status IN ('REFUND_REQUESTED','REFUND_PROCESSING') THEN amount_cents ELSE 0 END),0) refund_pending,
      COUNT(*) payment_count FROM payments WHERE provider='MOCK'`),
    db.query(`SELECT p.id,p.amount_cents,p.status,p.provider,p.created_at,pr.display_name,a.pass_choice,
      (SELECT MIN(e.title) FROM application_options o JOIN events e ON e.id=o.event_id WHERE o.application_id=a.id) title
      FROM payments p JOIN applications a ON a.id=p.application_id LEFT JOIN profiles pr ON pr.user_id=a.user_id
      ORDER BY p.created_at DESC LIMIT 20`),
    db.query("SELECT 1 FROM audit_logs WHERE action='DEMO_OPERATIONS_SEEDED' LIMIT 1"),
  ]);
  const finance = { paid: Number(money.rows[0].paid), refunded: Number(money.rows[0].refunded), refundPending: Number(money.rows[0].refund_pending), paymentCount: Number(money.rows[0].payment_count), currency: 'KRW', simulated: true };

  return NextResponse.json({
    demo: Boolean(demo.rowCount), finance, payments: recentPayments.rows,
    metrics: [
      { label: '누적 신청', value: Number(c.total), numerator: Number(c.total), denominator: Number(c.total) },
      { label: '매칭 확정', value: Number(c.confirmed), numerator: Number(c.confirmed), denominator: Number(c.total) },
      { label: '참가권 결제액', value: `₩${finance.paid.toLocaleString('ko-KR')}` },
      { label: '환불 완료', value: `₩${finance.refunded.toLocaleString('ko-KR')}` },
      { label: '환불 처리 대기', value: `₩${finance.refundPending.toLocaleString('ko-KR')}` },
    ], tables: tables.rows, exceptions: exceptions.rows, reports: reports.rows, attendance: attendance.rows,
    notifications: notifications.rows, feedback: feedback.rows, jobs: jobs.rows,
  });
}

export async function POST(request: Request) {
  const user = await requestOperator(request); if (!user) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  const body = await request.json().catch(() => ({})); if (typeof body.action !== 'string' || typeof body.id !== 'string' || !(isCanonicalUuid(body.id)||/^[a-f0-9]{32}$/i.test(body.id))) return NextResponse.json({ error: '작업 형식이 올바르지 않습니다.' }, { status: 400 });
  const client = await db.connect();
  let result: { body: Record<string, unknown>; status: number } = { body: { ok: true }, status: 200 };
  try {
    await client.query('BEGIN');
    if (body.action === 'RETRY_EXCEPTION') {
      const ex = await client.query<any>(`SELECT id,source,entity_id,status FROM lifecycle_exceptions WHERE id=$1 FOR UPDATE`, [body.id]);
      if (!ex.rowCount) result = { body: { error: '예외를 찾을 수 없습니다.' }, status: 404 };
      else {
        await client.query(`UPDATE lifecycle_exceptions SET status='RETRYING' WHERE id=$1`, [body.id]);
        const jobKey = ex.rows[0].source === 'scheduled_job' ? ex.rows[0].entity_id : ex.rows[0].source === 'repair_table' ? `repair:${ex.rows[0].entity_id}` : `provision:${ex.rows[0].entity_id}`;
        const job = await client.query<any>(`SELECT id FROM scheduled_jobs WHERE job_key=$1 FOR UPDATE`, [jobKey]);
        if (job.rowCount) await client.query(`UPDATE scheduled_jobs SET status='PENDING',attempts=0,lease_owner=NULL,lease_until=NULL,next_attempt_at=now(),last_error=NULL,completed_at=NULL WHERE id=$1`, [job.rows[0].id]);
        else if (ex.rows[0].source === 'repair_table') {
          const table = await client.query<any>('SELECT event_id FROM dining_tables WHERE id=$1', [ex.rows[0].entity_id]);
          if (!table.rowCount) result = { body: { error: '재시도 대상을 찾을 수 없습니다.' }, status: 404 };
          else await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'REPAIR_TABLE',$2,now()) ON CONFLICT(job_key) DO UPDATE SET status='PENDING',attempts=0,next_attempt_at=now(),last_error=NULL,completed_at=NULL`, [`repair:${ex.rows[0].entity_id}`, JSON.stringify({ tableId: ex.rows[0].entity_id, eventId: table.rows[0].event_id })]);
        } else if (ex.rows[0].source === 'dining_table') {
          const table = await client.query<any>('SELECT event_id FROM dining_tables WHERE id=$1', [ex.rows[0].entity_id]);
          if (!table.rowCount) result = { body: { error: '재시도 대상을 찾을 수 없습니다.' }, status: 404 };
          else await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'PROVISION_TABLE',$2,now()) ON CONFLICT(job_key) DO UPDATE SET status='PENDING',attempts=0,next_attempt_at=now(),last_error=NULL,completed_at=NULL`, [`provision:${ex.rows[0].entity_id}`, JSON.stringify({ tableId: ex.rows[0].entity_id, eventId: table.rows[0].event_id })]);
        } else result = { body: { error: '재시도할 작업을 찾을 수 없습니다.' }, status: 404 };
      }
    } else if (body.action === 'RESOLVE_EXCEPTION') {
      if (!['RESOLVED','OPEN'].includes(body.status)) result = { body: { error: '예외 상태가 올바르지 않습니다.' }, status: 400 };
      else { const updated = await client.query(`UPDATE lifecycle_exceptions SET status=$2,resolved_at=CASE WHEN $2='RESOLVED' THEN now() ELSE NULL END,resolved_by=$3 WHERE id=$1`, [body.id, body.status, user.id]); if (!updated.rowCount) result = { body: { error: '예외를 찾을 수 없습니다.' }, status: 404 }; else if(body.status==='RESOLVED')await client.query('UPDATE operator_work_sessions SET ended_at=CURRENT_TIMESTAMP WHERE exception_id=$1 AND ended_at IS NULL',[body.id]); }
    } else if (body.action === 'REVIEW_REPORT') {
      if (!['warning', 'suspend', 'permanent', 'dismiss'].includes(body.decision)||typeof body.note!=='string'||body.note.trim().length<2||body.note.length>2000) result = { body: { error: '결정 형식이 올바르지 않습니다.' }, status: 400 };
      else { const report = await client.query<any>(`SELECT target_user_id,decision FROM safety_reports WHERE id=$1 FOR UPDATE`, [body.id]); if (!report.rowCount) result = { body: { error: '신고를 찾을 수 없습니다.' }, status: 404 }; else if(report.rows[0].decision!=='OPEN')result={body:{error:'이미 처리된 신고입니다. 최신 기록을 확인해 주세요.'},status:409}; else { const decision = ({ warning: 'WARNING', suspend: 'SUSPEND', permanent: 'PERMANENT', dismiss: 'DISMISSED' } as Record<string, string>)[body.decision]; await client.query(`UPDATE safety_reports SET decision=$2,note=$3,reviewed_at=now(),reviewed_by=$4 WHERE id=$1`, [body.id, decision, body.note ?? null, user.id]); if (decision === 'SUSPEND' || decision === 'PERMANENT') await client.query(`UPDATE users SET restricted_status=$2 WHERE id=$1`, [report.rows[0].target_user_id, decision === 'SUSPEND' ? 'SUSPENDED' : 'PERMANENT']); } }
    } else if (body.action === 'SET_ATTENDANCE') {
      if (!['ATTENDED', 'NO_SHOW', 'SCHEDULED'].includes(body.status)) result = { body: { error: '참석 상태가 올바르지 않습니다.' }, status: 400 };
      else {
        const before=await client.query<any>(`SELECT ar.status,e.starts_at,COALESCE(e.ends_at,e.starts_at+interval '2 hours') ends_at FROM attendance_records ar JOIN events e ON e.id=ar.event_id WHERE ar.id=$1 FOR UPDATE OF ar`,[body.id],`SELECT ar.status,e.starts_at,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) ends_at FROM attendance_records ar JOIN events e ON e.id=ar.event_id WHERE ar.id=$1`);
        if(!before.rowCount)result={body:{error:'참석 기록을 찾을 수 없습니다.'},status:404};
        else if(body.expectedStatus!==undefined&&body.expectedStatus!==before.rows[0].status)result={body:{error:'참석 기록이 변경됐습니다. 최신 내용을 확인해 주세요.'},status:409};
        else if(+new Date(before.rows[0].starts_at)>Date.now()||(body.status==='NO_SHOW'&&+new Date(before.rows[0].ends_at)>Date.now()))result={body:{error:'행사 시작 전 참석 처리나 종료 전 노쇼 처리는 할 수 없습니다.'},status:409};
        else {await client.query(`UPDATE attendance_records SET status=$2,checked_by=$3,checked_at=now(),updated_at=now() WHERE id=$1`, [body.id,body.status,user.id]);await updatePreferenceSignals(client);}
      }
    } else result = { body: { error: '지원하지 않는 작업입니다.' }, status: 400 };
    if (result.status === 200) await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'admin_action',$3,$4)`, [user.id, body.action, body.id, JSON.stringify(body)]);
    await client.query(result.status === 200 ? 'COMMIT' : 'ROLLBACK');
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { await client.query('ROLLBACK'); return NextResponse.json({ error: '관리자 작업을 처리할 수 없습니다.' }, { status: 400 }); } finally { client.release(); }
}
