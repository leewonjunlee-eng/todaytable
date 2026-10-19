import { NextResponse } from 'next/server';
import {requestOperator} from '@/lib/operators';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const user = await requestOperator(request);
  if (!user) return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });

  const [applications, payments, jobs, events, venues] = await Promise.all([
    db.query(
      `SELECT a.id,a.created_at,a.status,a.matching_status,a.amount_cents,u.email,
              p.display_name,p.birth_year,p.gender,py.status payment_status,py.amount_cents paid_cents,
              array_agg(e.title) event_titles,array_agg(e.area) areas
       FROM applications a JOIN users u ON u.id=a.user_id LEFT JOIN profiles p ON p.user_id=u.id
       LEFT JOIN payments py ON py.application_id=a.id LEFT JOIN application_options o ON o.application_id=a.id
       LEFT JOIN events e ON e.id=o.event_id
       GROUP BY a.id,u.email,p.display_name,p.birth_year,p.gender,py.status,py.amount_cents
       ORDER BY a.created_at DESC`,
      [],
      `SELECT a.id,a.created_at,a.status,a.matching_status,a.amount_cents,u.email,
              p.display_name,p.birth_year,p.gender,py.status payment_status,py.amount_cents paid_cents,
              json_group_array(e.title) event_titles,json_group_array(e.area) areas
       FROM applications a JOIN users u ON u.id=a.user_id LEFT JOIN profiles p ON p.user_id=u.id
       LEFT JOIN payments py ON py.application_id=a.id LEFT JOIN application_options o ON o.application_id=a.id
       LEFT JOIN events e ON e.id=o.event_id
       GROUP BY a.id,u.email,p.display_name,p.birth_year,p.gender,py.status,py.amount_cents
       ORDER BY a.created_at DESC`,
    ),
    db.query('SELECT status,count(*)::int count,coalesce(sum(amount_cents),0)::int amount_cents FROM payments GROUP BY status'),
    db.query('SELECT status,count(*)::int count FROM scheduled_jobs GROUP BY status'),
    db.query('SELECT count(*)::int count FROM events'),
    db.query('SELECT count(*)::int count FROM venues WHERE active'),
  ]);
  return NextResponse.json({
    applications: applications.rows,
    payments: payments.rows,
    jobs: jobs.rows,
    events: events.rows[0]?.count ?? 0,
    venues: venues.rows[0]?.count ?? 0,
  });
}
