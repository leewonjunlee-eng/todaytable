import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { convertSourceResponse, listSourceResponses, removeSourceConversion } from '@/lib/source-data';
import { sameOrigin } from '@/lib/http';

export async function GET(request: Request) {
  const user = await apiUser(request, true);
  if (!user) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize')) || 30));
  try {
    return NextResponse.json(await listSourceResponses({ q: url.searchParams.get('q') ?? '', issue: url.searchParams.get('issue') ?? '', page, pageSize }));
  } catch {
    return NextResponse.json({ error: '원본 데이터를 읽지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await apiUser(request, true);
  if (!user) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처 오류' }, { status: 403 });
  try {
    const body = await request.json();
    if (typeof body.dataset_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.dataset_sha256) || typeof body.sheet_name !== 'string' || !Number.isInteger(body.sheet_row) || body.sheet_row <= 2) return NextResponse.json({ error: '원본 응답 키를 확인해 주세요.' }, { status: 400 });
    if (body.demo_consent !== true) return NextResponse.json({ error: '참가 자료 매칭 동의를 확인해 주세요.' }, { status: 400 });
    return NextResponse.json(await convertSourceResponse(body, user.id, body.demo_consent), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '참가 자료 변환에 실패했습니다.' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await apiUser(request, true);
  if (!user) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처 오류' }, { status: 403 });
  try {
    const body = await request.json();
    if (typeof body.dataset_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.dataset_sha256) || typeof body.sheet_name !== 'string' || !Number.isInteger(body.sheet_row) || body.sheet_row <= 2) return NextResponse.json({ error: '원본 응답 키를 확인해 주세요.' }, { status: 400 });
    const removed = await removeSourceConversion(body, user.id);
    return NextResponse.json({ removed });
  } catch {
    return NextResponse.json({ error: '참가 자료 변환을 제거하지 못했습니다.' }, { status: 400 });
  }
}
