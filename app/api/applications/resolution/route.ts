import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/http';
import { resolveApplication } from '@/lib/lifecycle-service';

export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  try {
    const body = await request.json();
    if (!['TRANSFER','HOLD','REFUND'].includes(body.choice) || !Number.isInteger(body.version) || typeof body.applicationId !== 'string') throw new Error('선택 정보가 유효하지 않습니다.');
    return NextResponse.json(await resolveApplication(user.id, body.applicationId, body.choice, body.version, body.eventId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '해결 선택을 저장하지 못했습니다.' }, { status: 400 });
  }
}
