import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { tokenHash } from '@/lib/security';

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  }
  const token = request.headers.get('cookie')
    ?.match(/(?:^|;\s*)todaytable_session=([^;]+)/)?.[1];
  if (token) {
    try {
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(decodeURIComponent(token))]);
    } catch {
      // The browser cookie is still removed if the session store is unavailable.
    }
  }
  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  response.cookies.set('todaytable_session', '', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
    path: '/', maxAge: 0,
  });
  return response;
}
