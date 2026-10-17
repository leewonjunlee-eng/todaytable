import { createHash, randomUUID } from 'node:crypto';
import { databaseProvider, db, type QueryClient } from './db';
import { buildDeterministicGroups, isHardCompatible, groupScore, type MatchCandidate, type MatchWeights } from './matching';

const json = (v: unknown) => JSON.stringify(v);
const parse = <T>(v: unknown, fallback: T): T => { if (typeof v !== 'string') return (v as T) ?? fallback; try { return JSON.parse(v) as T; } catch { return fallback; } };
const pgJson = (value: string) => databaseProvider === 'postgres' ? `${value}::jsonb` : value;

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export type MatchingRun = { runId: string; matchedCount: number; qualityScore: number; unmatched: string[]; groups: string[][] };

export async function provisionTable(client: QueryClient, tableId: string, eventId: string, members: MatchCandidate[]) {
  if (databaseProvider === 'sqlite') {
    const exists = await client.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='journey_rooms'", [], "SELECT name FROM sqlite_master WHERE type='table' AND name='journey_rooms'");
    if (!exists.rowCount) return;
  }
  let event;
  try {
    event = await client.query<any>(`SELECT e.title,e.starts_at,COALESCE(e.ends_at,e.starts_at+interval '2 hours') ends_at,e.area,e.venue_id,v.id venue_id,v.name venue_name,v.address venue_address,v.capacity venue_capacity FROM events e LEFT JOIN venues v ON v.id=e.venue_id WHERE e.id=$1`, [eventId], `SELECT e.title,e.starts_at,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) ends_at,e.area,e.venue_id,v.id venue_id,v.name venue_name,v.address venue_address,v.capacity venue_capacity FROM events e LEFT JOIN venues v ON v.id=e.venue_id WHERE e.id=$1`);
  } catch {
    event = await client.query<any>(`SELECT e.title,e.starts_at,e.area,e.venue_id,v.id venue_id,v.name venue_name,v.address venue_address,v.capacity venue_capacity FROM events e LEFT JOIN venues v ON v.id=e.venue_id WHERE e.id=$1`, [eventId]);
    event.rows[0].ends_at = new Date(new Date(event.rows[0].starts_at).getTime() + 2 * 60 * 60 * 1000).toISOString();
  }
  const row = event.rows[0];
  if (!row) throw new Error('MATCH_EVENT venue lookup failed.');
  let venueId: string | undefined;
  if (!venueId) {
    const venue = await client.query<any>(`SELECT v.id FROM venues v WHERE v.active AND v.area=$1 AND v.capacity >= $2 + COALESCE((SELECT SUM(t.capacity) FROM dining_tables t WHERE t.event_id=$3 AND t.venue_id=v.id AND t.id<>$4),0) ORDER BY v.capacity,v.id LIMIT 1`, [row.area, members.length, eventId, tableId], `SELECT v.id FROM venues v WHERE v.active=1 AND v.area=$1 AND v.capacity >= $2 + COALESCE((SELECT SUM(t.capacity) FROM dining_tables t WHERE t.event_id=$3 AND t.venue_id=v.id AND t.id<>$4),0) ORDER BY v.capacity,v.id LIMIT 1`);
    if (!venue.rowCount) {
      await client.query(`INSERT INTO lifecycle_exceptions(id,source,entity_id,error,details) VALUES($1,'dining_table',$2,$3,${pgJson('$4')})`, [randomUUID(), tableId, `No venue available for ${row.area} (${members.length}).`, json({ status: 'RETRYABLE', area: row.area, capacity: members.length })], `INSERT INTO lifecycle_exceptions(id,source,entity_id,error,details) VALUES($1,'dining_table',$2,$3,$4)`);
      await client.query(`UPDATE dining_tables SET provision_status='EXCEPTION' WHERE id=$1`, [tableId], `UPDATE dining_tables SET provision_status='EXCEPTION' WHERE id=$1`);
      throw new Error(`No venue available for ${row.area} (${members.length}).`);
    }
    venueId = venue.rows[0].id;
    await client.query(`UPDATE events SET venue_id=$2 WHERE id=$1`, [eventId, venueId]);
  }
  await client.query(`UPDATE dining_tables SET venue_id=$2,starts_at=$3,area=$4,capacity=$5,locked_at=now(),provision_status='PROVISIONED' WHERE id=$1`, [tableId, venueId, row.starts_at, row.area, members.length], `UPDATE dining_tables SET venue_id=$2,starts_at=$3,area=$4,capacity=$5,locked_at=CURRENT_TIMESTAMP,provision_status='PROVISIONED' WHERE id=$1`);
  await client.query(`INSERT INTO table_reservations(table_id,venue_id,reservation_name,meeting_time,status,provider) VALUES($1,$2,$3,$4,'CONFIRMED','MOCK') ON CONFLICT(table_id) DO UPDATE SET venue_id=excluded.venue_id,meeting_time=excluded.meeting_time,status='CONFIRMED'`, [tableId, venueId, `Todaytable ${tableId.slice(0, 8)}`, row.starts_at]);
  const topics = Array.from(new Set(members.flatMap((m) => m.interests))).slice(0, 5);
  while (topics.length < 3) topics.push(['서울 저녁 맛집', '여행', '취향 공유'][topics.length]);
  const room = randomUUID();
  await client.query(`INSERT INTO journey_rooms(id,table_id,welcome_message,rules_message,curation_message,topics) VALUES($1,$2,$3,$4,$5,${pgJson('$6')}) ON CONFLICT(table_id) DO NOTHING`, [room, tableId, '식탁에 오신 것을 환영해요.', '서로의 경계를 존중하고 개인정보를 공유하지 마세요.', '오늘의 대화 주제를 골라 편안하게 시작해 보세요.', json(topics)], `INSERT INTO journey_rooms(id,table_id,welcome_message,rules_message,curation_message,topics) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(table_id) DO NOTHING`);
  const actualRoom = await client.query<{ id: string }>('SELECT id FROM journey_rooms WHERE table_id=$1', [tableId]);
  const roomId = actualRoom.rows[0].id;
  for (const [index, message] of ['식탁에 오신 것을 환영해요.', '서로의 경계를 존중하고 개인정보를 공유하지 마세요.', `오늘의 주제: ${topics.join(' · ')}`].entries()) {
    const requestKey = deterministicUuid(`${roomId}:system:${index}`);
    try {
      await client.query(`INSERT INTO journey_messages(id,room_id,author_user_id,body,request_key,kind) VALUES($1,$2,NULL,$3,$4,'SYSTEM') ON CONFLICT(room_id,request_key) DO NOTHING`, [deterministicUuid(`${roomId}:message:${index}`), roomId, message, requestKey]);
    } catch {
      throw new Error('Journey message schema is not provisioned.');
    }
  }
  const attendance = await client.query<any>('SELECT application_id FROM table_members WHERE table_id=$1', [tableId]);
  const reminderAt = new Date(new Date(row.starts_at).getTime() - 24 * 60 * 60 * 1000);
  const feedbackAt = new Date(new Date(row.ends_at).getTime());
  for (const member of attendance.rows) {
    await client.query(`INSERT INTO attendance_records(application_id,event_id,status) VALUES($1,$2,'SCHEDULED') ON CONFLICT(application_id,event_id) DO NOTHING`, [member.application_id, eventId]);
    await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'JOURNEY_REMINDER',$2,$3) ON CONFLICT(job_key) DO NOTHING`, [`journey-reminder:${tableId}:${member.application_id}`, json({ tableId, applicationId: member.application_id }), reminderAt]);
  }
  await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'JOURNEY_FEEDBACK_REQUEST',$2,$3) ON CONFLICT(job_key) DO NOTHING`, [`journey-feedback:${tableId}`, json({ tableId }), feedbackAt]);
  await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'POST_CONTENT',$2,$3) ON CONFLICT(job_key) DO NOTHING`, [`content:${eventId}:${tableId}:v1`, json({ eventId, tableId }), row.starts_at]);
  await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'CLOSE_ATTENDANCE',$2,$3) ON CONFLICT(job_key) DO NOTHING`, [`close-attendance:${tableId}`, json({ tableId, eventId }), row.ends_at]);
  await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'FEEDBACK_FOLLOWUP',$2,$3) ON CONFLICT(job_key) DO NOTHING`, [`feedback-followup:${tableId}`, json({ tableId }), new Date(feedbackAt.getTime() + 24 * 60 * 60 * 1000)]);
  for (const member of members) await client.query(`INSERT INTO notifications(event_id,recipient_user_id,message,channel,status,sent_by) VALUES($1,$2,$3,'IN_APP','SENT',$2)`, [eventId, member.userId, '식탁이 확정되었어요. 채팅방에서 인사를 나눠 보세요.']);
}

/** Rebuilds a cancelled table from its remaining members and other eligible applicants. */
export async function repairTable(tableId: string, eventId?: string, connection?: QueryClient) {
  const client = connection ?? await db.connect(); const own = !connection;
  try {
    if (own) await client.query('BEGIN');
    if (databaseProvider === 'postgres') await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
    const table = await client.query<any>('SELECT id,event_id,match_run_id,status FROM dining_tables WHERE id=$1', [tableId]);
    if (!table.rowCount) throw new Error('Repair table not found.');
    const actualEventId = eventId ?? table.rows[0].event_id;
    const activeCount=await client.query<any>("SELECT count(*) count FROM table_members WHERE table_id=$1 AND status='ACTIVE'",[tableId]);
    if(table.rows[0].status==='CONFIRMED'&&Number(activeCount.rows[0]?.count??0)>=4){if(own)await client.query('COMMIT');return {status:'REPAIRED',tableId};}
    const activeMembers = await client.query<any>(`SELECT a.id application_id,a.user_id,a.status application_status FROM table_members tm JOIN applications a ON a.id=tm.application_id WHERE tm.table_id=$1 AND tm.status='ACTIVE'`,[tableId]);
    const existing = await client.query<any>(`SELECT a.id application_id,a.user_id,pr.birth_year,pr.gender,pr.mbti,pr.interests,pr.traits,pr.desired_traits
      FROM table_members tm JOIN applications a ON a.id=tm.application_id JOIN profiles pr ON pr.user_id=a.user_id
      JOIN payments p ON p.application_id=a.id JOIN users u ON u.id=a.user_id
      WHERE tm.table_id=$1 AND tm.status='ACTIVE' AND a.status='SUBMITTED' AND p.status='PAID' AND u.restricted_status='ACTIVE'
        AND pr.consent_privacy AND pr.consent_operations`, [tableId]);
    const choices = await client.query<any>(`SELECT DISTINCT a.id application_id,a.user_id,pr.birth_year,pr.gender,pr.mbti,pr.interests,pr.traits,pr.desired_traits
      FROM applications a JOIN users u ON u.id=a.user_id JOIN payments p ON p.application_id=a.id JOIN profiles pr ON pr.user_id=a.user_id
      JOIN application_options o ON o.application_id=a.id JOIN events e ON e.id=o.event_id
      WHERE a.status='SUBMITTED' AND a.matching_status IN ('WAITING','REALLOCATING') AND p.status='PAID'
        AND u.restricted_status='ACTIVE' AND pr.consent_privacy AND pr.consent_operations
        AND e.status IN ('OPEN','CLOSED') AND (e.status='CLOSED' OR e.application_deadline<=now())
        AND NOT EXISTS (SELECT 1 FROM table_members tm WHERE tm.application_id=a.id AND tm.status='ACTIVE')`, [], `SELECT DISTINCT a.id application_id,a.user_id,pr.birth_year,pr.gender,pr.mbti,pr.interests,pr.traits,pr.desired_traits
      FROM applications a JOIN users u ON u.id=a.user_id JOIN payments p ON p.application_id=a.id JOIN profiles pr ON pr.user_id=a.user_id
      JOIN application_options o ON o.application_id=a.id JOIN events e ON e.id=o.event_id
      WHERE a.status='SUBMITTED' AND a.matching_status IN ('WAITING','REALLOCATING') AND p.status='PAID'
        AND u.restricted_status='ACTIVE' AND pr.consent_privacy=1 AND pr.consent_operations=1
        AND e.status IN ('OPEN','CLOSED') AND (e.status='CLOSED' OR e.application_deadline<=CURRENT_TIMESTAMP)
        AND NOT EXISTS (SELECT 1 FROM table_members tm WHERE tm.application_id=a.id AND tm.status='ACTIVE')`);
    const all = [...existing.rows, ...choices.rows];
    const optionRows = await client.query<any>('SELECT application_id,event_id FROM application_options');
    const options = new Map<string,string[]>(); for (const row of optionRows.rows) options.set(row.application_id,[...(options.get(row.application_id)??[]),row.event_id]);
    const rel = await client.query<any>("SELECT source_user_id,target_user_id FROM match_relationships WHERE active AND relationship_type IN ('BLOCK','DISLIKE','REPORT')");
    const blocked = new Map<string,string[]>(); for (const x of rel.rows) blocked.set(x.source_user_id,[...(blocked.get(x.source_user_id)??[]),x.target_user_id]);
    const allEventTimes=await client.query<any>("SELECT id,starts_at,COALESCE(ends_at,starts_at+interval '2 hours') ends_at FROM events",[],"SELECT id,starts_at,COALESCE(ends_at,datetime(starts_at,'+2 hours')) ends_at FROM events");
    const repairTimes=Object.fromEntries(allEventTimes.rows.map((e:any)=>[e.id,{startsAt:e.starts_at,endsAt:e.ends_at}]));
    const candidates: MatchCandidate[] = all.map((r) => ({ applicationId:r.application_id,userId:r.user_id,birthYear:Number(r.birth_year),gender:r.gender,mbti:r.mbti,interests:parse(r.interests,[]),traits:parse(r.traits,[]),desiredTraits:parse(r.desired_traits,[]),eventIds:options.get(r.application_id)??[],eventTimes:repairTimes,paid:true,valid:true,blockedUserIds:blocked.get(r.user_id) }));
    const eligibleIds = new Set(existing.rows.map((r:any)=>r.application_id));
    for(const member of activeMembers.rows) if(!eligibleIds.has(member.application_id)) {
      await client.query("UPDATE table_members SET status='REMOVED' WHERE table_id=$1 AND application_id=$2 AND status='ACTIVE'",[tableId,member.application_id]);
      if(member.application_status==='SUBMITTED') await client.query("UPDATE applications SET matching_status='NO_MATCH',updated_at=now() WHERE id=$1",[member.application_id],"UPDATE applications SET matching_status='NO_MATCH',updated_at=CURRENT_TIMESTAMP WHERE id=$1");
    }
    const survivorIds = new Set(existing.rows.map((r:any)=>r.application_id));
    const rules = await client.query<any>('SELECT min_score,weights FROM matching_rules WHERE id=1').catch(()=>({rows:[]}));
    const weights = parse<MatchWeights>(rules.rows[0]?.weights,{gender:.4,mbti:.25,interests:.2,traits:.1,novelty:.05});
    const minScore = Number(rules.rows[0]?.min_score??0);
    let best: MatchCandidate[] | undefined; let selectedEventId=actualEventId; let repairPool:MatchCandidate[]=[];
    const possibleIds=Array.from(new Set([actualEventId,...existing.rows.flatMap((r:any)=>options.get(r.application_id)??[])]));
    const placeholders=possibleIds.map((_,i)=>`$${i+1}`).join(',')||'NULL';
    const eventInfo=await client.query<any>(`SELECT id,status,application_deadline,capacity,starts_at,COALESCE(ends_at,starts_at+interval '2 hours') ends_at FROM events WHERE id IN (${placeholders})`,possibleIds,`SELECT id,status,application_deadline,capacity,starts_at,COALESCE(ends_at,datetime(starts_at,'+2 hours')) ends_at FROM events WHERE id IN (${placeholders})`);
    const eventRows=eventInfo.rows.filter((e:any)=>e.status==='CLOSED'||new Date(e.application_deadline).getTime()<=Date.now());
    for(const event of eventRows) {
      const pool=candidates.filter(c=>c.eventIds.includes(event.id)); repairPool=pool;
      const required=pool.filter(c=>survivorIds.has(c.applicationId));
      if(required.length!==survivorIds.size||required.length>6) continue;
      const extras=pool.filter(c=>!survivorIds.has(c.applicationId));
      const ordered:MatchCandidate[]=[];
      for(const x of required){if(!isHardCompatible(ordered,x,minScore,weights)){ordered.length=0;break;}ordered.push(x);}
      if(ordered.length!==required.length) continue;
      let eventBest:MatchCandidate[]|undefined;
      const choose=(start:number,group:MatchCandidate[])=>{
        if(group.length>=4&&group.length<=6&&required.every(x=>group.some(y=>y.applicationId===x.applicationId))&&groupScore(group,weights)>=minScore&&(!eventBest||groupScore(group,weights)>groupScore(eventBest,weights)))eventBest=group.slice();
        if(group.length===6)return;
        for(let i=start;i<extras.length;i++){const x=extras[i];if(isHardCompatible(group,x,minScore,weights))choose(i+1,[...group,x]);}
      };
      if(ordered.length>=4) eventBest=ordered.slice(); else choose(0,ordered);
      if(!eventBest) continue;
      const occupied=await client.query<any>(`SELECT count(*)::int count FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=$1 AND t.id<>$2 AND tm.status='ACTIVE'`,[event.id,tableId],`SELECT count(*) count FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=$1 AND t.id<>$2 AND tm.status='ACTIVE'`);
      if(Number(occupied.rows[0]?.count??0)+eventBest.length>Number(event.capacity)) continue;
      best=eventBest; selectedEventId=event.id; break;
    }
    if (best) {
      const nowRun = randomUUID();
      await client.query(`INSERT INTO match_runs(id,event_id,rule_version,seed,input_snapshot,status,matched_count,quality_score,completed_at) VALUES($1,$2,'repair-v1',$3,${pgJson('$4')},'COMPLETED',$5,$6,now())`,[nowRun,selectedEventId,`repair:${tableId}`,json({tableId,eventId:selectedEventId,applications:best.map(x=>x.applicationId)}),best.length,groupScore(best,weights)],`INSERT INTO match_runs(id,event_id,rule_version,seed,input_snapshot,status,matched_count,quality_score,completed_at) VALUES($1,$2,'repair-v1',$3,$4,'COMPLETED',$5,$6,CURRENT_TIMESTAMP)`);
      const chosenApps=new Set(best.map(x=>x.applicationId));
      for(const member of existing.rows) if(!chosenApps.has(member.application_id)) await client.query("UPDATE table_members SET status='REMOVED' WHERE table_id=$1 AND application_id=$2 AND status='ACTIVE'",[tableId,member.application_id]);
      if(selectedEventId!==actualEventId){const next=await client.query<any>('SELECT COALESCE(MAX(table_number),0)+1 table_number FROM dining_tables WHERE event_id=$1',[selectedEventId]);await client.query("UPDATE dining_tables SET event_id=$2,table_number=$3,status='CONFIRMED',match_run_id=$4,quality_score=$5,provision_status='PENDING' WHERE id=$1",[tableId,selectedEventId,Number(next.rows[0].table_number),nowRun,groupScore(best,weights)]);await client.query('UPDATE attendance_records SET event_id=$2 WHERE application_id IN (SELECT application_id FROM table_members WHERE table_id=$1 AND status=\'ACTIVE\')',[tableId,selectedEventId]);}
      else await client.query("UPDATE dining_tables SET status='CONFIRMED',match_run_id=$2,quality_score=$3,provision_status='PENDING' WHERE id=$1",[tableId,nowRun,groupScore(best,weights)]);
      for(const c of best){await client.query("INSERT INTO table_members(table_id,application_id,user_id,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(table_id,user_id) DO UPDATE SET application_id=excluded.application_id,status='ACTIVE'",[tableId,c.applicationId,c.userId]);await client.query("UPDATE applications SET matching_status='CONFIRMED',updated_at=now() WHERE id=$1",[c.applicationId],"UPDATE applications SET matching_status='CONFIRMED',updated_at=CURRENT_TIMESTAMP WHERE id=$1");}
      for(const a of best) for(const b of best) if(a.userId!==b.userId) await client.query('INSERT INTO match_history(id,table_id,user_id,other_user_id) VALUES($1,$2,$3,$4) ON CONFLICT(table_id,user_id,other_user_id) DO NOTHING',[randomUUID(),tableId,a.userId,b.userId]);
      for(const c of best) await client.query(`INSERT INTO match_explanations(id,match_run_id,application_id,table_id,kind,message,details) VALUES($1,$2,$3,$4,'REPAIRED',$5,${pgJson('$6')})`,[randomUUID(),nowRun,c.applicationId,tableId,'표의 인원을 재배치했습니다.',json({score:groupScore(best,weights),visible:'privacy-safe'})],`INSERT INTO match_explanations(id,match_run_id,application_id,table_id,kind,message,details) VALUES($1,$2,$3,$4,'REPAIRED',$5,$6)`);
      await client.query("UPDATE lifecycle_exceptions SET status='RESOLVED',resolved_at=now() WHERE source='repair_table' AND entity_id=$1 AND status<>'RESOLVED'",[tableId],"UPDATE lifecycle_exceptions SET status='RESOLVED',resolved_at=CURRENT_TIMESTAMP WHERE source='repair_table' AND entity_id=$1 AND status<>'RESOLVED'");
      await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'PROVISION_TABLE',$2,now()) ON CONFLICT(job_key) DO UPDATE SET status='PENDING',next_attempt_at=now(),last_error=NULL`,[`provision:${tableId}:repair:${nowRun}`,json({tableId,eventId:selectedEventId})],`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'PROVISION_TABLE',$2,CURRENT_TIMESTAMP) ON CONFLICT(job_key) DO UPDATE SET status='PENDING',next_attempt_at=CURRENT_TIMESTAMP,last_error=NULL`);
      if(own) await client.query('COMMIT');
      return {status:'REPAIRED',tableId,eventId:selectedEventId,applicationIds:best.map(x=>x.applicationId)};
    }
    await client.query("UPDATE dining_tables SET status='EXCEPTION' WHERE id=$1",[tableId]);
    await client.query("INSERT INTO lifecycle_exceptions(source,entity_id,error,details) VALUES('repair_table',$1,'Automatic table repair exhausted; admin review required',$2)",[tableId,json({eventId:actualEventId,remaining:existing.rows.length,candidates:repairPool.length})],"INSERT INTO lifecycle_exceptions(source,entity_id,error,details) VALUES('repair_table',$1,'Automatic table repair exhausted; admin review required',$2)");
    if(own) await client.query('COMMIT');
    return {status:'EXCEPTION',tableId};
  } catch(error){if(own) await client.query('ROLLBACK');throw error;} finally {if(own)client.release();}
}
export async function runMatching(eventId: string, seed = 'core-v1', connection?: QueryClient): Promise<MatchingRun> {
  const client = connection ?? await db.connect();
  const own = !connection;
  try {
    if (own) await client.query('BEGIN');
    // One stable lifecycle lock serializes matching, resolution, and submission.
    // Global scope is intentional: correctness beats throughput for this small service.
    if (databaseProvider === 'postgres') await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
    const eventGate = await client.query<any>(`SELECT id,status,application_deadline FROM events WHERE id=$1`, [eventId]);
    if (!eventGate.rowCount) throw new Error('이벤트를 찾을 수 없습니다.');
    const gate = eventGate.rows[0];
    const cutoff = new Date(gate.application_deadline).getTime();
    if (!['OPEN','CLOSED'].includes(gate.status)) {
      if (own) await client.query('COMMIT');
      return { runId: '', matchedCount: 0, qualityScore: 0, unmatched: [], groups: [] };
    }
    if (!Number.isFinite(cutoff) || cutoff > Date.now()) {
      if (own) await client.query('COMMIT');
      return { runId: '', matchedCount: 0, qualityScore: 0, unmatched: [], groups: [] };
    }
    const already = await client.query<{id:string;matched_count:number;quality_score:number}>('SELECT id,matched_count,quality_score FROM match_runs WHERE event_id=$1 AND status=\'COMPLETED\' ORDER BY created_at DESC LIMIT 1', [eventId]);
    if (already.rowCount) {
      if (own) await client.query('COMMIT');
      return { runId: already.rows[0].id, matchedCount: Number(already.rows[0].matched_count), qualityScore: Number(already.rows[0].quality_score), unmatched: [], groups: [] };
    }
    const rows = await client.query<any>(
      `SELECT DISTINCT a.id application_id,a.user_id,a.matching_status,p.status payment_status,
              pr.birth_year,pr.gender,pr.mbti,pr.interests,pr.traits,pr.desired_traits
       FROM applications a JOIN users u ON u.id=a.user_id JOIN payments p ON p.application_id=a.id
       JOIN profiles pr ON pr.user_id=a.user_id JOIN application_options o ON o.application_id=a.id
       JOIN events e ON e.id=o.event_id
       WHERE a.status='SUBMITTED' AND u.restricted_status='ACTIVE' AND a.matching_status IN ('WAITING','REALLOCATING')
         AND p.status='PAID' AND pr.consent_privacy AND pr.consent_operations
         AND e.status IN ('OPEN','CLOSED')
         AND NOT EXISTS (SELECT 1 FROM table_members tm WHERE tm.application_id=a.id AND tm.status='ACTIVE')`,
      [],
      `SELECT DISTINCT a.id application_id,a.user_id,a.matching_status,p.status payment_status,
              pr.birth_year,pr.gender,pr.mbti,pr.interests,pr.traits,pr.desired_traits
       FROM applications a JOIN users u ON u.id=a.user_id JOIN payments p ON p.application_id=a.id JOIN profiles pr ON pr.user_id=a.user_id
       JOIN application_options o ON o.application_id=a.id JOIN events e ON e.id=o.event_id
       WHERE a.status='SUBMITTED' AND u.restricted_status='ACTIVE' AND a.matching_status IN ('WAITING','REALLOCATING') AND p.status='PAID'
         AND pr.consent_privacy=1 AND pr.consent_operations=1 AND e.status IN ('OPEN','CLOSED')
         AND NOT EXISTS (SELECT 1 FROM table_members tm WHERE tm.application_id=a.id AND tm.status='ACTIVE')`,
    );
    const optionRows = await client.query<any>('SELECT application_id,event_id FROM application_options', [], 'SELECT application_id,event_id FROM application_options');
    const eventState = await client.query<any>("SELECT id,status,application_deadline,starts_at,COALESCE(ends_at,starts_at+interval '2 hours') ends_at FROM events WHERE status IN ('OPEN','CLOSED')", [], "SELECT id,status,application_deadline,starts_at,COALESCE(ends_at,datetime(starts_at,'+2 hours')) ends_at FROM events WHERE status IN ('OPEN','CLOSED')");
    const eligibleEvents = new Set<string>(eventState.rows.filter((e: any) => e.status === 'CLOSED' || new Date(e.application_deadline).getTime() <= Date.now()).map((e: any) => e.id));
    const eventIds = new Map<string,string[]>();
    for (const option of optionRows.rows) if (eligibleEvents.has(option.event_id)) eventIds.set(option.application_id, [...(eventIds.get(option.application_id) ?? []), option.event_id]);
    // Expand only the connected consented event/application component, not every applicant in the database.
    const component = new Set<string>([eventId]); let changed = true;
    while (changed) { changed = false; for (const ids of eventIds.values()) if (ids.some((id) => component.has(id))) for (const id of ids) if (!component.has(id)) { component.add(id); changed = true; } }
    const relationships = await client.query<any>("SELECT source_user_id,target_user_id FROM match_relationships WHERE active AND relationship_type IN ('BLOCK','DISLIKE','REPORT')");
    const blocked = new Set(relationships.rows.map((r) => `${r.source_user_id}:${r.target_user_id}`));
    const base = rows.rows.map((r) => ({ ...r, interests: parse<string[]>(r.interests, []), traits: parse<string[]>(r.traits, []), desiredTraits: parse<string[]>(r.desired_traits, []) }));
    const candidateRows = base.filter((r) => (eventIds.get(r.application_id) ?? []).some((id) => component.has(id)));
    const history = await client.query<any>('SELECT user_id,other_user_id FROM match_history');
    const prior = new Map<string,string[]>();
    for (const h of history.rows) prior.set(h.user_id, [...(prior.get(h.user_id) ?? []), h.other_user_id]);
    const blockedBy = new Map<string,string[]>();
    for (const r of relationships.rows) blockedBy.set(r.source_user_id, [...(blockedBy.get(r.source_user_id) ?? []), r.target_user_id]);
    const times=Object.fromEntries(eventState.rows.map((e:any)=>[e.id,{startsAt:e.starts_at,endsAt:e.ends_at}]));
    const candidates: MatchCandidate[] = candidateRows.map((r) => ({ applicationId:r.application_id,userId:r.user_id,birthYear:Number(r.birth_year),gender:r.gender,mbti:r.mbti,interests:parse<string[]>(r.interests, []),traits:parse<string[]>(r.traits, []),desiredTraits:parse<string[]>(r.desired_traits, []), eventIds:eventIds.get(r.application_id) ?? [eventId],eventTimes:times,paid:r.payment_status==='PAID', valid:true, priorUserIds:prior.get(r.user_id), blockedUserIds:blockedBy.get(r.user_id) }));
    const rules = await client.query<any>(`SELECT version,min_score,weights FROM matching_rules WHERE id=1`, [], `SELECT version,min_score,weights FROM matching_rules WHERE id=1`).catch(() => ({ rows: [], rowCount: 0 }));
    const rule = rules.rows[0];
    const weights = parse<MatchWeights>(rule?.weights, { gender: 0.4, mbti: 0.25, interests: 0.2, traits: 0.1, novelty: 0.05 });
    const minScore = Number(rule?.min_score ?? process.env.MATCH_MIN_SCORE ?? 0);
    const result = buildDeterministicGroups(candidates, seed, minScore, weights);

    const accepted: typeof result.groups = []; const rejected: MatchCandidate[] = [];
    const occupiedByEvent = new Map<string, number>();
    for (const group of result.groups) {
      const groupEventId = group.eventId ?? eventId;
      const capacity = await client.query<any>('SELECT capacity FROM events WHERE id=$1', [groupEventId]);
      const occupied = await client.query<any>("SELECT count(*)::int count FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=$1 AND tm.status='ACTIVE'", [groupEventId], "SELECT count(*) count FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=$1 AND tm.status='ACTIVE'");
      const current = Math.max(Number(occupied.rows[0]?.count ?? 0), occupiedByEvent.get(groupEventId) ?? 0);
      if (!capacity.rowCount || current + group.members.length > Number(capacity.rows[0].capacity)) { rejected.push(...group.members); continue; }
      occupiedByEvent.set(groupEventId, current + group.members.length); accepted.push(group);
    }
    const actualMatched = accepted.reduce((n, g) => n + g.members.length, 0);
    const actualUnmatched = [...result.unmatched, ...rejected];
    const runId = randomUUID();
    const snapshot = json({ eventId, seed, candidates:candidates.map((c) => ({ ...c, blockedUserIds:undefined })), ruleVersion:rule?.version ?? 'core-v1', minScore, constraints:{groupMin:4,groupMax:6,maxAgeSpan:8} });
    await client.query(`INSERT INTO match_runs(id,event_id,rule_version,seed,input_snapshot,status,matched_count,quality_score,completed_at) VALUES($1,$2,$3,$4,${pgJson('$5')},'COMPLETED',$6,$7,now())`, [runId,eventId,rule?.version ?? 'core-v1',seed,snapshot,actualMatched,accepted.reduce((n, g) => n + g.score, 0)], `INSERT INTO match_runs(id,event_id,rule_version,seed,input_snapshot,status,matched_count,quality_score,completed_at) VALUES($1,$2,$3,$4,$5,'COMPLETED',$6,$7,CURRENT_TIMESTAMP)`);
    for (const group of accepted) {
      const groupEventId = group.eventId ?? eventId;
      const tableId = randomUUID();
      const nextNumber = await client.query<any>('SELECT COALESCE(MAX(table_number),0)+1 table_number FROM dining_tables WHERE event_id=$1', [groupEventId], 'SELECT COALESCE(MAX(table_number),0)+1 table_number FROM dining_tables WHERE event_id=$1');
      await client.query('INSERT INTO dining_tables(id,event_id,match_run_id,table_number,status,provision_status,quality_score) VALUES($1,$2,$3,$4,\'CONFIRMED\',\'PENDING\',$5)', [tableId,groupEventId,runId,Number(nextNumber.rows[0].table_number),group.score], 'INSERT INTO dining_tables(id,event_id,match_run_id,table_number,status,quality_score) VALUES($1,$2,$3,$4,\'CONFIRMED\',$5)');
      for (const member of group.members) {
        await client.query('INSERT INTO table_members(table_id,application_id,user_id,status) VALUES($1,$2,$3,\'ACTIVE\')', [tableId,member.applicationId,member.userId]);
        await client.query(`UPDATE applications SET matching_status='CONFIRMED',updated_at=now() WHERE id=$1`, [member.applicationId], `UPDATE applications SET matching_status='CONFIRMED',updated_at=CURRENT_TIMESTAMP WHERE id=$1`);
        await client.query(`INSERT INTO match_explanations(id,match_run_id,application_id,table_id,kind,message,details) VALUES($1,$2,$3,$4,'CONFIRMED',$5,${pgJson('$6')})`, [randomUUID(),runId,member.applicationId,tableId,group.explanation,json({ score:group.score, visible:'privacy-safe' })], `INSERT INTO match_explanations(id,match_run_id,application_id,table_id,kind,message,details) VALUES($1,$2,$3,$4,'CONFIRMED',$5,$6)`);
      }
      for (const a of group.members) for (const b of group.members) if (a.userId !== b.userId) await client.query('INSERT INTO match_history(id,table_id,user_id,other_user_id) VALUES($1,$2,$3,$4)', [randomUUID(),tableId,a.userId,b.userId]);
      await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'PROVISION_TABLE',$2,now()) ON CONFLICT(job_key) DO NOTHING`, [`provision:${tableId}`, json({ tableId, eventId: groupEventId })]);
    }
    for (const missing of actualUnmatched) {
      const alternatives = await client.query<any>(`SELECT e.id event_id,e.title,e.starts_at,e.area FROM events e WHERE e.status='OPEN' AND e.starts_at>now() AND e.application_deadline>now() AND NOT EXISTS (SELECT 1 FROM application_options o WHERE o.application_id=$1 AND o.event_id=e.id) ORDER BY e.starts_at`, [missing.applicationId], `SELECT e.id event_id,e.title,e.starts_at,e.area FROM events e WHERE e.status='OPEN' AND e.starts_at>CURRENT_TIMESTAMP AND e.application_deadline>CURRENT_TIMESTAMP AND NOT EXISTS (SELECT 1 FROM application_options o WHERE o.application_id=$1 AND o.event_id=e.id) ORDER BY e.starts_at`);
      const reason = candidates.length < 4 ? '조건을 만족하는 신청자가 4명 미만입니다.' : '공통 일정·연령·상호 제외·최소 점수 조건을 동시에 만족하는 테이블이 부족합니다.';
      await client.query(`UPDATE applications SET matching_status='ALTERNATIVE_OFFERED',updated_at=now() WHERE id=$1`, [missing.applicationId], `UPDATE applications SET matching_status='ALTERNATIVE_OFFERED',updated_at=CURRENT_TIMESTAMP WHERE id=$1`);
      await client.query(`INSERT INTO resolution_cases(id,application_id,status,version,reason,alternatives) VALUES($1,$2,'OFFERED',0,$3,${pgJson('$4')}) ON CONFLICT(application_id) DO UPDATE SET status='OFFERED',version=resolution_cases.version+1,selected_choice=NULL,transferred_event_id=NULL,result_payload=${pgJson('$5')},reason=EXCLUDED.reason,alternatives=EXCLUDED.alternatives,updated_at=now()`, [randomUUID(),missing.applicationId,reason,json(alternatives.rows),json({})], `INSERT INTO resolution_cases(id,application_id,status,version,reason,alternatives) VALUES($1,$2,'OFFERED',0,$3,$4) ON CONFLICT(application_id) DO UPDATE SET status='OFFERED',version=resolution_cases.version+1,selected_choice=NULL,transferred_event_id=NULL,result_payload=$5,reason=excluded.reason,alternatives=excluded.alternatives,updated_at=CURRENT_TIMESTAMP`);
      await client.query(`INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES('RESOLUTION_REOPENED','application',$1,$2)`, [missing.applicationId, json({ reason: 'TRANSFER_TARGET_UNAVAILABLE' })], `INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES('RESOLUTION_REOPENED','application',$1,$2)`);
    }
    if (own) await client.query('COMMIT');
    return { runId, matchedCount:actualMatched, qualityScore:Number(accepted.reduce((n, g) => n + g.score, 0).toFixed(6)), unmatched:actualUnmatched.map((m) => m.applicationId), groups:accepted.map((g) => g.members.map((m) => m.applicationId)) };
  } catch (error) { if (own) await client.query('ROLLBACK'); throw error; } finally { if (own) client.release(); }
}

export async function resolveApplication(userId: string, applicationId: string, choice: 'TRANSFER'|'HOLD'|'REFUND', version: number, eventId?: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (databaseProvider === 'postgres') await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
    const found = await client.query<any>('SELECT r.*,a.user_id,p.id payment_id,p.status payment_status,p.amount_cents FROM resolution_cases r JOIN applications a ON a.id=r.application_id JOIN payments p ON p.application_id=a.id WHERE r.application_id=$1 AND a.user_id=$2 FOR UPDATE', [applicationId,userId]);
    if (!found.rowCount) throw new Error('해결 선택이 이미 처리되었거나 유효하지 않습니다.');
    const row = found.rows[0];
    if (Number(row.version) !== version) {
      if (row.selected_choice === choice && Number(row.version) === version + 1) {
        const prior = parse<{ status?: string; eventId?: string }>(row.result_payload, {});
        if (prior.status !== choice || (choice === 'TRANSFER' && prior.eventId !== eventId)) throw new Error('재시도 대상 선택이 이전 요청과 다릅니다.');
        await client.query('COMMIT'); return prior;
      }
      throw new Error('해결 선택이 이미 처리되었거나 유효하지 않습니다.');
    }
    if (['OFFERED','FAILED'].includes(row.status)) {
    const resolutionId = row.id;
    let resultPayload: Record<string, unknown> = { status: choice };
    if (choice === 'TRANSFER') {
      if (!eventId) throw new Error('이동할 일정을 선택해 주세요.');
      if (row.selected_choice === 'TRANSFER') {
        const prior = parse<{ eventId?: string }>(row.result_payload, {});
        if (prior.eventId !== eventId) throw new Error('재시도 대상 일정이 이전 선택과 다릅니다.');
      }
      const offered = parse<Array<{ event_id?: string; eventId?: string }>>(row.alternatives, []);
      if (!offered.some((x) => (x.event_id ?? x.eventId) === eventId)) throw new Error('제공된 대안 일정만 선택할 수 있습니다.');
      const target = await client.query('SELECT id FROM events WHERE id=$1 AND status=\'OPEN\' AND starts_at>now() AND application_deadline>now() AND NOT EXISTS (SELECT 1 FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=$1 AND tm.status=\'ACTIVE\')', [eventId]);
      if (!target.rowCount) throw new Error('이동할 수 없는 일정입니다.');
      await client.query('DELETE FROM application_options WHERE application_id=$1', [applicationId]);
      await client.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)', [applicationId,eventId]);
      await client.query(`UPDATE resolution_cases SET status='TRANSFERRED',version=version+1,selected_choice='TRANSFER',transferred_event_id=$2,result_payload=${pgJson('$3')},selected_at=now(),updated_at=now() WHERE id=$1`, [resolutionId,eventId,json({ status: choice, eventId })]);
      await client.query(`UPDATE applications SET matching_status='WAITING',status='SUBMITTED',updated_at=now() WHERE id=$1`, [applicationId]);
      await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'MATCH_EVENT',${pgJson('$2')},(SELECT application_deadline FROM events WHERE id=$3)) ON CONFLICT(job_key) DO NOTHING`, [`match-event:${eventId}`,json({ eventId }),eventId]);
      resultPayload = { status: choice, eventId };
    } else if (choice === 'HOLD') {
      const restored = await client.query(`INSERT INTO entitlement_entries(entitlement_id,application_id,entry_type) SELECT own.entitlement_id,$1,'RESTORE' FROM entitlement_entries own WHERE own.application_id=$1 AND own.entry_type='USE' AND NOT EXISTS (SELECT 1 FROM entitlement_entries x WHERE x.entitlement_id=own.entitlement_id AND x.application_id=$1 AND x.entry_type='RESTORE') RETURNING entitlement_id`, [applicationId]);
      if (restored.rowCount) await client.query('UPDATE entitlements SET remaining_uses=remaining_uses+1 WHERE id=$1 AND remaining_uses<original_uses', [restored.rows[0].entitlement_id]);
      await client.query(`UPDATE resolution_cases SET status='HELD',version=version+1,selected_choice='HOLD',result_payload=${pgJson('$2')},selected_at=now(),updated_at=now() WHERE id=$1`, [resolutionId,json({ status: choice })]);
      await client.query(`UPDATE applications SET status='CANCELED',matching_status='NO_MATCH',updated_at=now() WHERE id=$1`, [applicationId]);
    } else {
      if (row.payment_status !== 'PAID' || Number(row.amount_cents) <= 0) throw new Error('기존 이용권은 현금 환불 대상이 아닙니다. 이용권 보류를 선택해 주세요.');
      const spentOther = await client.query(`SELECT 1 FROM entitlement_entries x JOIN entitlement_entries own ON own.entitlement_id=x.entitlement_id WHERE own.application_id=$1 AND own.entry_type='USE' AND x.entry_type='USE' AND x.application_id<>$1 LIMIT 1`, [applicationId]);
      if (spentOther.rowCount) throw new Error('같은 이용권의 다른 신청이 사용되어 환불할 수 없습니다.');
      await client.query(`UPDATE entitlements SET remaining_uses=0 WHERE id IN (SELECT entitlement_id FROM entitlement_entries WHERE application_id=$1 AND entry_type='USE')`, [applicationId]);
      await client.query(`UPDATE payments SET status='REFUND_REQUESTED',updated_at=now() WHERE id=$1`, [row.payment_id]);
      await client.query(`INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES('REFUND_REQUESTED','application',$1,$2)`, [applicationId, json({ resolutionId, revokedEntitlement: true })], `INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES('REFUND_REQUESTED','application',$1,$2)`);
      await client.query(`INSERT INTO refund_requests(id,resolution_id,payment_id,request_key,amount_cents) VALUES($1,$2,$3,$4,$5) ON CONFLICT(resolution_id) DO NOTHING`, [randomUUID(),resolutionId,row.payment_id,`refund:${resolutionId}`,row.amount_cents]);
      await client.query(`UPDATE resolution_cases SET status='REFUND_REQUESTED',version=version+1,selected_choice='REFUND',result_payload=${pgJson('$2')},selected_at=now(),updated_at=now() WHERE id=$1`, [resolutionId,json({ status: choice })]);
      await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'PROCESS_REFUND',${pgJson('$2')},now()) ON CONFLICT(job_key) DO NOTHING`, [`refund:${resolutionId}`,json({ resolutionId })]);
    }
    await client.query('COMMIT'); return resultPayload;
    } else throw new Error('이미 처리된 해결 선택입니다.');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
