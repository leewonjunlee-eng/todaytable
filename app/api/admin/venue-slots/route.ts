import {randomUUID} from 'node:crypto';
import {db,databaseProvider} from '@/lib/db';
import {requestOperator,problem,errorResponse} from '@/lib/operators';
import {sameOrigin} from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{if(!await requestOperator(r))problem('운영자 권한이 필요합니다.',403);return Response.json({venues:(await db.query('SELECT id,name,area,schedule_required FROM venues WHERE active=true ORDER BY name')).rows,slots:(await db.query('SELECT * FROM venue_slots ORDER BY starts_at DESC')).rows,checks:(await db.query('SELECT * FROM venue_dietary_checks ORDER BY created_at DESC LIMIT 100')).rows});}catch(e){return errorResponse(e);}}
export async function POST(r:Request){const c=await db.connect();try{const user=await requestOperator(r);if(!user)problem('운영자 권한이 필요합니다.',403);if(!sameOrigin(r))problem('요청 출처를 확인해 주세요.',403);const b=await r.json();await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
 if(!(await c.query('SELECT id FROM venues WHERE id=$1',[b.venueId])).rowCount)problem('식당을 확인해 주세요.');
 if(b.action==='DIETARY'){
  if(typeof b.notes!=='string'||!b.notes.trim()||b.notes.length>1000||!Number.isFinite(+new Date(b.validUntil))||+new Date(b.validUntil)<=Date.now())problem('확인한 음식 요청과 유효기간을 확인해 주세요.');
  const profile=(await c.query<any>('SELECT dietary_notes FROM profiles WHERE user_id=$1',[b.userId])).rows[0];if(profile?.dietary_notes!==b.notes)problem('참가자의 최신 음식 요청과 일치하지 않아요.',409);
  await c.query('INSERT INTO venue_dietary_checks(id,venue_id,user_id,notes,valid_until,confirmed_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),b.venueId,b.userId,b.notes,new Date(b.validUntil),user.id]);
 }else{
  const start=new Date(b.startsAt),end=new Date(b.endsAt);if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end<=new Date()||!Number.isInteger(b.seats)||b.seats<0||b.seats>300||!Number.isInteger(b.tableLimit)||b.tableLimit<0||b.tableLimit>100||typeof b.closed!=='boolean')problem('영업 시간·좌석·테이블 한도를 확인해 주세요.');
  const occupied=(await c.query<any>("SELECT t.id,e.starts_at,COALESCE(e.ends_at,e.starts_at+interval '2 hours') ends_at FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE t.venue_id=$1 AND t.status='CONFIRMED'",[b.venueId],"SELECT t.id,e.starts_at,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) ends_at FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE t.venue_id=$1 AND t.status='CONFIRMED'")).rows;
  if(occupied.some(t=>+new Date(t.starts_at)<+end&&+start<+new Date(t.ends_at)))problem('확정 식탁과 겹치는 슬롯은 변경할 수 없어요. 예약을 먼저 검토해 주세요.',409);
  if(b.id){const result=await c.query('UPDATE venue_slots SET starts_at=$2,ends_at=$3,seats=$4,table_limit=$5,closed=$6,version=version+1 WHERE id=$1 AND venue_id=$7 AND version=$8',[b.id,start,end,b.seats,b.tableLimit,b.closed,b.venueId,b.version]);if(!result.rowCount)problem('슬롯이 변경됐어요. 새로고침해 주세요.',409);}
  else await c.query('INSERT INTO venue_slots(id,venue_id,starts_at,ends_at,seats,table_limit,closed,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),b.venueId,start,end,b.seats,b.tableLimit,b.closed,user.id]);
  await c.query('UPDATE venues SET schedule_required=true WHERE id=$1',[b.venueId]);
 }
 await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'VENUE_AVAILABILITY_UPDATED','venue',$2,$3)",[user.id,b.venueId,JSON.stringify(b)]);await c.query('COMMIT');return Response.json({ok:true});
 }catch(e){await c.query('ROLLBACK');return errorResponse(e);}finally{c.release();}}
