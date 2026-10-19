import {alternativeEvents,recordReallocation} from './reallocation';
import {randomUUID} from 'node:crypto';
import {db,databaseProvider,type QueryClient} from './db';
import {generateMatchingProposals,automaticallyConfirmProposal} from './matching-review';

/** The worker calls this at cutoff; normal tables never require an operator approval. */
export async function runAutomaticMatching(eventId:string,seed='automatic-v2',connection?:QueryClient){
 const c=connection??await db.connect(),own=!connection;
 const empty={runId:'',matchedCount:0,qualityScore:0,unmatched:[] as string[],groups:[] as string[][],proposalIds:[] as string[],proposedCount:0,needsBooking:0};
 try{
  if(own)await c.query('BEGIN');
  if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
  const event=(await c.query<any>('SELECT id,status,starts_at,application_deadline FROM events WHERE id=$1',[eventId])).rows[0];
  if(!event)throw new Error('매칭할 일정을 찾을 수 없습니다.');
  if(!['OPEN','CLOSED'].includes(event.status)||new Date(event.application_deadline).getTime()>Date.now()||new Date(event.starts_at).getTime()<=Date.now()){if(own)await c.query('COMMIT');return empty;}
  let matched=0,needsBooking=0;
  const settle=async(id:string)=>{
   await c.query('SAVEPOINT automatic_table');
   try{const result=await automaticallyConfirmProposal(c,id);const count=(await c.query<any>("SELECT count(*) n FROM table_members WHERE table_id=$1 AND status='ACTIVE'",[result.tableId])).rows[0];matched+=Number(count.n);await c.query('RELEASE SAVEPOINT automatic_table');}
   catch(error){
    await c.query('ROLLBACK TO SAVEPOINT automatic_table');await c.query('RELEASE SAVEPOINT automatic_table');
    if(!error||typeof error!=='object'||!('status' in error)||![400,409].includes(Number(error.status)))throw error;
    const reason=error instanceof Error?error.message:'식당 배정 조건을 확인해 주세요.';
    const venueIssue=/식당|음식|알레르기/.test(reason);
    await c.query("UPDATE matching_proposals SET status=$3,version=version+1,review_note=$2,reviewed_by=NULL WHERE id=$1 AND status IN ('PENDING','HELD')",[id,reason,venueIssue?'HELD':'STALE']);
    if(!venueIssue)await c.query("UPDATE applications SET matching_status='WAITING',updated_at=now() WHERE status='SUBMITTED' AND matching_status='MATCHING' AND id IN (SELECT application_id FROM matching_proposal_members WHERE proposal_id=$1)",[id]);
    await c.query("INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES($3,'matching_proposal',$1,$2)",[id,JSON.stringify({reason}),venueIssue?'AUTO_MATCH_NEEDS_VENUE':'AUTO_MATCH_REVALIDATION']);
    if(venueIssue)needsBooking++;
   }
  };
  const pending=(await c.query<any>("SELECT p.id FROM matching_proposals p WHERE p.event_id=$1 AND (p.status='PENDING' OR (p.status='HELD' AND p.reviewed_by IS NULL))",[eventId])).rows;
  for(const p of pending)await settle(p.id);
  const generated=await generateMatchingProposals(eventId,seed,c);
  for(const id of generated.proposalIds)await settle(id);
  let runId=generated.runId;
  const unresolved:string[]=[];
  for(const appId of generated.unmatched){
   // A registration with another future cutoff keeps waiting for that selected option.
   const future=(await c.query("SELECT 1 FROM application_options o JOIN events e ON e.id=o.event_id WHERE o.application_id=$1 AND e.status IN ('OPEN','CLOSED') AND e.application_deadline>now() LIMIT 1",[appId])).rowCount;
   if(future)continue;
   if(!runId){runId=randomUUID();await c.query("INSERT INTO match_runs(id,event_id,rule_version,seed,input_snapshot,status,matched_count,completed_at) VALUES($1,$2,'automatic-v2',$3,$4,'COMPLETED',0,now())",[runId,eventId,seed,JSON.stringify({automatic:true,reviewRequired:false,unmatched:generated.unmatched})]);}
   const alternatives=await alternativeEvents(c,appId);
   const reason='선택한 일정과 지역 안에서 인원·연령·만남 제외 조건을 모두 만족하는 식탁을 찾지 못했어요. 다른 날짜를 고르거나 참가권을 보관할 수 있어요.';
   await recordReallocation(c,{applicationId:appId,runId,sourceEventId:eventId,phase:'INITIAL',status:'FAILED',reason:'NO_COMPATIBLE_GROUP'});
   await c.query("UPDATE applications SET matching_status='ALTERNATIVE_OFFERED',updated_at=now() WHERE id=$1 AND status='SUBMITTED'",[appId]);
   await c.query("INSERT INTO resolution_cases(id,application_id,status,version,reason,alternatives) VALUES($1,$2,'OFFERED',0,$3,$4) ON CONFLICT(application_id) DO UPDATE SET status='OFFERED',version=resolution_cases.version+1,selected_choice=NULL,result_payload='{}',reason=excluded.reason,alternatives=excluded.alternatives,updated_at=now()",[randomUUID(),appId,reason,JSON.stringify(alternatives)]);
   await c.query("INSERT INTO match_explanations(id,match_run_id,application_id,kind,message,details) VALUES($1,$2,$3,'ALTERNATIVE_OFFERED',$4,$5)",[randomUUID(),runId,appId,reason,JSON.stringify({automatic:true,alternatives})]);
   const user=(await c.query<any>('SELECT user_id FROM applications WHERE id=$1',[appId])).rows[0];
   await c.query("INSERT INTO notifications(recipient_user_id,event_id,message,sent_by,action_url) VALUES($1,$2,$3,$1,$4)",[user.user_id,eventId,'이번 일정에는 어울리는 식탁을 준비하지 못했어요. 다음 만남 선택지를 확인해 주세요.',`/applications/${appId}`]);unresolved.push(appId);
  }
  if(own)await c.query('COMMIT');
  return {...generated,runId,matchedCount:matched,unmatched:unresolved,needsBooking};
 }catch(e){if(own)await c.query('ROLLBACK');throw e;}finally{if(own)c.release();}
}
