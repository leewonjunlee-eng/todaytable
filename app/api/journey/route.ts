import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const [apps, options, payments, explanations, resolutions, tables, entitlements, notifications, recommendations, history] = await Promise.all([
    db.query(`SELECT a.id,a.status,a.matching_status,a.pass_choice,a.amount_cents,a.created_at FROM applications a WHERE a.user_id=$1 ORDER BY a.created_at DESC`, [user.id]),
    db.query(`SELECT o.application_id,e.id event_id,e.title,e.starts_at,e.area,e.application_deadline FROM application_options o JOIN applications a ON a.id=o.application_id JOIN events e ON e.id=o.event_id WHERE a.user_id=$1 ORDER BY e.starts_at`, [user.id]),
    db.query(`SELECT p.application_id,p.status payment_status FROM payments p JOIN applications a ON a.id=p.application_id WHERE a.user_id=$1`, [user.id]),
    db.query(`SELECT application_id,message FROM match_explanations WHERE application_id IN (SELECT id FROM applications WHERE user_id=$1) ORDER BY created_at`, [user.id]),
    db.query(`SELECT r.application_id,r.id,r.status,r.version,r.reason,r.alternatives FROM resolution_cases r JOIN applications a ON a.id=r.application_id WHERE a.user_id=$1`, [user.id]),
    db.query(`SELECT tm.application_id,tm.table_id,t.event_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE tm.user_id=$1 AND tm.status='ACTIVE'`, [user.id]),
    db.query(`SELECT id,remaining_uses,expires_at FROM entitlements WHERE user_id=$1 AND remaining_uses>0 ORDER BY expires_at`, [user.id]),
    db.query(`SELECT id,message,created_at,action_url FROM notifications WHERE recipient_user_id=$1 ORDER BY created_at DESC LIMIT 50`, [user.id]),
    db.query(`SELECT id,title,starts_at,area,application_deadline FROM events WHERE status='OPEN' AND starts_at>now() AND application_deadline>now() ORDER BY starts_at LIMIT 5`, [], `SELECT id,title,starts_at,area,application_deadline FROM events WHERE status='OPEN' AND starts_at>CURRENT_TIMESTAMP AND application_deadline>CURRENT_TIMESTAMP ORDER BY starts_at LIMIT 5`),
    db.query(`SELECT DISTINCT t.id table_id,e.title,e.starts_at,e.ends_at,e.area,ar.status attendance_status,CASE WHEN f.id IS NULL THEN false ELSE true END feedback_submitted FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id LEFT JOIN attendance_records ar ON ar.application_id=tm.application_id AND ar.event_id=e.id LEFT JOIN journey_feedback f ON f.table_id=t.id AND f.author_user_id=$1 WHERE tm.user_id=$1 AND tm.status='ACTIVE' AND t.status='CONFIRMED' ORDER BY e.starts_at DESC`, [user.id], `SELECT DISTINCT t.id table_id,e.title,e.starts_at,e.ends_at,e.area,ar.status attendance_status,CASE WHEN f.id IS NULL THEN 0 ELSE 1 END feedback_submitted FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id LEFT JOIN attendance_records ar ON ar.application_id=tm.application_id AND ar.event_id=e.id LEFT JOIN journey_feedback f ON f.table_id=t.id AND f.author_user_id=$1 WHERE tm.user_id=$1 AND tm.status='ACTIVE' AND t.status='CONFIRMED' ORDER BY e.starts_at DESC`),
  ]);
  const paymentByApp = new Map(payments.rows.map((r: any) => [r.application_id, r.payment_status]));
  const optionsByApp = new Map<string, any[]>();
  for (const row of options.rows) optionsByApp.set(row.application_id, [...(optionsByApp.get(row.application_id) ?? []), { id: row.event_id, title: row.title, starts_at: row.starts_at, area: row.area, application_deadline: row.application_deadline }]);
  const tableByApp = new Map(tables.rows.map((r: any) => [r.application_id, r.table_id]));
  const explanationByApp = new Map<string, string>();
  for (const row of explanations.rows) if (!explanationByApp.has(row.application_id)) explanationByApp.set(row.application_id, row.message);
  const resolutionByApp = new Map(resolutions.rows.map((r: any) => [r.application_id, { id: r.id, status: r.status, version: Number(r.version), reason: r.reason, alternatives: typeof r.alternatives === 'string' ? JSON.parse(r.alternatives || '[]') : (r.alternatives ?? []) }]));
  const applications = apps.rows.map((a: any) => ({ id: a.id, status: a.status, matching_status: a.matching_status, payment_status: paymentByApp.get(a.id) ?? 'PENDING', amount_cents: a.amount_cents, pass_choice: a.pass_choice, created_at: a.created_at, events: optionsByApp.get(a.id) ?? [], table_id: tableByApp.get(a.id) ?? null, explanation: explanationByApp.get(a.id) ?? null, resolution: resolutionByApp.get(a.id) ?? null }));
  return NextResponse.json({ applications, entitlements: entitlements.rows, notifications: notifications.rows, recommendations: recommendations.rows, history: history.rows.filter((r:any)=>new Date(r.ends_at??new Date(new Date(r.starts_at).getTime()+7200000)).getTime()<=Date.now()), upcoming:history.rows.filter((r:any)=>new Date(r.ends_at??new Date(new Date(r.starts_at).getTime()+7200000)).getTime()>Date.now()).reverse(), supportUnread:(await db.query(`SELECT t.id FROM support_tickets t LEFT JOIN support_reads r ON r.ticket_id=t.id AND r.actor_key=$2 WHERE t.user_id=$1 AND t.first_response_at IS NOT NULL AND (r.read_at IS NULL OR r.read_at<t.last_public_at)`,[user.id,`user:${user.id}`])).rowCount });
}
