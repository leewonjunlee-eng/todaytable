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
  const access = await db.query<any>(`SELECT e.ends_at, e.starts_at FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.table_id=$1 AND tm.user_id=$2 AND tm.status='ACTIVE'`, [id, user.id]);
  if (!access.rowCount) return NextResponse.json({ error: '테이블 구성원만 후기 작성이 가능합니다.' }, { status: 404 });
  const end = new Date(access.rows[0].ends_at ?? new Date(new Date(access.rows[0].starts_at).getTime() + 2 * 3600_000)).getTime();
  if (Date.now() < end) return NextResponse.json({ error: '행사 종료 후 작성할 수 있습니다.' }, { status: 400 });
  const b = await request.json().catch(() => ({}));
  const scores = ['tableScore', 'conversationScore', 'venueScore'].map((key) => Number(b[key]));
  const likes = Array.isArray(b.likedUserIds) ? b.likedUserIds : []; const dislikes = Array.isArray(b.dislikedUserIds) ? b.dislikedUserIds : [];
  if (scores.some((score) => !Number.isInteger(score) || score < 1 || score > 5) || typeof b.returnIntent !== 'boolean' || typeof b.recommendIntent !== 'boolean' || typeof b.comment !== 'string' || b.comment.length > 2000 || likes.some((x: unknown) => !isCanonicalUuid(String(x))) || dislikes.some((x: unknown) => !isCanonicalUuid(String(x))) || new Set([...likes, ...dislikes]).size !== likes.length + dislikes.length || likes.includes(user.id) || dislikes.includes(user.id)) return NextResponse.json({ error: '후기 형식이 올바르지 않습니다.' }, { status: 400 });
  const peers = await db.query<{ user_id: string }>(`SELECT user_id FROM table_members WHERE table_id=$1 AND status='ACTIVE'`, [id]);
  const allowed = new Set(peers.rows.map((r) => r.user_id));
  if ([...likes, ...dislikes].some((target: string) => !allowed.has(target))) return NextResponse.json({ error: '같은 테이블 구성원만 선택할 수 있습니다.' }, { status: 400 });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO journey_feedback(id,table_id,author_user_id,table_score,conversation_score,venue_score,return_intent,recommend_intent,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(table_id,author_user_id) DO UPDATE SET table_score=excluded.table_score,conversation_score=excluded.conversation_score,venue_score=excluded.venue_score,return_intent=excluded.return_intent,recommend_intent=excluded.recommend_intent,comment=excluded.comment`, [randomUUID(), id, user.id, ...scores, b.returnIntent, b.recommendIntent, b.comment]);
    await client.query(`DELETE FROM feedback_relationships WHERE table_id=$1 AND source_user_id=$2`, [id, user.id]);
    await client.query(`UPDATE match_relationships SET active=false WHERE source_user_id=$1 AND target_user_id IN (SELECT user_id FROM table_members WHERE table_id=$2) AND relationship_type='DISLIKE'`, [user.id, id]);
    for (const [type, ids] of [['LIKE', likes], ['DISLIKE', dislikes]] as const) for (const target of ids) {
      await client.query(`INSERT INTO feedback_relationships(id,table_id,source_user_id,target_user_id,relationship_type) VALUES($1,$2,$3,$4,$5)`, [randomUUID(), id, user.id, target, type]);
      if (type === 'DISLIKE') await client.query(`INSERT INTO match_relationships(id,source_user_id,target_user_id,relationship_type,active) VALUES($1,$2,$3,'DISLIKE',true) ON CONFLICT(source_user_id,target_user_id,relationship_type) DO UPDATE SET active=true`, [randomUUID(), user.id, target]);
    }
    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (error) { await client.query('ROLLBACK'); return NextResponse.json({ error: error instanceof Error ? error.message : '후기 저장에 실패했습니다.' }, { status: 400 }); } finally { client.release(); }
}
