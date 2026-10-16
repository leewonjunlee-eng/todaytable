import {requireAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({})) as { event_id?: string; venue_id?: string };
    const eventId = body.event_id; const venueId = body.venue_id;
    if (!eventId || !venueId) return NextResponse.json({ error: 'event_id + venue_id required' }, { status: 400 });
    const admin = await requireAdmin();
    await db.query(`INSERT INTO reservations (event_id, venue_id, status, created_by) VALUES ($1, $2, 'CONFIRMED', $3)`, [eventId, venueId, admin.id]);
    return NextResponse.json({ ok: true, note: 'reservation confirmed' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
