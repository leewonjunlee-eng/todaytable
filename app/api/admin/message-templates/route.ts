import {randomUUID} from 'node:crypto';
import {db,databaseProvider} from '@/lib/db';
import {requestOperator,problem,errorResponse} from '@/lib/operators';
import {sameOrigin} from '@/lib/http';
import {MESSAGE_DEFAULTS,renderMessage,type MessageKind} from '@/lib/business-events';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{if(!await requestOperator(r))problem('운영자 권한이 필요합니다.',403);return Response.json({defaults:MESSAGE_DEFAULTS,versions:(await db.query('SELECT * FROM notification_templates ORDER BY kind,version DESC')).rows});}catch(e){return errorResponse(e);}}
export async function POST(r:Request){const c=await db.connect();try{const user=await requestOperator(r);if(!user)problem('운영자 권한이 필요합니다.',403);if(!sameOrigin(r))problem('요청 출처를 확인해 주세요.',403);const b=await r.json();if(!Object.hasOwn(MESSAGE_DEFAULTS,b.kind)||typeof b.body!=='string')problem('안내 종류를 확인해 주세요.');
 const kind=b.kind as MessageKind,variables=Object.fromEntries([...MESSAGE_DEFAULTS[kind].matchAll(/{{(\w+)}}/g)].map(m=>[m[1],`[${m[1]} 예시]`])),preview=renderMessage(kind,b.body,variables);
 if(b.preview)return Response.json({preview});
 await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:templates',0))");
 const current=(await c.query<any>('SELECT COALESCE(MAX(version),0) version FROM notification_templates WHERE kind=$1',[kind])).rows[0];if(Number(b.version)!==Number(current.version))problem('다른 운영자가 안내를 변경했어요. 새로고침해 주세요.',409);
 await c.query('UPDATE notification_templates SET active=false WHERE kind=$1',[kind]);
 const id=randomUUID();await c.query('INSERT INTO notification_templates(id,kind,version,body,created_by) VALUES($1,$2,$3,$4,$5)',[id,kind,Number(current.version)+1,b.body,user.id]);
 await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'NOTIFICATION_TEMPLATE_PUBLISHED','notification_template',$2,$3)",[user.id,id,JSON.stringify({kind,version:Number(current.version)+1,body:b.body})]);await c.query('COMMIT');return Response.json({ok:true,id,preview});
 }catch(e){await c.query('ROLLBACK');return errorResponse(e);}finally{c.release();}}
