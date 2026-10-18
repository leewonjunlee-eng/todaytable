import {participantCuration,conversationQuestions} from '@/lib/table-experience';
import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isCanonicalUuid } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await apiUser(request); if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { id } = await context.params;
  if (!isCanonicalUuid(id)) return NextResponse.json({ error: '테이블을 찾을 수 없습니다.' }, { status: 404 });
  const member = await db.query(`SELECT 1 FROM table_members WHERE table_id=$1 AND user_id=$2 AND status='ACTIVE'`, [id, user.id]);
  if (!member.rowCount) return NextResponse.json({ error: '테이블 구성원만 조회할 수 있습니다.' }, { status: 404 });
  const table = await db.query<any>(`SELECT t.id,t.event_id,t.table_number,t.status,e.is_demo,e.title,e.starts_at,COALESCE(e.ends_at,e.starts_at+interval '2 hours') ends_at,e.area,te.explanation,jr.topics,v.name venue_name,v.address venue_address,tr.meeting_time,tr.reservation_name FROM dining_tables t JOIN events e ON e.id=t.event_id LEFT JOIN LATERAL (SELECT message explanation FROM match_explanations WHERE table_id=t.id ORDER BY created_at LIMIT 1) te ON true LEFT JOIN journey_rooms jr ON jr.table_id=t.id LEFT JOIN venues v ON v.id=t.venue_id LEFT JOIN table_reservations tr ON tr.table_id=t.id WHERE t.id=$1`, [id], `SELECT t.id,t.event_id,t.table_number,t.status,e.is_demo,e.title,e.starts_at,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) ends_at,e.area,(SELECT message FROM match_explanations WHERE table_id=t.id ORDER BY created_at LIMIT 1) explanation,jr.topics,v.name venue_name,v.address venue_address,tr.meeting_time,tr.reservation_name FROM dining_tables t JOIN events e ON e.id=t.event_id LEFT JOIN journey_rooms jr ON jr.table_id=t.id LEFT JOIN venues v ON v.id=t.venue_id LEFT JOIN table_reservations tr ON tr.table_id=t.id WHERE t.id=$1`);
  if (!table.rowCount) return NextResponse.json({ error: '테이블을 찾을 수 없습니다.' }, { status: 404 });
  const members = await db.query(`SELECT tm.user_id,p.display_name,p.mbti,p.interests FROM table_members tm JOIN profiles p ON p.user_id=tm.user_id WHERE tm.table_id=$1 AND tm.status='ACTIVE' ORDER BY tm.joined_at`, [id]);
  const attendance = await db.query<any>(`SELECT ar.status,(e.starts_at-interval '30 minutes'<=now() AND COALESCE(e.ends_at,e.starts_at+interval '2 hours')>=now()) can_check_in FROM attendance_records ar JOIN events e ON e.id=ar.event_id JOIN table_members tm ON tm.application_id=ar.application_id WHERE tm.table_id=$1 AND tm.user_id=$2 AND tm.status='ACTIVE' AND ar.event_id=e.id AND ar.event_id=(SELECT event_id FROM dining_tables WHERE id=$1)`, [id, user.id], `SELECT ar.status,(datetime(e.starts_at,'-30 minutes')<=CURRENT_TIMESTAMP AND COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours'))>=CURRENT_TIMESTAMP) can_check_in FROM attendance_records ar JOIN events e ON e.id=ar.event_id JOIN table_members tm ON tm.application_id=ar.application_id WHERE tm.table_id=$1 AND tm.user_id=$2 AND tm.status='ACTIVE' AND ar.event_id=e.id AND ar.event_id=(SELECT event_id FROM dining_tables WHERE id=$1)`);
  const feedback = await db.query(`SELECT 1 FROM journey_feedback WHERE table_id=$1 AND author_user_id=$2`, [id, user.id]);
  const row = table.rows[0];
  return NextResponse.json({ table: { id: row.id, event_id: row.event_id, table_number: row.table_number, is_demo: row.is_demo, status: row.status, title: row.title, starts_at: row.starts_at, ends_at: row.ends_at, area: row.area, explanation: row.explanation ?? null, curation:participantCuration(members.rows), topics: conversationQuestions(members.rows), venue: row.venue_name ? { name: row.venue_name, address: row.venue_address, map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.venue_address)}`, meeting_time: row.meeting_time, reservation_name: row.reservation_name, meal_price_note: '식사 비용은 각자 부담입니다.' } : null }, currentUserId:user.id,event_ended:new Date(row.ends_at).getTime()<=Date.now(),feedback_eligible:new Date(row.ends_at).getTime()<=Date.now()&&attendance.rows[0]?.status==='ATTENDED',members: members.rows, attendance: attendance.rows[0] ?? { status: 'SCHEDULED', can_check_in: false }, feedback_submitted: feedback.rowCount > 0 });
}
