import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { databaseProvider, db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';

const keys = ['gender', 'mbti', 'interests', 'traits', 'novelty'];
const asWeights = (value: unknown) => Object.fromEntries(keys.map((key) => [key, Number((value as Record<string, unknown>)?.[key])]));

export async function GET(request: Request) {
  if (!(await apiUser(request, true))) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  const row = await db.query<any>(`SELECT version,min_score,weights FROM matching_rules WHERE id=1`);
  return NextResponse.json(row.rows[0] ? { version: row.rows[0].version, minScore: Number(row.rows[0].min_score), weights: typeof row.rows[0].weights === 'string' ? JSON.parse(row.rows[0].weights) : row.rows[0].weights } : { version: 'core-v1', minScore: 0, weights: {} });
}

export async function PUT(request: Request) {
  const user = await apiUser(request, true);
  if (!user) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  const body = await request.json().catch(() => ({})); const minScore = Number(body.minScore);
  if (typeof body.version !== 'string' || !/^[A-Za-z0-9._-]{1,40}$/.test(body.version) || !Number.isFinite(minScore) || minScore < 0 || minScore > 1 || !body.weights || typeof body.weights !== 'object') return NextResponse.json({ error: '규칙 형식이 올바르지 않습니다.' }, { status: 400 });
  const weights = asWeights(body.weights); if (Object.values(weights).some((x) => !Number.isFinite(x) || x < 0 || x > 1) || Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) > 1e-6) return NextResponse.json({ error: '가중치 합계는 1이어야 합니다.' }, { status: 400 });
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    if(databaseProvider==='postgres') await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
    const current = await client.query<any>(`SELECT version,min_score,weights FROM matching_rules WHERE id=1 FOR UPDATE`, [], `SELECT version,min_score,weights FROM matching_rules WHERE id=1`);
    if (current.rows[0]?.version === body.version) { await client.query('ROLLBACK'); return NextResponse.json({ error: '규칙 버전은 변경할 수 없습니다.' }, { status: 409 }); }
    const duplicate = await client.query(`SELECT 1 FROM matching_rule_versions WHERE version=$1`, [body.version]);
    if (duplicate.rowCount) { await client.query('ROLLBACK'); return NextResponse.json({ error: '이미 사용된 규칙 버전입니다.' }, { status: 409 }); }
    await client.query(`INSERT INTO matching_rule_versions(version,min_score,weights,created_by) VALUES($1,$2,$3,$4)`, [body.version, minScore, JSON.stringify(weights), user.id]);
    await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,'MATCHING_RULES_UPDATED','matching_rules','1',$2,$3)`, [user.id, JSON.stringify(current.rows[0] ?? null), JSON.stringify({ version: body.version, minScore, weights })]);
    await client.query(`UPDATE matching_rules SET version=$1,min_score=$2,weights=$3,immutable_version=$1,updated_at=now() WHERE id=1`, [body.version, minScore, JSON.stringify(weights)], `UPDATE matching_rules SET version=$1,min_score=$2,weights=$3,immutable_version=$1,updated_at=CURRENT_TIMESTAMP WHERE id=1`);
    await client.query('COMMIT');
    return NextResponse.json({ version: body.version, minScore, weights });
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
