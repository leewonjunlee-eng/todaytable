import {randomUUID} from 'node:crypto';
import {requestOperator,problem,errorResponse} from '@/lib/operators';
import {db,databaseProvider} from '@/lib/db';
import {sameOrigin} from '@/lib/http';
import {REGIONS} from '@/lib/domain';
export const runtime='nodejs';
export async function GET(request:Request){try{if(!await requestOperator(request))problem('운영자 권한이 필요합니다.',403);return Response.json((await db.query('SELECT e.*,count(o.application_id)::int applications FROM events e LEFT JOIN application_options o ON o.event_id=e.id GROUP BY e.id ORDER BY e.starts_at')).rows);}catch(e){return errorResponse(e);}}
async function save(request:Request,update:boolean){const c=await db.connect();try{
 const user=await requestOperator(request);if(!user)problem('운영자 권한이 필요합니다.',403);if(!sameOrigin(request))problem('요청 출처를 확인해 주세요.',403);
 const b=await request.json(),start=new Date(b.startsAt),end=b.endsAt?new Date(b.endsAt):new Date(+start+7200000),deadline=new Date(b.deadline),status=b.status??'OPEN';
 if(typeof b.title!=='string'||b.title.trim().length<2||b.title.length>120||!Number.isFinite(+start)||!Number.isFinite(+end)||!Number.isFinite(+deadline)||+start<=Date.now()||end<=start||deadline>=start||!REGIONS.includes(b.area)||!Number.isInteger(b.capacity)||b.capacity<4||b.capacity>200||b.price!==8000||!['OPEN','CLOSED'].includes(status))problem('회차 시간·마감·지역·정원을 확인해 주세요.');
 await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
 let before:any=null,id=update?b.id:randomUUID();
 if(update){before=(await c.query<any>('SELECT * FROM events WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!before)problem('회차를 찾을 수 없어요.',404);if(!Number.isInteger(b.version)||Number(before.version)!==b.version)problem('회차가 변경됐어요. 새로고침해 주세요.',409);
  const applications=(await c.query<any>("SELECT count(*) n FROM application_options o JOIN applications a ON a.id=o.application_id WHERE o.event_id=$1 AND a.status='SUBMITTED'",[id])).rows[0];
  const seats=(await c.query<any>("SELECT count(*) n FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=$1 AND tm.status='ACTIVE'",[id])).rows[0];
  const impact={applications:Number(applications.n),seats:Number(seats.n),scheduleChanged:+new Date(before.starts_at)!==+start||before.area!==b.area||+new Date(before.ends_at??new Date(+new Date(before.starts_at)+7200000))!==+end};
  if(b.preview===true){await c.query('ROLLBACK');return Response.json({impact,version:before.version});}
  if(impact.scheduleChanged&&impact.applications)problem('신청자가 있는 회차의 시간·지역 변경은 새 회차를 등록하고 이동 절차를 사용해 주세요.',409);
  if(b.capacity<impact.seats)problem('정원을 현재 확정 인원보다 줄일 수 없어요.',409);
  await c.query('UPDATE events SET title=$2,starts_at=$3,ends_at=$4,application_deadline=$5,area=$6,capacity=$7,status=$8,version=version+1 WHERE id=$1',[id,b.title.trim(),start,end,deadline,b.area,b.capacity,status]);
 }else await c.query('INSERT INTO events(id,title,starts_at,ends_at,application_deadline,area,capacity,price_cents,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,8000,$8,$9)',[id,b.title.trim(),start,end,deadline,b.area,b.capacity,status,user.id]);
 await c.query("UPDATE scheduled_jobs SET run_at=$2,next_attempt_at=$2 WHERE job_type='MATCH_EVENT' AND payload->>'eventId'=$1 AND status='PENDING'",[id,deadline],"UPDATE scheduled_jobs SET run_at=$2,next_attempt_at=$2 WHERE job_type='MATCH_EVENT' AND json_extract(payload,'$.eventId')=$1 AND status='PENDING'");
 await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,'event',$3,$4,$5)",[user.id,update?'EVENT_UPDATED':'EVENT_CREATED',id,JSON.stringify(before),JSON.stringify(b)]);
 const result=(await c.query('SELECT * FROM events WHERE id=$1',[id])).rows[0];await c.query('COMMIT');return Response.json(result,{status:update?200:201});
 }catch(e){await c.query('ROLLBACK');return errorResponse(e);}finally{c.release();}}
export const POST=(r:Request)=>save(r,false);
export const PATCH=(r:Request)=>save(r,true);
