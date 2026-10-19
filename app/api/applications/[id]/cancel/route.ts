import {isAllowedGenderComposition} from '@/lib/matching';
import {retireApplicationProposals} from '@/lib/matching-review';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { databaseProvider, db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { isCanonicalUuid } from '@/lib/domain';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await apiUser(request); const { id } = await context.params;
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  if (!isCanonicalUuid(id)) return NextResponse.json({ error: '신청을 찾을 수 없습니다.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.reason !== 'string' || body.reason.trim().length < 1 || body.reason.length > 1000) return NextResponse.json({ error: '취소 사유가 필요합니다.' }, { status: 400 });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (databaseProvider === 'postgres') await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
    const found = await client.query<any>(`SELECT a.id,a.status,a.pass_choice,e.starts_at,e.id event_id,tm.table_id,p.id payment_id,p.status payment_status,p.amount_cents FROM applications a JOIN application_options o ON o.application_id=a.id JOIN events e ON e.id=o.event_id JOIN payments p ON p.application_id=a.id LEFT JOIN table_members tm ON tm.application_id=a.id AND tm.status='ACTIVE' LEFT JOIN dining_tables t ON t.id=tm.table_id WHERE a.id=$1 AND a.user_id=$2 ORDER BY CASE WHEN t.event_id=e.id THEN 0 ELSE 1 END,e.starts_at LIMIT 1 FOR UPDATE OF a`, [id, user.id], `SELECT a.id,a.status,a.pass_choice,e.starts_at,e.id event_id,tm.table_id,p.id payment_id,p.status payment_status,p.amount_cents FROM applications a JOIN application_options o ON o.application_id=a.id JOIN events e ON e.id=o.event_id JOIN payments p ON p.application_id=a.id LEFT JOIN table_members tm ON tm.application_id=a.id AND tm.status='ACTIVE' LEFT JOIN dining_tables t ON t.id=tm.table_id WHERE a.id=$1 AND a.user_id=$2 ORDER BY CASE WHEN t.event_id=e.id THEN 0 ELSE 1 END,e.starts_at LIMIT 1`);
    if (!found.rowCount) throw Object.assign(new Error('신청을 찾을 수 없습니다.'), { status: 404 });
    const row = found.rows[0];
    if (row.status === 'CANCELED') { await client.query('COMMIT'); return NextResponse.json({ status: 'CANCELED' }); }
    const resolution=(await client.query<any>('SELECT selected_choice FROM resolution_cases WHERE application_id=$1 FOR UPDATE',[id])).rows[0];
    if(resolution?.selected_choice==='REFUND'||String(row.payment_status).startsWith('REFUND'))throw new Error('환불 처리 중이거나 환불을 선택한 신청은 취소로 변경할 수 없습니다. 결제·환불 내역을 확인해 주세요.');
    const starts = new Date(row.starts_at); const now = new Date();
    const calendarDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    if (calendarDay(starts) === calendarDay(now)) throw Object.assign(new Error('행사 당일에는 취소할 수 없습니다.'), { status: 400 });
    const hours = (starts.getTime() - now.getTime()) / 3600000;
    if (hours < 0) throw Object.assign(new Error('행사 시작 후에는 취소할 수 없습니다.'), { status: 400 });
    const cancellationStatus = hours >= 48 ? 'CANCELED_EARLY' : 'CANCELED_LATE';
    await client.query(`UPDATE applications SET status='CANCELED',matching_status='NO_MATCH',updated_at=now() WHERE id=$1`, [id]);
    await retireApplicationProposals(client,id,'멤버의 참가 등록이 취소되어 다시 추천합니다.');
    await client.query("UPDATE availability_registrations SET status='CANCELLED' WHERE application_id=$1",[id]);
    await client.query(`UPDATE table_members SET status='REMOVED' WHERE application_id=$1 AND status='ACTIVE'`, [id]);
    if (row.table_id) {
      const remaining = await client.query<any>(`SELECT p.gender FROM table_members tm JOIN profiles p ON p.user_id=tm.user_id WHERE tm.table_id=$1 AND tm.status='ACTIVE'`, [row.table_id], `SELECT p.gender FROM table_members tm JOIN profiles p ON p.user_id=tm.user_id WHERE tm.table_id=$1 AND tm.status='ACTIVE'`);
      if (!isAllowedGenderComposition(remaining.rows)) {
        await client.query(`UPDATE dining_tables SET status='EXCEPTION' WHERE id=$1`, [row.table_id]);
        await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'REPAIR_TABLE',$2,now()) ON CONFLICT(job_key) DO UPDATE SET status='PENDING',next_attempt_at=now(),last_error=NULL`, [`repair:${row.table_id}:${id}`, JSON.stringify({ tableId: row.table_id, eventId: row.event_id })], `INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'REPAIR_TABLE',$2,CURRENT_TIMESTAMP) ON CONFLICT(job_key) DO UPDATE SET status='PENDING',next_attempt_at=CURRENT_TIMESTAMP,last_error=NULL`);
      }
    }
    let refundRequested=false;
    if (cancellationStatus === 'CANCELED_EARLY' && row.pass_choice==='SINGLE' && row.payment_status==='PAID' && Number(row.amount_cents)>0) {
      await client.query(`UPDATE entitlements SET remaining_uses=0 WHERE source_payment_id=$1`,[row.payment_id]);
      const resolution=await client.query<any>(`INSERT INTO resolution_cases(id,application_id,status,version,reason,alternatives,selected_choice,result_payload,selected_at)
        VALUES($1,$2,'REFUND_REQUESTED',1,'CANCELED_EARLY','[]','REFUND',$3,now())
        ON CONFLICT(application_id) DO UPDATE SET status='REFUND_REQUESTED',version=resolution_cases.version+1,selected_choice='REFUND',result_payload=excluded.result_payload,selected_at=now(),updated_at=now()
        RETURNING id`,[randomUUID(),id,JSON.stringify({status:'REFUND',source:'CANCELLATION'})],`INSERT INTO resolution_cases(id,application_id,status,version,reason,alternatives,selected_choice,result_payload,selected_at)
        VALUES($1,$2,'REFUND_REQUESTED',1,'CANCELED_EARLY','[]','REFUND',$3,CURRENT_TIMESTAMP)
        ON CONFLICT(application_id) DO UPDATE SET status='REFUND_REQUESTED',version=resolution_cases.version+1,selected_choice='REFUND',result_payload=excluded.result_payload,selected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        RETURNING id`);
      const resolutionId=resolution.rows[0]?.id ?? (await client.query<any>('SELECT id FROM resolution_cases WHERE application_id=$1',[id])).rows[0].id;
      await client.query(`UPDATE payments SET status='REFUND_REQUESTED',updated_at=now() WHERE id=$1`,[row.payment_id],`UPDATE payments SET status='REFUND_REQUESTED',updated_at=CURRENT_TIMESTAMP WHERE id=$1`);
      await client.query(`INSERT INTO refund_requests(id,resolution_id,payment_id,request_key,amount_cents) VALUES($1,$2,$3,$4,$5) ON CONFLICT(resolution_id) DO NOTHING`,[randomUUID(),resolutionId,row.payment_id,`refund:${resolutionId}`,row.amount_cents]);
      await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'PROCESS_REFUND',$2,now()) ON CONFLICT(job_key) DO NOTHING`,[`refund:${resolutionId}`,JSON.stringify({resolutionId})],`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'PROCESS_REFUND',$2,CURRENT_TIMESTAMP) ON CONFLICT(job_key) DO NOTHING`);
      refundRequested=true;
    } else if (cancellationStatus === 'CANCELED_EARLY' && (row.payment_status==='PAID'||row.pass_choice==='EXISTING_PASS')) {
      const restored = await client.query<any>(`INSERT INTO entitlement_entries(entitlement_id,application_id,entry_type)
        SELECT own.entitlement_id,$1,'RESTORE' FROM entitlement_entries own
        WHERE own.application_id=$1 AND own.entry_type='USE'
          AND NOT EXISTS (SELECT 1 FROM entitlement_entries x WHERE x.entitlement_id=own.entitlement_id AND x.application_id=$1 AND x.entry_type='RESTORE')
        RETURNING entitlement_id`, [id]);
      if (restored.rowCount) await client.query('UPDATE entitlements SET remaining_uses=remaining_uses+1 WHERE id=$1 AND remaining_uses<original_uses', [restored.rows[0].entitlement_id]);
    }
    await client.query(`UPDATE attendance_records SET status=$2,updated_at=now() WHERE application_id=$1`, [id, cancellationStatus]);
    await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'APPLICATION_CANCELED','application',$2,$3)`, [user.id, id, JSON.stringify({ reason: body.reason, policy: cancellationStatus, tableId: row.table_id ?? null })]);
    await client.query('COMMIT'); return NextResponse.json({ status: cancellationStatus, ...(refundRequested?{refund:'REQUESTED'}:{}) });
  } catch (error) { await client.query('ROLLBACK'); const status = typeof error === 'object' && error && 'status' in error && Number((error as { status?: unknown }).status) === 404 ? 404 : 400; return NextResponse.json({ error: error instanceof Error ? error.message : '취소를 처리할 수 없습니다.' }, { status }); } finally { client.release(); }
}
