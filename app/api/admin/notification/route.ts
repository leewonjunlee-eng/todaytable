import {requireAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({})) as { message?: string; event_id?: string };
    const admin = await requireAdmin();
    await db.query(`INSERT INTO notifications (event_id, message, channel, status, sent_by) VALUES ($1, $2, 'IN_APP', 'SENT', $3)`, [body.event_id || null, body.message || '', admin.id]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
