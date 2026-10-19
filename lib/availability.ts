import {activeShowcase} from './showcase';
import {checkoutGate} from './checkout';
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
 if(!Array.isArray(body.dates)||body.dates.length<1||body.dates.length>8||body.dates.some((d:unknown)=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(+new Date(`${d}T00:00:00Z`))||new Date(`${d}T00:00:00Z`).toISOString().slice(0,10)!==d)||new Set(body.dates).size!==body.dates.length)problem('모집 중인 날짜를 1~8개 선택해 주세요.');
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
  if(body.checkoutId)await checkoutGate(c,userId,body.checkoutId,{...selected,pass:body.pass});
  const open=await recruitingEvents(c);
  const matching=open.filter(e=>selected.dates.includes(e.day)&&selected.areas.includes(e.area));
  if(selected.dates.some(day=>!matching.some(e=>e.day===day))||selected.areas.some(area=>!matching.some(e=>e.area===area)))problem('선택한 날짜와 지역에 모집 중인 회차가 없어요. 일정을 다시 확인해 주세요.',409);
  const eventIds=matching.map(e=>e.id);
  if(eventIds.length>32)problem('선택한 회차가 너무 많아요. 날짜나 지역을 줄여 주세요.');
  let application;
  try{application=await submitApplication(userId,{eventIds,pass:body.pass,requestKey:body.requestKey,checkoutOutcome:body.checkoutOutcome},c);}catch(e){problem(e instanceof Error?e.message:'가능한 날을 저장하지 못했어요.');}
  if(body.checkoutId)await c.query('UPDATE checkout_sessions SET status=$2,application_id=$3,updated_at=now() WHERE id=$1',[body.checkoutId,application.id?'COMPLETED':application.payment,application.id||null]);
  if(!application.id){await c.query('COMMIT');return {id:'',payment:application.payment,created:application.created};}
  const id=randomUUID();
  await c.query('INSERT INTO availability_registrations(id,user_id,application_id,dates,areas,request_key) VALUES($1,$2,$3,$4,$5,$6)',[id,userId,application.id,JSON.stringify(selected.dates),JSON.stringify(selected.areas),body.requestKey]);
  // Each registration retries matching immediately; an old completed event job cannot hide later arrivals.
  for(const event of matching)await c.query("INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'MATCH_EVENT',$2,$3) ON CONFLICT(job_key) DO NOTHING",[`availability-match:${id}:${event.id}`,JSON.stringify({eventId:event.id}),event.application_deadline]);
  await c.query('COMMIT');return {id,applicationId:application.id,payment:application.payment,created:true};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function participantAvailability(userId:string){
 const rows=(await db.query<any>(`SELECT r.id,r.application_id,r.dates,r.areas,r.created_at,a.matching_status,a.status FROM availability_registrations r JOIN applications a ON a.id=r.application_id WHERE r.user_id=$1 AND r.status='ACTIVE' AND a.status='SUBMITTED' AND a.matching_status<>'CONFIRMED' ORDER BY r.created_at DESC`,[userId])).rows;
 return rows.map(r=>({...r,dates:parseJson<string[]>(r.dates,[]),areas:parseJson<string[]>(r.areas,[])})).filter(r=>r.dates.some((d:string)=>new Date(`${d}T21:30:00+09:00`).getTime()>Date.now()));
}

export async function recruitingEvents(client:Pick<import('./db').QueryClient,'query'>=db){
 const rows=(await client.query<any>("SELECT id,title,area,starts_at,ends_at,application_deadline,capacity FROM events WHERE status='OPEN' AND application_deadline>now() AND starts_at>now() ORDER BY starts_at,id")).rows;
 const showcase=await activeShowcase(client);
 return rows.filter(e=>!showcase||showcase.summary.eventIds.includes(e.id)).map(e=>({...e,day:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.starts_at))}));
}
