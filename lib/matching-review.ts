import {recordReallocation,reallocationPriority} from './reallocation';
import {createHash,randomUUID} from 'node:crypto';
import {db,databaseProvider,type QueryClient} from './db';
import {matchingInput,matchingPlan,type MatchingPolicy} from './matching-policy';
import {isAllowedGenderComposition,MATCH_ENGINE_VERSION,isHardCompatible,groupScore,type MatchCandidate} from './matching';
import {sharedInterestKeywords} from './table-experience';
import {recommendVenues} from './venues';
import {parseJson,problem} from './operators';
import {provisionTable} from './lifecycle-service';
const json=JSON.stringify;
export async function createMatchingProposal(c:QueryClient,event:any,members:MatchCandidate[],policy:MatchingPolicy,runId:string,score:number,explanation:string,sourceTableId?:string){
 if(!isAllowedGenderComposition(members))problem('허용된 성비 조합으로 구성해 주세요.',409);
 let fingerprint=createHash('sha256').update(json({event:event.id,members:members.map(m=>m.applicationId).sort(),policy,sourceTableId})).digest('hex');
 const previous=(await c.query<any>('SELECT id,status FROM matching_proposals WHERE fingerprint=$1',[fingerprint])).rows[0];if(previous&&previous.status!=='STALE')return {id:previous.id,created:false,status:previous.status};
 if(previous)fingerprint=createHash('sha256').update(`${fingerprint}:${randomUUID()}`).digest('hex');
 const reserved=(await c.query<any>("SELECT pm.application_id FROM matching_proposal_members pm JOIN matching_proposals p ON p.id=pm.proposal_id WHERE p.status IN ('PENDING','HELD')")).rows;
 if(members.some(m=>reserved.some(r=>r.application_id===m.applicationId)))return null;
 const choices=await recommendVenues(c,event,members,{sourceTableId}),venue=choices.find(v=>v.eligible),id=randomUUID();
 await c.query(`INSERT INTO matching_proposals(id,event_id,match_run_id,source_table_id,fingerprint,policy_snapshot,candidates,keywords,explanation,venue_id,venue_reason,quality_score) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,event.id,runId,sourceTableId??null,fingerprint,json(policy),json(members),json(sharedInterestKeywords(members)),explanation,venue?.id??null,venue?venue.reasons.join(' · '):'지역·예산·정원을 만족하는 식당 확인이 필요합니다.',score]);
 for(const m of members){await c.query('INSERT INTO matching_proposal_members(proposal_id,application_id,user_id) VALUES($1,$2,$3)',[id,m.applicationId,m.userId]);if(!sourceTableId)await c.query("UPDATE applications SET matching_status='MATCHING',updated_at=now() WHERE id=$1",[m.applicationId]);}
 return {id,created:true,status:'PENDING'};
}
export async function generateMatchingProposals(eventId:string,seed='review-v1',connection?:QueryClient){
 const c=connection??await db.connect(),own=!connection;
 try{if(own)await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
 const input=await matchingInput(c,eventId,true);if(new Date(input.event.starts_at).getTime()<=Date.now()) {if(own)await c.query('COMMIT');return {runId:'',matchedCount:0,qualityScore:0,unmatched:[],groups:[],proposalIds:[],proposedCount:0};}
 const plan=matchingPlan(input),proposalIds:string[]=[],groups:string[][]=[];let runId='',qualityScore=0;
 for(const group of plan.groups){const event=input.events.find(e=>e.id===group.eventId)!;const id=randomUUID();
  await c.query('INSERT INTO match_runs(id,event_id,rule_version,seed,input_snapshot,status,matched_count,quality_score,completed_at) VALUES($1,$2,$3,$4,$5,\'COMPLETED\',0,$6,now())',[id,event.id,group.policy.id,seed,json({engineVersion:MATCH_ENGINE_VERSION,reviewRequired:false,policy:group.policy,candidates:group.members,inputHash:input.hash,search:plan.search}),group.score]);
  const proposal=await createMatchingProposal(c,event,group.members,group.policy,id,group.score,group.explanation);if(proposal?.created){runId=runId||id;proposalIds.push(proposal.id);groups.push(group.members.map(m=>m.applicationId));qualityScore+=group.score;}
 }
 if(own)await c.query('COMMIT');return {runId,matchedCount:0,proposedCount:groups.reduce((n,g)=>n+g.length,0),qualityScore,unmatched:plan.unmatched.map(m=>m.applicationId),groups,proposalIds};
 }catch(e){if(own)await c.query('ROLLBACK');throw e;}finally{if(own)c.release();}
}
async function validateGroup(c:QueryClient,p:any,event:any,members:MatchCandidate[],policy:MatchingPolicy){
 if(!['OPEN','CLOSED'].includes(event.status)||new Date(event.starts_at).getTime()<=Date.now())problem('이미 시작되거나 취소된 일정입니다. 다시 추천해 주세요.',409);
 if(members.length<4||members.length>6)problem('식탁은 4~6명으로 구성해야 합니다.',409);
 const rows=(await c.query<any>(`SELECT a.id,a.user_id,a.status application_status,p.status payment_status,u.restricted_status,pr.birth_year,pr.gender,pr.mbti,pr.interests,pr.traits,pr.desired_traits,pr.consent_privacy,pr.consent_operations FROM applications a JOIN payments p ON p.application_id=a.id JOIN users u ON u.id=a.user_id JOIN profiles pr ON pr.user_id=a.user_id`)).rows;
 const relations=(await c.query<any>("SELECT source_user_id,target_user_id FROM match_relationships WHERE active=true AND relationship_type IN ('BLOCK','DISLIKE','REPORT')")).rows;
 const seats=(await c.query<any>(`SELECT tm.user_id,tm.application_id,t.id table_id,e.starts_at,COALESCE(e.ends_at,e.starts_at+interval '2 hours') ends_at FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.status='ACTIVE'`,[],`SELECT tm.user_id,tm.application_id,t.id table_id,e.starts_at,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) ends_at FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.status='ACTIVE'`)).rows;
 const current:MatchCandidate[]=[];
 for(const m of members){const r=rows.find(r=>r.id===m.applicationId&&r.user_id===m.userId);if(!r||r.application_status!=='SUBMITTED'||r.payment_status!=='PAID'||r.restricted_status!=='ACTIVE'||!r.consent_privacy||!r.consent_operations)problem('참가·결제·동의 상태가 변경된 멤버가 있어요. 다시 추천해 주세요.',409);
  if(!(await c.query('SELECT 1 FROM application_options WHERE application_id=$1 AND event_id=$2',[m.applicationId,event.id])).rowCount)problem('참가자의 가능한 날짜나 지역이 변경됐어요.',409);
  if(seats.some(s=>s.table_id!==p.source_table_id&&(s.application_id===m.applicationId||(s.user_id===m.userId&&new Date(s.starts_at).getTime()<new Date(event.ends_at).getTime()&&new Date(event.starts_at).getTime()<new Date(s.ends_at).getTime()))))problem('이미 다른 식탁에 배정된 참가자가 있어요.',409);
  const candidate={...m,birthYear:Number(r.birth_year),gender:r.gender,mbti:r.mbti,interests:parseJson<string[]>(r.interests,[]),traits:parseJson<string[]>(r.traits,[]),desiredTraits:parseJson<string[]>(r.desired_traits,[]),blockedUserIds:relations.filter(x=>x.source_user_id===m.userId).map(x=>x.target_user_id)};
  if(!isHardCompatible(current,candidate,policy.minScore,policy.weights))problem('연령·만남 제외·궁합 조건이 변경됐어요. 다시 추천해 주세요.',409);current.push(candidate);
 }
 if(!isAllowedGenderComposition(current))problem('성비는 4명 2:2, 5명 2:3·3:2, 6명 2:4·3:3·4:2로 구성해야 합니다.',409);
 if(groupScore(current,policy.weights)<policy.minScore)problem('최소 매칭 기준을 만족하지 않습니다.',409);
 const occupied=(await c.query<any>("SELECT tm.user_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=$1 AND tm.status='ACTIVE' AND ($2::uuid IS NULL OR t.id<>$2)",[event.id,p.source_table_id])).rows.length;
 if(occupied+current.length>Number(event.capacity))problem('회차 정원이 변경됐어요.',409);
 if(p.source_table_id){const survivors=(await c.query<any>("SELECT application_id FROM table_members WHERE table_id=$1 AND status='ACTIVE'",[p.source_table_id])).rows;if(survivors.some(s=>!current.some(m=>m.applicationId===s.application_id)))problem('재배치 대상 멤버가 변경됐어요.',409);}
 return current;
}
async function applyMatchingDecision(actorId:string|null,id:string,b:any,connection?:QueryClient){
 if(!['APPROVE','HOLD','REJECT'].includes(b.action)||!Number.isInteger(b.version)||typeof(b.note??'')!=='string'||(b.note??'').length>1000)problem('검토 내용을 확인해 주세요.');
 const c=connection??await db.connect(),own=!connection;try{if(own)await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
 if(actorId){const actor=(await c.query<any>('SELECT active FROM operator_profiles WHERE user_id=$1 FOR UPDATE',[actorId])).rows[0];if(!actor?.active)problem('활성 운영자 권한이 필요합니다.',403);}
 const p=(await c.query<any>('SELECT * FROM matching_proposals WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!p)problem('검토할 매칭을 찾을 수 없어요.',404);
 const desired=({APPROVE:'APPROVED',HOLD:'HELD',REJECT:'REJECTED'} as any)[b.action];
 if(p.status===desired&&Number(p.version)===b.version+1){
  const decision=(await c.query<any>('SELECT actor_id,note FROM matching_decisions WHERE proposal_id=$1 AND from_version=$2',[id,b.version])).rows[0];
  if(decision?.actor_id!==actorId||decision.note!==(b.note??'')||(b.action==='APPROVE'&&b.venueId&&b.venueId!==p.venue_id))problem('이미 다른 내용으로 검토된 요청입니다.',409);
  if(own)await c.query('COMMIT');return {ok:true,status:p.status,tableId:p.confirmed_table_id,replayed:true};
 }
 if(Number(p.version)!==b.version||!['PENDING','HELD'].includes(p.status))problem('다른 운영자가 검토 내용을 변경했어요. 새로고침해 주세요.',409);
 let tableId=p.confirmed_table_id;
 if(b.action==='APPROVE'){
  const event=(await c.query<any>(`SELECT *,COALESCE(ends_at,starts_at+interval '2 hours') effective_ends_at FROM events WHERE id=$1 FOR UPDATE`,[p.event_id],`SELECT *,COALESCE(ends_at,datetime(starts_at,'+2 hours')) effective_ends_at FROM events WHERE id=$1`)).rows[0];event.ends_at=event.effective_ends_at;
  if(new Date(event.application_deadline).getTime()>Date.now())problem('매칭 마감 전에는 확정하지 않습니다.',409);
  const policy=parseJson<MatchingPolicy>(p.policy_snapshot,{} as any);const members=await validateGroup(c,p,event,parseJson<MatchCandidate[]>(p.candidates,[]),policy);
  const venues=await recommendVenues(c,event,members,{proposalId:id,sourceTableId:p.source_table_id}),venue=venues.find(v=>v.id===(b.venueId??p.venue_id));if(!venue?.eligible)problem('지역·예산·정원을 만족하는 식당을 선택해 주세요.',409);
  if(venue.requiresDietaryConfirmation&&b.dietaryConfirmed!==true)problem('음식·알레르기 요청을 식당에 확인한 뒤 체크해 주세요.');
  tableId=p.source_table_id??randomUUID();const next=(await c.query<any>('SELECT COALESCE(MAX(table_number),0)+1 n FROM dining_tables WHERE event_id=$1',[event.id])).rows[0];
  if(p.source_table_id){
   await c.query("UPDATE scheduled_jobs SET status='DONE',completed_at=now(),lease_owner=NULL,lease_until=NULL WHERE payload->>'tableId'=$1 AND status IN ('PENDING','RUNNING') AND job_type IN ('JOURNEY_REMINDER','JOURNEY_FEEDBACK_REQUEST','POST_CONTENT','CLOSE_ATTENDANCE','FEEDBACK_FOLLOWUP')",[tableId],"UPDATE scheduled_jobs SET status='DONE',completed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL WHERE json_extract(payload,'$.tableId')=$1 AND status IN ('PENDING','RUNNING') AND job_type IN ('JOURNEY_REMINDER','JOURNEY_FEEDBACK_REQUEST','POST_CONTENT','CLOSE_ATTENDANCE','FEEDBACK_FOLLOWUP')");
   await c.query('UPDATE attendance_records SET event_id=$2,updated_at=now() WHERE application_id IN (SELECT application_id FROM table_members WHERE table_id=$1) AND status=$3',[tableId,event.id,'SCHEDULED']);
   await c.query("UPDATE dining_tables SET event_id=$2,match_run_id=$3,table_number=$4,status='CONFIRMED',quality_score=$5,provision_status='PENDING' WHERE id=$1",[tableId,event.id,p.match_run_id,Number(next.n),p.quality_score]);
  }else await c.query("INSERT INTO dining_tables(id,event_id,match_run_id,table_number,status,quality_score) VALUES($1,$2,$3,$4,'CONFIRMED',$5)",[tableId,event.id,p.match_run_id,Number(next.n),p.quality_score]);
  await c.query('UPDATE match_runs SET input_snapshot=$2 WHERE id=$1',[p.match_run_id,json({...parseJson<any>((await c.query<any>('SELECT input_snapshot FROM match_runs WHERE id=$1',[p.match_run_id])).rows[0]?.input_snapshot,{}),policy,candidates:members,confirmedAt:new Date().toISOString()})]);
  for(const m of members){await c.query("INSERT INTO table_members(table_id,application_id,user_id,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(table_id,user_id) DO UPDATE SET application_id=excluded.application_id,status='ACTIVE'",[tableId,m.applicationId,m.userId]);await c.query("UPDATE applications SET matching_status='CONFIRMED',updated_at=now() WHERE id=$1",[m.applicationId]);await c.query('INSERT INTO match_explanations(id,match_run_id,application_id,table_id,kind,message,details) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),p.match_run_id,m.applicationId,tableId,p.source_table_id?'REPAIRED':'CONFIRMED',p.explanation,json({keywords:sharedInterestKeywords(members),approvedBy:actorId,automatic:!actorId,proposalId:id})]);}
  for(const m of members){const origin=(await c.query<any>('SELECT e.id,e.starts_at,e.area FROM application_options o JOIN events e ON e.id=o.event_id WHERE o.application_id=$1 ORDER BY e.starts_at,e.area,e.id LIMIT 1',[m.applicationId])).rows[0];await recordReallocation(c,{applicationId:m.applicationId,runId:p.match_run_id,sourceEventId:origin?.id,targetEventId:event.id,phase:p.source_table_id?'REPAIR':'INITIAL',status:'CONFIRMED',priority:origin?reallocationPriority(origin,event):0,reason:p.source_table_id?'TABLE_RECOVERY':origin?.id===event.id?'FIRST_OPTION':'ALTERNATE_SELECTED_OPTION',actorId:actorId??undefined});}
  for(const m of members)await c.query("UPDATE resolution_cases SET status='TRANSFERRED',version=version+1,selected_choice='TRANSFER',transferred_event_id=$2,result_payload=$3,updated_at=now() WHERE application_id=$1 AND status='OFFERED'",[m.applicationId,event.id,json({status:'TRANSFER',eventId:event.id,automatic:true})]);
  for(const m of members)for(const peer of members)if(m.userId!==peer.userId)await c.query('INSERT INTO match_history(id,table_id,user_id,other_user_id) VALUES($1,$2,$3,$4) ON CONFLICT(table_id,user_id,other_user_id) DO NOTHING',[randomUUID(),tableId,m.userId,peer.userId]);
  await c.query('UPDATE matching_proposals SET status=\'APPROVED\',venue_id=$2 WHERE id=$1',[id,venue.id]);
  await c.query('UPDATE dining_tables SET confirmation_source=$2 WHERE id=$1',[tableId,actorId?'OPERATOR':'AUTO']);
  await provisionTable(c,tableId,event.id,members,venue.id);
  await c.query('UPDATE match_runs SET matched_count=$2 WHERE id=$1',[p.match_run_id,members.length]);
 }else if(b.action==='REJECT'){
  for(const m of parseJson<MatchCandidate[]>(p.candidates,[]))await c.query("UPDATE applications SET matching_status='WAITING',updated_at=now() WHERE id=$1 AND matching_status='MATCHING'",[m.applicationId]);
 }
 await c.query('UPDATE matching_proposals SET status=$2,version=version+1,review_note=$3,reviewed_by=$4,reviewed_at=now(),confirmed_table_id=$5 WHERE id=$1',[id,desired,b.note??'',actorId,tableId]);
 if(actorId)await c.query('INSERT INTO matching_decisions(id,proposal_id,actor_id,action,note,from_version) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,actorId,b.action,b.note??'',b.version]);
 await c.query('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,$4,$5)',[actorId,actorId?`MATCHING_${b.action}`:'MATCHING_AUTO_CONFIRMED','matching_proposal',id,json({status:desired,tableId})]);
 if(own)await c.query('COMMIT');return {ok:true,status:desired,tableId};
 }catch(e){if(own)await c.query('ROLLBACK');throw e;}finally{if(own)c.release();}
}
export async function matchingReviewQueue(){
  const tables=(await db.query<any>(`SELECT t.id,t.table_number,t.status,t.venue_id,e.id event_id,e.title,e.area,e.starts_at,COALESCE(e.ends_at,e.starts_at+interval '2 hours') ends_at,v.name venue_name,(SELECT count(*) FROM table_members tm WHERE tm.table_id=t.id AND tm.status='ACTIVE') member_count FROM dining_tables t JOIN events e ON e.id=t.event_id LEFT JOIN venues v ON v.id=t.venue_id WHERE t.status='CONFIRMED' ORDER BY e.starts_at,t.table_number`,[],`SELECT t.id,t.table_number,t.status,t.venue_id,e.id event_id,e.title,e.area,e.starts_at,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) ends_at,v.name venue_name,(SELECT count(*) FROM table_members tm WHERE tm.table_id=t.id AND tm.status='ACTIVE') member_count FROM dining_tables t JOIN events e ON e.id=t.event_id LEFT JOIN venues v ON v.id=t.venue_id WHERE t.status='CONFIRMED' ORDER BY e.starts_at,t.table_number`)).rows;
  const confirmedMembers=(await db.query<any>(`SELECT tm.table_id,tm.user_id,p.display_name,p.mbti,p.interests FROM table_members tm JOIN profiles p ON p.user_id=tm.user_id WHERE tm.status='ACTIVE'`)).rows;
  for(const t of tables){t.members=confirmedMembers.filter(m=>m.table_id===t.id);t.keywords=sharedInterestKeywords(t.members);t.explanation=(await db.query<any>('SELECT message FROM match_explanations WHERE table_id=$1 ORDER BY created_at DESC LIMIT 1',[t.id])).rows[0]?.message??'공통 일정과 관심사를 살펴 준비한 식탁입니다.';}
  return {upcoming:tables.filter(t=>new Date(t.ends_at).getTime()>Date.now()),past:tables.filter(t=>new Date(t.ends_at).getTime()<=Date.now())};
}

export async function retireApplicationProposals(c:QueryClient,applicationId:string,reason:string){
 const changed=(await c.query<any>("UPDATE matching_proposals SET status='STALE',version=version+1,review_note=$2 WHERE status IN ('PENDING','HELD') AND id IN (SELECT proposal_id FROM matching_proposal_members WHERE application_id=$1) RETURNING id,event_id",[applicationId,reason])).rows;
 for(const p of changed){
  await c.query("UPDATE applications SET matching_status='WAITING',updated_at=now() WHERE status='SUBMITTED' AND matching_status='MATCHING' AND id IN (SELECT application_id FROM matching_proposal_members WHERE proposal_id=$1)",[p.id]);
  await c.query("INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'MATCH_EVENT',$2,now()) ON CONFLICT(job_key) DO NOTHING",[`retired-proposal:${p.id}`,json({eventId:p.event_id})]);
 }
}

export async function decideMatchingProposal(actorId:string,id:string,b:any){
 if(!actorId)problem('운영자 권한이 필요합니다.',403);
 return applyMatchingDecision(actorId,id,b);
}
export async function automaticallyConfirmProposal(c:QueryClient,id:string){
 const p=(await c.query<any>('SELECT * FROM matching_proposals WHERE id=$1',[id])).rows[0];
 if(!p)problem('자동 확정 대상을 찾을 수 없습니다.',404);
 if(p.status==='APPROVED')return {ok:true,status:p.status,tableId:p.confirmed_table_id,replayed:true};
 // Refresh the venue choice on every retry: newly added venues can unblock a table.
 const event=(await c.query<any>("SELECT *,COALESCE(ends_at,starts_at+interval '2 hours') effective_ends_at FROM events WHERE id=$1",[p.event_id],"SELECT *,COALESCE(ends_at,datetime(starts_at,'+2 hours')) effective_ends_at FROM events WHERE id=$1")).rows[0];
 if(!event)problem('매칭 일정을 찾을 수 없습니다.',409);
 event.ends_at=event.effective_ends_at;
 const members=parseJson<MatchCandidate[]>(p.candidates,[]);
 await validateGroup(c,p,event,members,parseJson<MatchingPolicy>(p.policy_snapshot,{} as MatchingPolicy));
 const choices=await recommendVenues(c,event,members,{proposalId:id,sourceTableId:p.source_table_id});
 const preferred=choices.find(v=>v.id===p.venue_id&&v.eligible),venue=preferred??choices.find(v=>v.eligible&&!v.requiresDietaryConfirmation)??choices.find(v=>v.eligible);
 if(!venue)problem('지역·예산·정원을 만족하는 식당을 선택해 주세요.',409);
 const dietaryConfirmed=Boolean(p.dietary_verified)&&venue.id===p.venue_id;
 return applyMatchingDecision(null,id,{action:'APPROVE',version:Number(p.version),venueId:venue.id,dietaryConfirmed,note:'마감 후 필수 조건 검증을 통과하여 자동 확정했습니다.'},c);
}
