import {randomUUID} from 'node:crypto';
import {db,databaseProvider} from './db';
import {REGIONS,isCanonicalUuid} from './domain';
import {submitApplication} from './application-service';
import {parseJson,problem} from './operators';

export function availabilityDays(now=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const start=new Date(`${today}T00:00:00+09:00`).getTime();
 return Array.from({length:60},(_,i)=>new Date(start+(i+1)*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}));
}
export function validateAvailability(body:any){
 if(!body||typeof body!=='object'||Array.isArray(body))problem('가능한 날과 지역을 확인해 주세요.');
 const available=new Set(availabilityDays());
 if(!Array.isArray(body.dates)||body.dates.length<1||body.dates.length>8||body.dates.some((d:unknown)=>typeof d!=='string'||!available.has(d))||new Set(body.dates).size!==body.dates.length)problem('내일부터 60일 이내의 가능한 날을 1~8개 선택해 주세요.');
 if(!Array.isArray(body.areas)||body.areas.length<1||body.areas.some((a:any)=>!REGIONS.includes(a))||new Set(body.areas).size!==body.areas.length)problem('가능한 지역을 선택해 주세요.');
 if(!isCanonicalUuid(body.requestKey))problem('요청 키를 확인해 주세요.');
 return {dates:[...body.dates].sort() as string[],areas:[...body.areas].sort() as string[]};
}
export async function registerAvailability(userId:string,body:any){
 const selected=validateAvailability(body),c=await db.connect();
 try{
  await c.query('BEGIN');
  if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
  const previous=(await c.query<any>('SELECT * FROM availability_registrations WHERE request_key=$1',[body.requestKey])).rows[0];
  if(previous){
   const app=(await c.query<any>('SELECT pass_choice FROM applications WHERE id=$1',[previous.application_id])).rows[0];
   if(previous.user_id!==userId||JSON.stringify(parseJson(previous.dates,[]))!==JSON.stringify(selected.dates)||JSON.stringify(parseJson(previous.areas,[]))!==JSON.stringify(selected.areas)||app?.pass_choice!==body.pass)problem('이미 다른 내용으로 저장된 요청입니다.',409);
   await c.query('COMMIT');return {id:previous.id,created:false};
  }
  const operator=(await c.query<any>('SELECT user_id FROM operator_profiles WHERE active=true ORDER BY created_at,user_id LIMIT 1')).rows[0];
  if(!operator)problem('현재 가능한 날을 등록할 수 없어요. 문의함으로 알려주세요.',503);
  const eventIds:string[]=[];
  for(const day of selected.dates)for(const area of selected.areas){
   let slot=(await c.query<any>('SELECT event_id FROM availability_slots WHERE day=$1 AND area=$2',[day,area])).rows[0];
   if(!slot){
    const start=new Date(`${day}T19:30:00+09:00`),deadline=new Date(start.getTime()-7200000),end=new Date(start.getTime()+7200000),eventId=randomUUID();
    await c.query("INSERT INTO events(id,title,starts_at,ends_at,application_deadline,area,capacity,price_cents,status,created_by) VALUES($1,$2,$3,$4,$5,$6,120,8000,'OPEN',$7)",[eventId,`${area}의 저녁`,start,end,deadline,area,operator.user_id]);
    await c.query('INSERT INTO availability_slots(id,day,area,event_id) VALUES($1,$2,$3,$4)',[`${day}:${area}`,day,area,eventId]);slot={event_id:eventId};
   }
   eventIds.push(slot.event_id);
  }
  let application;
  try{application=await submitApplication(userId,{eventIds,pass:body.pass,requestKey:body.requestKey},c);}catch(e){problem(e instanceof Error?e.message:'가능한 날을 저장하지 못했어요.');}
  const id=randomUUID();
  await c.query('INSERT INTO availability_registrations(id,user_id,application_id,dates,areas,request_key) VALUES($1,$2,$3,$4,$5,$6)',[id,userId,application.id,JSON.stringify(selected.dates),JSON.stringify(selected.areas),body.requestKey]);
  // Each registration retries matching immediately; an old completed event job cannot hide later arrivals.
  for(const eventId of eventIds)await c.query("INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'MATCH_EVENT',$2,now()) ON CONFLICT(job_key) DO NOTHING",[`availability-match:${id}:${eventId}`,JSON.stringify({eventId})]);
  await c.query('COMMIT');return {id,created:true};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function participantAvailability(userId:string){
 const rows=(await db.query<any>(`SELECT r.id,r.application_id,r.dates,r.areas,r.created_at,a.matching_status,a.status FROM availability_registrations r JOIN applications a ON a.id=r.application_id WHERE r.user_id=$1 AND r.status='ACTIVE' AND a.status='SUBMITTED' AND a.matching_status<>'CONFIRMED' ORDER BY r.created_at DESC`,[userId])).rows;
 return rows.map(r=>({...r,dates:parseJson<string[]>(r.dates,[]),areas:parseJson<string[]>(r.areas,[])})).filter(r=>r.dates.some((d:string)=>new Date(`${d}T21:30:00+09:00`).getTime()>Date.now()));
}
