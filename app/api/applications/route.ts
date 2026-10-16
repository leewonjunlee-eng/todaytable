import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { submitApplication } from '@/lib/application-service';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const result = await db.query(
    `SELECT a.id,a.status,a.matching_status,a.pass_choice,a.amount_cents,a.created_at,
            p.status payment_status,p.id payment_id,
            array_agg(json_build_object('id',e.id,'title',e.title,'startsAt',e.starts_at,'area',e.area)) events
     FROM applications a JOIN payments p ON p.application_id=a.id
     LEFT JOIN application_options o ON o.application_id=a.id
     LEFT JOIN events e ON e.id=o.event_id
     WHERE a.user_id=$1 GROUP BY a.id,p.status,p.id ORDER BY a.created_at DESC`,
    [user.id],
    `SELECT a.id,a.status,a.matching_status,a.pass_choice,a.amount_cents,a.created_at,
            p.status payment_status,p.id payment_id,
            json_group_array(json_object('id',e.id,'title',e.title,'startsAt',e.starts_at,'area',e.area)) events
     FROM applications a JOIN payments p ON p.application_id=a.id
     LEFT JOIN application_options o ON o.application_id=a.id LEFT JOIN events e ON e.id=o.event_id
     WHERE a.user_id=$1 GROUP BY a.id,p.status,p.id ORDER BY a.created_at DESC`,
  );
  return NextResponse.json(result.rows);
}

export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  }
  try {
    const result = await submitApplication(user.id, await request.json());
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '신청을 저장하지 못했습니다.' },
      { status: 400 },
    );
  }
}
