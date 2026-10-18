import { databaseProvider, type QueryClient } from './db';
import {normalizeInterests} from './feedback-domain';
import { parseJson } from './operators';

/** Caller owns the transaction. Rebuild, rather than increment, so edits and attendance corrections retract evidence. */
export async function updatePreferenceSignals(client: Pick<QueryClient, 'query'>, userId?: string) {
  if (databaseProvider === 'postgres') await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:feedback-signals',0))");
  const rows = await client.query<any>(`
    SELECT e.starts_at,e.ends_at,f.id,f.author_user_id,d.next_atmosphere,d.next_interests,d.positives
    FROM journey_feedback f JOIN feedback_details d ON d.feedback_id=f.id
    JOIN dining_tables t ON t.id=f.table_id JOIN events e ON e.id=t.event_id
    JOIN table_members tm ON tm.table_id=t.id AND tm.user_id=f.author_user_id AND tm.status='ACTIVE'
    JOIN applications a ON a.id=tm.application_id JOIN users u ON u.id=f.author_user_id
    JOIN attendance_records ar ON ar.application_id=a.id AND ar.event_id=e.id
    LEFT JOIN participant_preferences p ON p.user_id=u.id
    WHERE ar.status='ATTENDED' AND f.is_demo=false AND e.is_demo=false AND a.is_demo=false AND u.is_demo=false
      AND f.conversation_score>=4 AND (p.learning_enabled=true OR p.user_id IS NULL)
      ${userId ? 'AND f.author_user_id=$1' : ''}
    ORDER BY f.author_user_id,f.id`, userId ? [userId] : []);
  const byUser = new Map<string, { atmosphere: Map<string, number>; interests: Set<string>; ids: Set<string> }>();
  for (const row of rows.rows) {
    if(new Date(row.ends_at??new Date(new Date(row.starts_at).getTime()+7200000)).getTime()>Date.now())continue;
    const tags = parseJson<string[]>(row.positives, []);
    // Only positive conversation evidence; a venue score or a keyword in free text never creates a signal.
    if (!tags.some(t => ['COMMON_INTERESTS', 'CONVERSATION', 'PERSPECTIVES'].includes(t))) continue;
    let evidence = byUser.get(row.author_user_id);
    if (!evidence) { evidence = { atmosphere: new Map(), interests: new Set(), ids: new Set() }; byUser.set(row.author_user_id, evidence); }
    if (evidence.ids.has(row.id)) continue;
    evidence.ids.add(row.id);
    evidence.atmosphere.set(row.next_atmosphere, (evidence.atmosphere.get(row.next_atmosphere) ?? 0) + 1);
    for (const interest of normalizeInterests(parseJson<string[]>(row.next_interests, []))) evidence.interests.add(interest);
  }
  await client.query(`DELETE FROM preference_signals${userId ? ' WHERE user_id=$1' : ''}`, userId ? [userId] : []);
  for (const [id, evidence] of byUser) {
    const count = evidence.ids.size;
    const atmosphere = [...evidence.atmosphere].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'BALANCED';
    await client.query(`INSERT INTO preference_signals(user_id,atmosphere,interests,evidence_count,confidence) VALUES($1,$2,$3,$4,$5)`,
      [id, atmosphere, JSON.stringify([...evidence.interests].sort()), count, count / (count + 1)]);
  }
}
