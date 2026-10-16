// @ts-nocheck
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.query(`
      SELECT ta.id, ta.event_id, ta.table_name, ta.assigned_user_ids,
             e.title as event_title
      FROM table_assignments ta
      JOIN events e ON ta.event_id = e.id
      ORDER BY ta.created_at DESC
      LIMIT 50
    `);
    return NextResponse.json({ assignments: rows || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const eventId = body.event_id || null;
    // Minimal sequential matching: group by event, assign 6 per table
    if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });
    const sql = `SELECT a.id as app_id, a.user_id FROM applications a WHERE a.status = 'SUBMITTED' AND a.matching_status = 'WAITING'`;
    // @ts-ignore
    const apps = (await db.query(sql, [eventId])) as any[];
    if (!apps || apps.length === 0) return NextResponse.json({ assigned: 0, note: 'no waiting apps' });
    const appsAsArray = (apps as any) || [];
    // Simple grouping: first 6 -> Table 1, next 6 -> Table 2, ...
    const tableSize = 6;
    const groups = Math.ceil((apps as any[]).length / tableSize);
    const assigned = [];
    for (let g = 0; g < groups; g++) {
      const group = apps.slice(g * tableSize, (g + 1) * tableSize);
      const tableName = `Table ${g + 1}`;
      const userIds = group.map((r: any) => r.user_id);
      await db.query(
        `INSERT INTO table_assignments (event_id, table_name, assigned_user_ids, created_by)
         VALUES ($1, $2, $3, $4)`,
        [eventId, tableName, JSON.stringify(userIds), (await requireAdmin()).id]
      );
      // Update apps to MATCHING
      const ids = group.map((r: any) => r.app_id);
      await db.query(
        `UPDATE applications SET matching_status = 'MATCHING', updated_at = now() WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      assigned.push({ tableName, count: group.length, userIds });
    }
    return NextResponse.json({ assigned: assigned.length, groups: assigned });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
