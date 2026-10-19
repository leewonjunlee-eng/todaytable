import {requestOperator,problem,errorResponse} from '@/lib/operators';
import {db,databaseProvider} from '@/lib/db';
import {sameOrigin} from '@/lib/http';
import {REGIONS} from '@/lib/domain';
import {randomUUID} from 'node:crypto';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{if(!await requestOperator(request))problem('운영자 권한이 필요합니다.',403);return Response.json((await db.query('SELECT * FROM venues ORDER BY area,name')).rows);}catch(e){return errorResponse(e);}}
export async function POST(request:Request){
 try{const user=await requestOperator(request);if(!user)problem('운영자 권한이 필요합니다.',403);if(!sameOrigin(request))problem('요청 출처를 확인해 주세요.',403);const b=await request.json();
 if(typeof b.name!=='string'||b.name.trim().length<2||b.name.length>120||typeof b.address!=='string'||!b.address.trim()||b.address.length>240||!REGIONS.includes(b.area)||!Number.isInteger(b.capacity)||b.capacity<4||b.capacity>300)problem('식당 정보를 확인해 주세요.');
 const priceMin=b.priceMin??20000,priceMax=b.priceMax??30000,cuisine=b.cuisine??'다이닝';if(!Number.isInteger(priceMin)||!Number.isInteger(priceMax)||priceMin<0||priceMax<priceMin||priceMax>1000000||typeof cuisine!=='string'||!cuisine.trim()||cuisine.length>50||typeof(b.description??'')!=='string'||(b.description??'').length>1000||typeof(b.contactPhone??'')!=='string'||(b.contactPhone??'').length>40)problem('음식 종류·식사 가격·연락처를 확인해 주세요.');
 const c=await db.connect();try{await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
 const venue=(await c.query<any>('INSERT INTO venues(name,area,address,capacity,schedule_required) VALUES($1,$2,$3,$4,true) RETURNING *',[b.name.trim(),b.area,b.address.trim(),b.capacity])).rows[0];
 await c.query('INSERT INTO venue_profiles(venue_id,cuisine,description,price_min,price_max,contact_phone) VALUES($1,$2,$3,$4,$5,$6)',[venue.id,cuisine.trim(),b.description??'',priceMin,priceMax,b.contactPhone??'']);
 const due=(await c.query<any>("SELECT DISTINCT e.id FROM matching_proposals p JOIN events e ON e.id=p.event_id WHERE p.status IN ('PENDING','HELD') AND e.area=$1 AND e.starts_at>now() AND e.application_deadline<=now()",[b.area])).rows;
 for(const e of due)await c.query("INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'MATCH_EVENT',$2,now()) ON CONFLICT(job_key) DO NOTHING",[`venue-created:${venue.id}:${e.id}`,JSON.stringify({eventId:e.id})]);
 await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'VENUE_CREATED','venue',$2,$3)",[user.id,venue.id,JSON.stringify({name:venue.name,area:venue.area,cuisine,priceMin,priceMax,retryEvents:due.map(e=>e.id)})]);await c.query('COMMIT');return Response.json(venue,{status:201});
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }catch(e){return errorResponse(e);}
}
