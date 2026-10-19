import {randomUUID} from 'node:crypto';
import type {QueryClient} from './db';
import {matchingInput,explainGroup} from './matching-policy';
import {globalMatching} from './global-matching';
import {createMatchingProposal,automaticallyConfirmProposal} from './matching-review';
import {parseJson} from './operators';
import {recordReallocation} from './reallocation';
import type {MatchCandidate} from './matching';
/** Atomically combine or split underfilled tables after every outstanding invitation is settled. */
export async function recoverUnderfilledTables(c:QueryClient,tableId:string){
 const target=(await c.query<any>('SELECT event_id FROM dining_tables WHERE id=$1',[tableId])).rows[0];if(!target)return null;
 const input=await matchingInput(c,target.event_id,true);
 const tables=(await c.query<any>("SELECT t.id,t.event_id,count(tm.application_id) n FROM dining_tables t JOIN events e ON e.id=t.event_id LEFT JOIN table_members tm ON tm.table_id=t.id AND tm.status='ACTIVE' WHERE t.status IN ('CONFIRMED','EXCEPTION') AND e.starts_at>now() GROUP BY t.id HAVING count(tm.application_id)>0 AND count(tm.application_id)<4 ORDER BY t.id")).rows.filter(t=>input.events.some(e=>e.id===t.event_id));
 if(!tables.some(t=>t.id===tableId)||tables.length<2)return null;
 const offers=(await c.query<any>("SELECT table_id FROM waitlist_offers WHERE status='OFFERED' AND expires_at>now()")).rows;if(tables.some(t=>offers.some(o=>o.table_id===t.id)))return null;
 const ids=new Set(tables.map(t=>t.id));
 const rows=(await c.query<any>("SELECT tm.table_id,a.id application_id,a.user_id,p.birth_year,p.gender,p.mbti,p.interests,p.traits,p.desired_traits FROM table_members tm JOIN applications a ON a.id=tm.application_id JOIN profiles p ON p.user_id=a.user_id JOIN users u ON u.id=a.user_id JOIN payments pay ON pay.application_id=a.id WHERE tm.status='ACTIVE' AND a.status='SUBMITTED' AND pay.status='PAID' AND u.restricted_status='ACTIVE' AND p.consent_privacy=true AND p.consent_operations=true")).rows.filter(r=>ids.has(r.table_id));
 const options=(await c.query<any>('SELECT application_id,event_id FROM application_options')).rows;
 const relations=(await c.query<any>("SELECT source_user_id,target_user_id FROM match_relationships WHERE active=true AND relationship_type IN ('BLOCK','DISLIKE','REPORT')")).rows;
 const survivors:MatchCandidate[]=rows.map(r=>({applicationId:r.application_id,userId:r.user_id,birthYear:Number(r.birth_year),gender:r.gender,mbti:r.mbti,interests:parseJson(r.interests,[]),traits:parseJson(r.traits,[]),desiredTraits:parseJson(r.desired_traits,[]),eventIds:options.filter(o=>o.application_id===r.application_id).map(o=>o.event_id),paid:true,valid:true,blockedUserIds:relations.filter(x=>x.source_user_id===r.user_id).map(x=>x.target_user_id)}));
 if(survivors.length!==tables.reduce((n,t)=>n+Number(t.n),0))return null;
 const apps=new Set(survivors.map(s=>s.applicationId));
 const seated=input.seated.filter(s=>!apps.has(s.application_id));
 const plan=globalMatching({...input,seated,candidates:[...survivors,...input.candidates]});
 if(plan.unmatched.some(m=>apps.has(m.applicationId))||!plan.groups.length)return null;
 await c.query('SAVEPOINT recover_tables');
 try{
  for(const table of tables){await c.query("UPDATE table_members SET status='REMOVED' WHERE table_id=$1 AND status='ACTIVE'",[table.id]);await c.query("UPDATE dining_tables SET status='CANCELLED' WHERE id=$1",[table.id]);await c.query("UPDATE table_reservations SET status='CANCELLED' WHERE table_id=$1",[table.id]);}
  let index=0;
  for(const group of plan.groups){
   const event=input.events.find(e=>e.id===group.eventId)!,runId=randomUUID();
   await c.query("INSERT INTO match_runs(id,event_id,rule_version,seed,input_snapshot,status,completed_at) VALUES($1,$2,$3,'recovery-v1',$4,'COMPLETED',now())",[runId,event.id,group.policy.id,JSON.stringify({policy:group.policy,candidates:group.members,sourceTables:tables.map(t=>t.id),search:plan.search})]);
   const proposal=await createMatchingProposal(c,event,group.members,group.policy,runId,group.score,explainGroup(group.members,group.policy),tables[index++]?.id);
   if(!proposal)throw Object.assign(new Error('복구 중 다른 배정이 진행됐어요.'),{status:409});
   await automaticallyConfirmProposal(c,proposal.id);
   for(const member of group.members)await recordReallocation(c,{applicationId:member.applicationId,runId,sourceEventId:tables.find(t=>rows.some(r=>r.application_id===member.applicationId&&r.table_id===t.id))?.event_id,targetEventId:event.id,phase:'REPAIR',status:'CONFIRMED',reason:'UNDERFILLED_TABLE_RECOVERY'});
  }
  for(const table of tables)await c.query("UPDATE lifecycle_exceptions SET status='RESOLVED',resolved_at=now() WHERE source='repair_table' AND entity_id=$1 AND status<>'RESOLVED'",[table.id]);
  await c.query('RELEASE SAVEPOINT recover_tables');return {status:'REPAIRED',tableId};
 }catch(error){await c.query('ROLLBACK TO SAVEPOINT recover_tables');await c.query('RELEASE SAVEPOINT recover_tables');if(Number((error as any)?.status)===400||Number((error as any)?.status)===409)return null;throw error;}
}
