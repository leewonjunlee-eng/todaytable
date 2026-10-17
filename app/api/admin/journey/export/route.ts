import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';

function cell(value: unknown) { const text = String(value ?? ''); return /^[=+\-@]/.test(text) ? `'${text}` : text; }
export async function GET(request: Request) {
  if (!(await apiUser(request, true))) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  const rows = await db.query(`SELECT t.id,e.title,e.area,t.status,count(tm.user_id) member_count FROM dining_tables t JOIN events e ON e.id=t.event_id LEFT JOIN table_members tm ON tm.table_id=t.id AND tm.status='ACTIVE' GROUP BY t.id,e.title,e.area,t.status ORDER BY t.created_at DESC`);
  const header = ['id', 'title', 'area', 'status', 'member_count'];
  const csv = [header, ...rows.rows.map((row) => header.map((key) => cell(row[key])))]
    .map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  return new Response(`\uFEFF${csv}\n`, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="todaytable-journey.csv"' } });
}
