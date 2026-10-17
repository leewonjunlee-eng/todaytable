import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  const subject = process.env.VAPID_SUBJECT ?? '';
  const validKey = (value: string) => /^[A-Za-z0-9_-]{40,100}$/.test(value);
  let configured = validKey(publicKey) && validKey(privateKey);
  try { const url = new URL(subject); configured = configured && ['https:', 'mailto:'].includes(url.protocol); } catch { configured = false; }
  return NextResponse.json({ configured, ...(configured ? { publicKey } : {}) });
}
