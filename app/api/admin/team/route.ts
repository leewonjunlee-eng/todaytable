import {isCanonicalUuid} from '@/lib/domain';
import {db} from '@/lib/db';
import {requestOperator,problem,errorResponse} from '@/lib/operators';
import {sameOrigin} from '@/lib/http';
import {SUPPORT_CATEGORIES} from '@/lib/support-domain';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const me=await requestOperator(request);if(!me)problem('활성 운영자 권한이 필요합니다.',403);
 const [operators,templates,improvements]=await Promise.all([db.query(`SELECT o.*,u.email,(SELECT count(*) FROM support_tickets t WHERE t.assignee_id=o.user_id AND t.status<>'RESOLVED') open_count FROM operator_profiles o JOIN users u ON u.id=o.user_id ORDER BY o.created_at`),db.query('SELECT * FROM support_templates ORDER BY title'),db.query(`SELECT i.*,(SELECT count(*) FROM improvement_tickets it WHERE it.item_id=i.id) request_count FROM improvement_items i ORDER BY created_at DESC`)]);
 return Response.json({me:{id:me.id,name:me.display_name,role:me.team_role},operators:operators.rows,templates:templates.rows,improvements:improvements.rows});
}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))problem('요청 출처를 확인할 수 없어요.',403);const me=await requestOperator(request);if(!me)problem('운영자 권한이 필요합니다.',403);
 const b=await request.json().catch(()=>null);if(!b||typeof b!=='object'||Array.isArray(b))problem('변경 형식을 확인해 주세요.');
 if(b.action!=='TEMPLATE'&&(typeof b.id!=='string'||!b.id||b.id.length>100))problem('변경할 항목을 확인해 주세요.');
 if(['OPERATOR','TRANSFER_OWNER'].includes(b.action)&&!isCanonicalUuid(b.id))problem('운영자를 확인해 주세요.');
 if(b.action!=='IMPROVEMENT_STATUS'&&me.team_role!=='OWNER')problem('총괄 운영자만 변경할 수 있어요.',403);
 const client=await db.connect();let entityId=typeof b.id==='string'?b.id:null;try{await client.query('BEGIN');
 if(b.action!=='IMPROVEMENT_STATUS'){const locked=(await client.query<any>('SELECT team_role,active FROM operator_profiles WHERE user_id=$1 FOR UPDATE',[me.id])).rows[0];if(!locked?.active||locked.team_role!=='OWNER')problem('운영 권한이 변경됐어요. 새로고침해 주세요.',409);}
 if(b.action==='OPERATOR'){
  if(typeof b.displayName!=='string'||b.displayName.trim().length<2||b.displayName.length>40||!/^#[0-9a-f]{6}$/i.test(b.avatarColor??''))problem('이름과 색상을 확인해 주세요.');
  const target=(await client.query<any>('SELECT user_id,team_role FROM operator_profiles WHERE user_id=$1 FOR UPDATE',[b.id])).rows[0];if(!target)problem('운영자를 찾을 수 없어요.',404);
  if(typeof b.active!=='boolean')problem('활성 상태를 확인해 주세요.');if(b.id===me.id&&!b.active)problem('현재 총괄 계정은 비활성화할 수 없어요.');
  await client.query('UPDATE operator_profiles SET display_name=$2,avatar_color=$3,active=$4 WHERE user_id=$1',[b.id,b.displayName.trim(),b.avatarColor,b.active]);
  await client.query("UPDATE users SET restricted_status=$2 WHERE id=$1",[b.id,b.active?'ACTIVE':'SUSPENDED']);
 }else if(b.action==='TRANSFER_OWNER'){
  if(b.id===me.id)problem('다른 운영자를 선택해 주세요.');const target=await client.query('SELECT 1 FROM operator_profiles WHERE user_id=$1 AND active=true',[b.id]);if(!target.rowCount)problem('활성 운영자를 선택해 주세요.');
  await client.query("UPDATE operator_profiles SET team_role='OPERATOR' WHERE user_id=$1",[me.id]);await client.query("UPDATE operator_profiles SET team_role='OWNER' WHERE user_id=$1",[b.id]);
 }else if(b.action==='TEMPLATE'){
  if(typeof b.title!=='string'||!b.title.trim()||b.title.length>80||typeof b.body!=='string'||!b.body.trim()||b.body.length>3000||!(Object.hasOwn(SUPPORT_CATEGORIES,b.category)))problem('답변 제목과 분류, 내용을 확인해 주세요.');
  const id=typeof b.id==='string'&&b.id.length<100?b.id:crypto.randomUUID();entityId=id;
  await client.query('INSERT INTO support_templates(id,title,category,body,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,body=excluded.body,updated_by=excluded.updated_by,updated_at=now()',[id,b.title.trim(),b.category,b.body.trim(),me.id]);
 }else if(b.action==='DELETE_TEMPLATE'){
  await client.query('DELETE FROM support_templates WHERE id=$1',[b.id]);
 }else if(b.action==='IMPROVEMENT_STATUS'){
  if(!['OPEN','PLANNED','DONE'].includes(b.status))problem('개선 상태를 확인해 주세요.');const result=await client.query('UPDATE improvement_items SET status=$2 WHERE id=$1',[b.id,b.status]);if(!result.rowCount)problem('개선 과제를 찾을 수 없어요.',404);
 }else problem('지원하지 않는 변경입니다.');
 await client.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'operations_settings',$3,$4)",[me.id,b.action,entityId,JSON.stringify(b)]);
 await client.query('COMMIT');return Response.json({ok:true});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}catch(e){return errorResponse(e);}}
