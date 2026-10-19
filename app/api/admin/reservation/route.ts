import {requestOperator} from '@/lib/operators';
import { db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { isCanonicalUuid } from '@/lib/domain';
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const admin = await requestOperator(request);
  if (!admin) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (!isCanonicalUuid(body.event_id) || !isCanonicalUuid(body.venue_id)) return NextResponse.json({ error: 'event_id + venue_id required' }, { status: 400 });
  const venue = await db.query(`SELECT id FROM venues WHERE id=$1 AND active`, [body.venue_id], `SELECT id FROM venues WHERE id=$1 AND active=1`);
  if (!venue.rowCount) return NextResponse.json({ error: '활성 장소를 찾을 수 없습니다.' }, { status: 404 });
  await db.query(`INSERT INTO reservations (event_id, venue_id, status, created_by) VALUES ($1, $2, 'CONFIRMED', $3)`, [body.event_id, body.venue_id, admin.id]);
  return NextResponse.json({ ok: true });
}
