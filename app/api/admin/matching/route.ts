import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { runMatching } from '@/lib/lifecycle-service';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await apiUser(request, true);
    if (!user) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
    const rows = await db.query(`SELECT t.id,t.event_id,t.match_run_id,t.table_number,t.status,t.quality_score,t.created_at,e.title event_title FROM dining_tables t JOIN events e ON e.id=t.event_id ORDER BY t.created_at DESC LIMIT 50`);
    return NextResponse.json({ tables: rows.rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await apiUser(req, true);
    if (!user) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
    if (!sameOrigin(req)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const eventId = body.event_id || null;
    if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });
    return NextResponse.json(await runMatching(eventId, `admin-${user.id}`));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
