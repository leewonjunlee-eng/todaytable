import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { csv } from '@/lib/csv';

export async function GET(request: Request) {
  if (!(await apiUser(request, true))) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  const kind = new URL(request.url).searchParams.get('kind');
  if (kind === 'applications') {
    const rows = await db.query<any>(`SELECT a.id,a.user_id,a.status,a.matching_status,a.pass_choice,a.amount_cents,a.created_at FROM applications a ORDER BY a.created_at`);
    return new Response(csv(rows.rows, ['id','user_id','status','matching_status','pass_choice','amount_cents','created_at']), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="applications.csv"' } });
  }
  if (kind === 'tables') {
    const rows = await db.query<any>(`SELECT t.id,t.event_id,t.table_number,t.status,e.title,e.starts_at,e.area FROM dining_tables t JOIN events e ON e.id=t.event_id ORDER BY e.starts_at`);
    return new Response(csv(rows.rows, ['id','event_id','table_number','status','title','starts_at','area']), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="tables.csv"' } });
  }
  return NextResponse.json({ error: 'kind must be applications or tables' }, { status: 400 });
}
