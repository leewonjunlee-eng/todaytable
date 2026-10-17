import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { isCanonicalUuid } from '@/lib/domain';
import { randomUUID } from 'node:crypto';

async function member(tableId: string, userId: string) {
  return (await db.query(`SELECT 1 FROM table_members WHERE table_id=$1 AND user_id=$2 AND status='ACTIVE'`, [tableId, userId])).rowCount > 0;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await apiUser(request); const { id } = await context.params;
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!isCanonicalUuid(id) || !(await member(id, user.id))) return NextResponse.json({ error: '테이블을 찾을 수 없습니다.' }, { status: 404 });
  const rawAfter = new URL(request.url).searchParams.get('after');
  const parsedAfter = rawAfter ? Date.parse(rawAfter) : Number.NaN;
  const after = Number.isFinite(parsedAfter) ? new Date(parsedAfter).toISOString() : null;
  const rows = await db.query(`SELECT m.id,COALESCE(p.display_name,'운영팀') author_name,m.body,m.kind,m.created_at
    FROM journey_messages m JOIN journey_rooms r ON r.id=m.room_id LEFT JOIN profiles p ON p.user_id=m.author_user_id
    WHERE r.table_id=$1 AND ($2::timestamptz IS NULL OR m.created_at>$2::timestamptz)
    ORDER BY m.created_at,m.id LIMIT 200`, [id, after], `SELECT m.id,COALESCE(p.display_name,'운영팀') author_name,m.body,m.kind,m.created_at
    FROM journey_messages m JOIN journey_rooms r ON r.id=m.room_id LEFT JOIN profiles p ON p.user_id=m.author_user_id
    WHERE r.table_id=$1 AND ($2 IS NULL OR m.created_at>$2) ORDER BY m.created_at,m.id LIMIT 200`);
  const state = await db.query<{ status: string }>(`SELECT status FROM dining_tables WHERE id=$1`, [id]);
  return NextResponse.json({ messages: rows.rows, can_post: state.rows[0]?.status === 'CONFIRMED' });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await apiUser(request); const { id } = await context.params;
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  if (!isCanonicalUuid(id) || !(await member(id, user.id))) return NextResponse.json({ error: '테이블을 찾을 수 없습니다.' }, { status: 404 });
  const state = await db.query<{ status: string }>(`SELECT status FROM dining_tables WHERE id=$1`, [id]);
  if (state.rows[0]?.status !== 'CONFIRMED') return NextResponse.json({ error: '현재 채팅을 사용할 수 없습니다.' }, { status: 409 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 2000 || !isCanonicalUuid(body.requestKey)) return NextResponse.json({ error: '메시지 형식이 올바르지 않습니다.' }, { status: 400 });
  const room = await db.query<{ id: string }>('SELECT id FROM journey_rooms WHERE table_id=$1', [id]);
  if (!room.rowCount) return NextResponse.json({ error: '채팅방을 찾을 수 없습니다.' }, { status: 404 });
  const existing = await db.query<any>('SELECT m.id,m.room_id,m.author_user_id,m.body,m.kind,m.created_at FROM journey_messages m WHERE m.room_id=$1 AND m.request_key=$2', [room.rows[0].id, body.requestKey]);
  if (existing.rowCount) {
    if (existing.rows[0].author_user_id !== user.id || existing.rows[0].body !== body.body.trim()) return NextResponse.json({ error: '같은 요청 키에 다른 메시지를 보낼 수 없습니다.' }, { status: 409 });
    return NextResponse.json({ message: { ...existing.rows[0], author_name: user.email }, replayed: true });
  }
  const idempotentId = randomUUID();
  const inserted = await db.query(`INSERT INTO journey_messages(id,room_id,author_user_id,body,request_key,kind) VALUES($1,$2,$3,$4,$5,'USER') ON CONFLICT(room_id,request_key) DO NOTHING RETURNING id`, [idempotentId, room.rows[0].id, user.id, body.body.trim(), body.requestKey]);
  if (!inserted.rowCount) {
    const replay = await db.query<any>('SELECT m.id,m.room_id,m.author_user_id,m.body,m.kind,m.created_at FROM journey_messages m WHERE m.room_id=$1 AND m.request_key=$2', [room.rows[0].id, body.requestKey]);
    if (!replay.rowCount || replay.rows[0].author_user_id !== user.id || replay.rows[0].body !== body.body.trim()) return NextResponse.json({ error: '같은 요청 키에 다른 메시지를 보낼 수 없습니다.' }, { status: 409 });
    return NextResponse.json({ message: { ...replay.rows[0], author_name: user.email }, replayed: true });
  }
  const saved = await db.query<any>(`SELECT m.id,p.display_name author_name,m.body,m.kind,m.created_at FROM journey_messages m JOIN profiles p ON p.user_id=m.author_user_id WHERE m.id=$1`, [idempotentId]);
  return NextResponse.json({ message: saved.rows[0], replayed: false });
}
