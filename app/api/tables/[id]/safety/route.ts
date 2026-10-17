import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { isCanonicalUuid } from '@/lib/domain';
import { randomUUID } from 'node:crypto';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await apiUser(request); const { id } = await context.params;
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  if (!isCanonicalUuid(id)) return NextResponse.json({ error: '테이블을 찾을 수 없습니다.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (!isCanonicalUuid(body.targetUserId) || body.targetUserId === user.id || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) return NextResponse.json({ error: '안전 요청 형식이 올바르지 않습니다.' }, { status: 400 });
  const participant = await db.query(`SELECT 1 FROM table_members WHERE table_id=$1 AND status='ACTIVE' AND user_id IN ($2,$3)`, [id, user.id, body.targetUserId]);
  if (participant.rowCount !== 2) return NextResponse.json({ error: '테이블 구성원만 신고할 수 있습니다.' }, { status: 404 });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const report = await client.query<any>(`SELECT id,decision FROM safety_reports WHERE table_id=$1 AND reporter_user_id=$2 AND target_user_id=$3`, [id, user.id, body.targetUserId]);
    let reportId = report.rows[0]?.id;
    if (!reportId) { reportId = randomUUID(); await client.query(`INSERT INTO safety_reports(id,table_id,reporter_user_id,target_user_id,reason) VALUES($1,$2,$3,$4,$5)`, [reportId, id, user.id, body.targetUserId, body.reason.trim()]); }
    else await client.query(`UPDATE safety_reports SET reason=$2 WHERE id=$1 AND decision='OPEN'`, [reportId, body.reason.trim()]);
    await client.query(`INSERT INTO match_relationships(id,source_user_id,target_user_id,relationship_type,active) VALUES($1,$2,$3,'REPORT',true) ON CONFLICT(source_user_id,target_user_id,relationship_type) DO UPDATE SET active=true`, [randomUUID(), user.id, body.targetUserId]);
    if (body.block === true) await client.query(`INSERT INTO match_relationships(id,source_user_id,target_user_id,relationship_type,active) VALUES($1,$2,$3,'BLOCK',true) ON CONFLICT(source_user_id,target_user_id,relationship_type) DO UPDATE SET active=true`, [randomUUID(), user.id, body.targetUserId]);
    await client.query('COMMIT'); return NextResponse.json({ ok: true, blocked: body.block === true });
  } catch (error) { await client.query('ROLLBACK'); return NextResponse.json({ error: '안전 요청을 저장할 수 없습니다.' }, { status: 400 }); } finally { client.release(); }
}
