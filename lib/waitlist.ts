import {randomUUID} from 'node:crypto';
import {db,databaseProvider,type QueryClient} from './db';
import {parseJson,problem} from './operators';
import {isAllowedGenderComposition,isHardCompatible,type MatchCandidate,groupScore} from './matching';
import {effectivePolicy,explainGroup} from './matching-policy';
import {createMatchingProposal,automaticallyConfirmProposal} from './matching-review';
import {recommendVenues} from './venues';
async function eventFor(c:QueryClient,tableId:string){return (await c.query<any>("SELECT e.*,COALESCE(e.ends_at,e.starts_at+interval '2 hours') effective_end,t.status table_status FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE t.id=$1",[tableId],"SELECT e.*,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) effective_end,t.status table_status FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE t.id=$1")).rows[0];}
async function candidate(c:QueryClient,applicationId:string):Promise<MatchCandidate|null>{
 const r=(await c.query<any>(`SELECT a.id,a.user_id,p.birth_year,p.gender,p.mbti,p.interests,p.traits,p.desired_traits FROM applications a JOIN users u ON u.id=a.user_id JOIN payments pay ON pay.application_id=a.id JOIN profiles p ON p.user_id=a.user_id WHERE a.id=$1 AND a.status='SUBMITTED' AND pay.status='PAID' AND u.restricted_status='ACTIVE' AND p.consent_privacy AND p.consent_operations`,[applicationId])).rows[0];if(!r)return null;
 const relations=(await c.query<any>("SELECT source_user_id,target_user_id FROM match_relationships WHERE active=true AND relationship_type IN ('BLOCK','DISLIKE','REPORT') AND (source_user_id=$1 OR target_user_id=$1)",[r.user_id])).rows;
 return {applicationId:r.id,userId:r.user_id,birthYear:Number(r.birth_year),gender:r.gender,mbti:r.mbti,interests:parseJson(r.interests,[]),traits:parseJson(r.traits,[]),desiredTraits:parseJson(r.desired_traits,[]),eventIds:[],paid:true,valid:true,blockedUserIds:relations.map(x=>x.source_user_id===r.user_id?x.target_user_id:x.source_user_id)};
}
async function eligible(c:QueryClient,tableId:string,applicationId:string){
 const e=await eventFor(c,tableId);if(!e||!['CONFIRMED','EXCEPTION'].includes(e.table_status)||new Date(e.starts_at).getTime()-Date.now()<30*60000)return null;e.ends_at=e.effective_end;
 if(!(await c.query('SELECT 1 FROM application_options WHERE application_id=$1 AND event_id=$2',[applicationId,e.id])).rowCount)return null;
 const applicant=await candidate(c,applicationId);if(!applicant)return null;applicant.eventIds=[e.id];
 if((await c.query("SELECT 1 FROM matching_proposal_members pm JOIN matching_proposals p ON p.id=pm.proposal_id WHERE pm.application_id=$1 AND p.status IN ('PENDING','HELD')",[applicationId])).rowCount)return null;
 const conflict=await c.query("SELECT 1 FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.user_id=$1 AND tm.status='ACTIVE' AND (tm.application_id=$2 OR (e.starts_at<$3 AND coalesce(e.ends_at,e.starts_at+interval '2 hours')>$4))",[applicant.userId,applicationId,e.ends_at,e.starts_at],"SELECT 1 FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.user_id=$1 AND tm.status='ACTIVE' AND (tm.application_id=$2 OR (e.starts_at<$3 AND coalesce(e.ends_at,datetime(e.starts_at,'+2 hours'))>$4))");if(conflict.rowCount)return null;
 const active=(await c.query<any>("SELECT application_id FROM table_members WHERE table_id=$1 AND status='ACTIVE' ORDER BY application_id",[tableId])).rows;
 if(active.length<3||active.length>=6)return null;
 const members:MatchCandidate[]=[];for(const row of active){const m=await candidate(c,row.application_id);if(!m)return null;members.push({...m,eventIds:[e.id]});}
 const policy=await effectivePolicy(c,e.id);if(!isHardCompatible(members,applicant,policy.minScore,policy.weights))return null;
 members.push({...applicant,eventIds:[e.id]});
 if(!isAllowedGenderComposition(members)||groupScore(members,policy.weights)<policy.minScore)return null;
 const venues=await recommendVenues(c,e,members,{sourceTableId:tableId});if(!venues.some(v=>v.eligible&&!v.requiresDietaryConfirmation))return null;
 return {event:e,members,policy};
}
/** One timed invitation per vacant table; expired or declined candidates are skipped. */
export async function offerVacantSeats(c:QueryClient){
 await c.query("UPDATE waitlist_offers SET status='EXPIRED',responded_at=now() WHERE status='OFFERED' AND expires_at<=now()");
 const tables=(await c.query<any>(`SELECT t.id,e.starts_at FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE t.status IN ('CONFIRMED','EXCEPTION') AND e.starts_at>now() AND e.application_deadline<=now() AND NOT EXISTS(SELECT 1 FROM waitlist_offers w WHERE w.table_id=t.id AND w.status='OFFERED')`,[],`SELECT t.id,e.starts_at FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE t.status IN ('CONFIRMED','EXCEPTION') AND e.starts_at>CURRENT_TIMESTAMP AND e.application_deadline<=CURRENT_TIMESTAMP AND NOT EXISTS(SELECT 1 FROM waitlist_offers w WHERE w.table_id=t.id AND w.status='OFFERED')`)).rows;
 let offered=0;
 for(const t of tables){const apps=(await c.query<any>(`SELECT a.id,a.user_id FROM applications a JOIN application_options o ON o.application_id=a.id JOIN dining_tables t ON t.event_id=o.event_id WHERE t.id=$1 AND a.status='SUBMITTED' AND a.matching_status IN ('WAITING','ALTERNATIVE_OFFERED','REALLOCATING') AND NOT EXISTS(SELECT 1 FROM waitlist_offers w WHERE w.application_id=a.id AND (w.table_id=$1 OR w.status='OFFERED')) ORDER BY a.created_at,a.id`,[t.id])).rows;
  for(const a of apps){const fit=await eligible(c,t.id,a.id);if(!fit)continue;const expiry=new Date(Math.min(Date.now()+2*3600000,new Date(t.starts_at).getTime()-30*60000));if(expiry.getTime()<=Date.now())continue;
   const id=randomUUID();await c.query('INSERT INTO waitlist_offers(id,table_id,application_id,expires_at) VALUES($1,$2,$3,$4)',[id,t.id,a.id,expiry]);
   await c.query("INSERT INTO notifications(recipient_user_id,event_id,message,sent_by,action_url) VALUES($1,$2,$3,$1,'/applications')",[a.user_id,fit.event.id,'선택한 일정에 빈자리가 생겼어요. 응답 기한 안에 참가 여부를 알려주세요.']);offered++;break;
  }
 }
 return offered;
}
export async function participantOffers(userId:string){return (await db.query<any>(`SELECT w.id,w.expires_at,w.status,e.title,e.starts_at,e.area,v.name venue_name FROM waitlist_offers w JOIN applications a ON a.id=w.application_id JOIN dining_tables t ON t.id=w.table_id JOIN events e ON e.id=t.event_id LEFT JOIN venues v ON v.id=t.venue_id WHERE a.user_id=$1 AND w.status='OFFERED' AND w.expires_at>now() ORDER BY w.expires_at`,[userId])).rows;}
export async function respondToOffer(userId:string,id:string,accept:boolean){const c=await db.connect();try{
 await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
 const w=(await c.query<any>('SELECT w.* FROM waitlist_offers w JOIN applications a ON a.id=w.application_id WHERE w.id=$1 AND a.user_id=$2 FOR UPDATE OF w',[id,userId],'SELECT w.* FROM waitlist_offers w JOIN applications a ON a.id=w.application_id WHERE w.id=$1 AND a.user_id=$2')).rows[0];if(!w)problem('참가 제안을 찾을 수 없어요.',404);
 if(w.status===(accept?'ACCEPTED':'DECLINED')){await c.query('COMMIT');return {ok:true,status:w.status,replayed:true};}
 if(w.status!=='OFFERED'||new Date(w.expires_at).getTime()<=Date.now())problem('응답 기한이 지났거나 이미 처리된 제안입니다.',409);
 if(!accept){await c.query("UPDATE waitlist_offers SET status='DECLINED',responded_at=now() WHERE id=$1",[id]);await offerVacantSeats(c);await c.query('COMMIT');return {ok:true,status:'DECLINED'};}
 const fit=await eligible(c,w.table_id,w.application_id);if(!fit){await c.query("UPDATE waitlist_offers SET status='UNAVAILABLE',responded_at=now() WHERE id=$1",[id]);await offerVacantSeats(c);await c.query('COMMIT');return {ok:false,status:'UNAVAILABLE'};}
 const run=randomUUID();await c.query("INSERT INTO match_runs(id,event_id,rule_version,seed,input_snapshot,status,completed_at) VALUES($1,$2,$3,'waitlist-v1',$4,'COMPLETED',now())",[run,fit.event.id,fit.policy.id,JSON.stringify({waitlistOfferId:id,policy:fit.policy,candidates:fit.members})]);
 // Keep the existing table and all its participants; revalidate every constraint at confirmation.
 const proposal=await createMatchingProposal(c,fit.event,fit.members,fit.policy,run,groupScore(fit.members,fit.policy.weights),explainGroup(fit.members,fit.policy),w.table_id);
 if(!proposal)problem('다른 배정이 진행 중입니다. 새로고침해 주세요.',409);
 await automaticallyConfirmProposal(c,proposal.id);
 await c.query("UPDATE resolution_cases SET status='TRANSFERRED',version=version+1,selected_choice='TRANSFER',transferred_event_id=$2,result_payload=$3,updated_at=now() WHERE application_id=$1 AND status='OFFERED'",[w.application_id,fit.event.id,JSON.stringify({status:'TRANSFER',eventId:fit.event.id})]);
 await c.query("UPDATE waitlist_offers SET status='ACCEPTED',responded_at=now() WHERE id=$1",[id]);
 await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'WAITLIST_ACCEPTED','dining_table',$2,$3)",[userId,w.table_id,JSON.stringify({offerId:id,applicationId:w.application_id})]);
 await c.query('COMMIT');return {ok:true,status:'ACCEPTED',tableId:w.table_id};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
