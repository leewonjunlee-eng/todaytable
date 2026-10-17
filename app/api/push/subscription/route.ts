import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';

const trustedPushHosts = new Set((process.env.PUSH_TRUSTED_HOSTS ?? 'fcm.googleapis.com,updates.push.services.mozilla.com,wns2-par02p.notify.windows.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname)) return false;
    const host = url.hostname.toLowerCase();
    return [...trustedPushHosts].some((trusted) => host === trusted || host.endsWith(`.${trusted}`));
  } catch { return false; }
}


export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  return NextResponse.json(publicKey && process.env.VAPID_PRIVATE_KEY ? { configured: true, publicKey } : { configured: false });
}
export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return NextResponse.json({ error: '푸시 알림이 설정되지 않았습니다.' }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  if (!body || !validPushEndpoint(body.endpoint) || !body.keys || typeof body.keys.p256dh !== 'string' || typeof body.keys.auth !== 'string' || body.keys.p256dh.length > 256 || body.keys.auth.length > 256) return NextResponse.json({ error: '구독 형식이 올바르지 않습니다.' }, { status: 400 });
  await db.query(`INSERT INTO push_subscriptions(id,user_id,endpoint,subscription,active,updated_at) VALUES($1,$2,$3,$4,true,now()) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription=excluded.subscription,active=true,updated_at=now()`, [randomUUID(), user.id, body.endpoint, JSON.stringify(body)]);
  return NextResponse.json({ ok: true });
}
export async function DELETE(request: Request) {
  const user = await apiUser(request);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (!validPushEndpoint(body.endpoint)) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  await db.query(`UPDATE push_subscriptions SET active=false,updated_at=now() WHERE user_id=$1 AND endpoint=$2`, [user.id, body.endpoint]);
  return NextResponse.json({ ok: true });
}
