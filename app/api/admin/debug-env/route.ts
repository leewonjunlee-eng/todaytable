import {requireAdmin} from '@/lib/auth';
import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export async function GET() {
  try { await requireAdmin(); } catch { return NextResponse.json({ ok: false, error: 'auth / session_secret missing' }, { status: 401 }); }
  const env = {
    DATABASE_PROVIDER: process.env.DATABASE_PROVIDER || 'NOT SET',
    DATABASE_URL: process.env.DATABASE_URL ? 'SET (hidden)' : 'NOT SET',
    SESSION_SECRET: process.env.SESSION_SECRET ? 'SET (hidden)' : 'NOT SET',
    WORKER_ID: process.env.WORKER_ID || 'NOT SET',
    APP_URL: process.env.APP_URL || 'NOT SET',
    NODE_ENV: process.env.NODE_ENV || 'NOT SET',
  };
  return NextResponse.json({ ok: true, env });
}
