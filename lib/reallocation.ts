import {randomUUID} from 'node:crypto';
import type {QueryClient} from './db';
import {parseJson} from './operators';
import {nextEvents} from './next-events';
import {recommendVenues} from './venues';
export function reallocationPriority(origin:any,target:any){
 const day=(e:any)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.starts_at));
 return Number(day(origin)!==day(target))*2+Number(origin.area!==target.area);
}
/** Shared by recommendations and the transactional transfer gate. */
export async function eligibleAlternative(c:Pick<QueryClient,'query'>,applicationId:string,eventId:string){
 const app=(await c.query<any>("SELECT a.user_id,p.dietary_notes FROM applications a JOIN profiles p ON p.user_id=a.user_id JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND u.restricted_status='ACTIVE' AND p.consent_privacy=true AND p.consent_operations=true",[applicationId])).rows[0];
 const event=(await c.query<any>("SELECT *,COALESCE(ends_at,starts_at+interval '2 hours') effective_end FROM events WHERE id=$1 AND status='OPEN' AND starts_at>now() AND application_deadline>now()",[eventId],"SELECT *,COALESCE(ends_at,datetime(starts_at,'+2 hours')) effective_end FROM events WHERE id=$1 AND status='OPEN' AND starts_at>CURRENT_TIMESTAMP AND application_deadline>CURRENT_TIMESTAMP")).rows[0];
 if(!app||!event)return null;event.ends_at=event.effective_end;
 const occupied=(await c.query<any>("SELECT tm.user_id,tm.application_id,e.starts_at,COALESCE(e.ends_at,e.starts_at+interval '2 hours') ends_at,t.event_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.status='ACTIVE'",[],"SELECT tm.user_id,tm.application_id,e.starts_at,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) ends_at,t.event_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.status='ACTIVE'")).rows;
 if(occupied.filter(s=>s.event_id===eventId).length>=Number(event.capacity)||occupied.some(s=>s.user_id===app.user_id&&+new Date(s.starts_at)<+new Date(event.ends_at)&&+new Date(event.starts_at)<+new Date(s.ends_at)))return null;
 const venues=await recommendVenues(c,event,[{userId:app.user_id,interests:[]}]);
 if(!venues.some(v=>v.eligible))return null;
 return event;
}
export async function alternativeEvents(c:Pick<QueryClient,'query'>,applicationId:string){
 const app=(await c.query<any>('SELECT user_id FROM applications WHERE id=$1',[applicationId])).rows[0];if(!app)return [];
 const suggestions=await nextEvents(app.user_id,12,c),result:any[]=[];
 for(const candidate of suggestions){const event=await eligibleAlternative(c,applicationId,candidate.id);if(event)result.push({...candidate,event_id:event.id});}
 return result;
}
export async function recordReallocation(c:Pick<QueryClient,'query'>,args:{applicationId:string;runId?:string;sourceEventId?:string;targetEventId?:string;phase:'INITIAL'|'REPAIR';status:'SEARCHING'|'CONFIRMED'|'FAILED';priority?:number;reason:string;actorId?:string}){
 await c.query('INSERT INTO reallocation_events(id,application_id,run_id,source_event_id,target_event_id,phase,status,priority,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),args.applicationId,args.runId??null,args.sourceEventId??null,args.targetEventId??null,args.phase,args.status,args.priority??null,args.reason,args.actorId??null]);
}
