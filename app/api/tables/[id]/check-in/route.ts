import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { isCanonicalUuid } from '@/lib/domain';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await apiUser(request); const { id } = await context.params;
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  if (!isCanonicalUuid(id)) return NextResponse.json({ error: '테이블을 찾을 수 없습니다.' }, { status: 404 });
  const row = await db.query<any>(`SELECT ar.status,t.status table_status,e.starts_at,COALESCE(e.ends_at,e.starts_at+interval '2 hours') ends_at FROM attendance_records ar JOIN table_members tm ON tm.application_id=ar.application_id AND tm.table_id=$1 AND tm.user_id=$2 AND tm.status='ACTIVE' JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=ar.event_id WHERE ar.event_id=t.event_id`, [id, user.id], `SELECT ar.status,t.status table_status,e.starts_at,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) ends_at FROM attendance_records ar JOIN table_members tm ON tm.application_id=ar.application_id AND tm.table_id=$1 AND tm.user_id=$2 AND tm.status='ACTIVE' JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=ar.event_id WHERE ar.event_id=t.event_id`);
  if (!row.rowCount || row.rows[0].table_status !== 'CONFIRMED') return NextResponse.json({ error: '체크인할 수 없습니다.' }, { status: 400 });
  if (row.rows[0].status === 'ATTENDED') return NextResponse.json({ status: 'ATTENDED' });
  const now = Date.now(); const start = new Date(row.rows[0].starts_at).getTime() - 30 * 60_000; const end = new Date(row.rows[0].ends_at).getTime();
  if (now < start || now > end) return NextResponse.json({ error: '체크인 가능 시간이 아닙니다.' }, { status: 400 });
  await db.query(`UPDATE attendance_records SET status='ATTENDED',checked_by=$2,checked_at=now(),checked_in_at=now(),updated_at=now() WHERE application_id IN (SELECT application_id FROM table_members WHERE table_id=$1 AND user_id=$2)`, [id, user.id], `UPDATE attendance_records SET status='ATTENDED',checked_by=$2,checked_at=CURRENT_TIMESTAMP,checked_in_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE application_id IN (SELECT application_id FROM table_members WHERE table_id=$1 AND user_id=$2)`);
  return NextResponse.json({ status: 'ATTENDED' });
}
