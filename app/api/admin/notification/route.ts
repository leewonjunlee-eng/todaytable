import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const admin = await apiUser(request, true);
  if (!admin) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000 || (body.recipientUserId !== undefined && typeof body.recipientUserId !== 'string')) return NextResponse.json({ error: '알림 형식이 올바르지 않습니다.' }, { status: 400 });
  const recipients = body.recipientUserId ? [body.recipientUserId] : (body.event_id ? (await db.query<{ user_id: string }>(`SELECT DISTINCT tm.user_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=$1 AND tm.status='ACTIVE'`, [body.event_id])).rows.map((row) => row.user_id) : []);
  if (!recipients.length) return NextResponse.json({ error: '수신자가 없어 발송하지 않았습니다.' }, { status: 400 });
  for (const recipient of recipients) await db.query(`INSERT INTO notifications(event_id,recipient_user_id,message,channel,status,sent_by) VALUES($1,$2,$3,'IN_APP','SENT',$4)`, [body.event_id ?? null, recipient, body.message.trim(), admin.id]);
  return NextResponse.json({ ok: true, count: recipients.length });
}
