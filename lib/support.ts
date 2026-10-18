import { randomUUID, createHash, createHmac } from 'node:crypto';
import { db, databaseProvider, type QueryClient } from './db';
import { apiUser, type AuthUser } from './auth';
import { requestOperator, type Operator, parseJson, problem } from './operators';
import { isCanonicalUuid } from './domain';
import {SUPPORT_CATEGORIES,SUPPORT_STATUSES} from './support-domain';
export type SupportIdentity = {user:AuthUser|null; operator:Operator|null; visitorId:string|null; actorKey:string; cookieToken?:string};
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function supportIdentity(request:Request,create=false):Promise<SupportIdentity> {
 const user=await apiUser(request),operator=user?.role==='ADMIN'?await requestOperator(request):null;
 const cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)todaytable_support=([^;]+)/)?.[1];
 let visitorId:string|null=null, cookieToken:string|undefined;
 if(cookie) visitorId=(await db.query<any>('SELECT id FROM support_visitors WHERE token_hash=$1',[digest(cookie)])).rows[0]?.id??null;
 if(!user&&!visitorId&&create){visitorId=randomUUID();cookieToken=randomUUID()+randomUUID();await db.query('INSERT INTO support_visitors(id,token_hash) VALUES($1,$2)',[visitorId,digest(cookieToken)]);}
 return {user,operator,visitorId,actorKey:user?`user:${user.id}`:visitorId?`visitor:${visitorId}`:'anonymous',cookieToken};
}
export async function limitSupport(request:Request) {
 const ip=(request.headers.get('x-forwarded-for')??'local').split(',')[0].trim();
 const hash=createHmac('sha256',process.env.SESSION_SECRET??'local-support-rate').update(ip).digest('hex');
 const hour=new Date().toISOString().slice(0,13),bucket=`support:${hash}:${hour}`;
 const hit=await db.query<any>('INSERT INTO support_rate_limits(bucket,hits,reset_at) VALUES($1,1,$2) ON CONFLICT(bucket) DO UPDATE SET hits=support_rate_limits.hits+1 RETURNING hits',[bucket,new Date(Date.now()+3600000)]);
 if(Number(hit.rows[0].hits)>30)problem('문의 요청이 많아요. 잠시 후 다시 시도해 주세요.',429);
}
const own=(row:any,who:SupportIdentity)=>Boolean(who.operator||(who.user&&row.user_id===who.user.id)||(who.visitorId&&row.visitor_id===who.visitorId));
export async function getTicket(id:string,who:SupportIdentity,client:Pick<QueryClient,'query'>=db,lock=false) {
 if(!isCanonicalUuid(id))problem('문의를 찾을 수 없습니다.',404);
 const row=(await client.query<any>(`SELECT * FROM support_tickets WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0];
 if(!row||!own(row,who))problem('문의를 찾을 수 없습니다.',404);
 return row;
}
async function activity(client:QueryClient,ticketId:string,who:SupportIdentity,action:string,details:unknown,label?:string) {
 await client.query('INSERT INTO support_activity(id,ticket_id,actor_user_id,actor_name,action,details) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),ticketId,who.user?.id??null,who.operator?.display_name??label??'참가자',action,JSON.stringify(details)]);
}
export async function listSupport(who:SupportIdentity) {
 if(who.actorKey==='anonymous')return {tickets:[],operators:[],templates:[],improvements:[],authenticated:false};
 const params:unknown[]=[who.actorKey];
 let scope='';
 if(!who.operator){params.push(who.user?.id??null,who.visitorId);scope='WHERE (t.user_id=$2 OR t.visitor_id=$3)';}
 const tickets=await db.query<any>(`SELECT t.*,op.display_name assignee_name,
   CASE WHEN sr.read_at IS NULL OR sr.read_at<t.last_public_at THEN 1 ELSE 0 END unread,
   (SELECT body FROM support_messages m WHERE m.ticket_id=t.id AND m.kind='PUBLIC' ORDER BY m.ordinal DESC,m.created_at DESC,m.id DESC LIMIT 1) preview
   FROM support_tickets t LEFT JOIN operator_profiles op ON op.user_id=t.assignee_id
   LEFT JOIN support_reads sr ON sr.ticket_id=t.id AND sr.actor_key=$1 ${scope} ORDER BY t.updated_at DESC LIMIT 200`,params);
 const operators=who.operator?(await db.query('SELECT user_id,display_name,team_role,avatar_color FROM operator_profiles WHERE active=true ORDER BY created_at')).rows:[];
 const templates=who.operator?(await db.query('SELECT * FROM support_templates ORDER BY title')).rows:[];
 const improvements=who.operator?(await db.query(`SELECT i.*, (SELECT count(*) FROM improvement_tickets it WHERE it.item_id=i.id) request_count FROM improvement_items i ORDER BY i.created_at DESC`)).rows:[];
 return {authenticated:Boolean(who.user),tickets:tickets.rows.map(t=>({...t,tags:parseJson(t.tags,[]),...(!who.operator?{contact_email:undefined,visitor_id:undefined}:{} )})),operators,templates,improvements,me:who.operator?{id:who.operator.id,name:who.operator.display_name,role:who.operator.team_role}:null};
}
export async function createTicket(who:SupportIdentity,b:any) {
 if(!who.user&&!who.visitorId)problem('접수 정보를 확인해 주세요.');
 if(!isCanonicalUuid(b.requestKey))problem('접수 요청을 다시 확인해 주세요.');
 if(!(Object.hasOwn(SUPPORT_CATEGORIES,b.category))||typeof b.subject!=='string'||b.subject.trim().length<2||b.subject.length>160||typeof b.body!=='string'||!b.body.trim()||b.body.length>5000)problem('문의 유형과 제목, 내용을 확인해 주세요.');
 const name=who.user?(await db.query<any>('SELECT display_name FROM profiles WHERE user_id=$1',[who.user.id])).rows[0]?.display_name??'참가자':String(b.name??'').trim();
 const email=who.user?.email??String(b.email??'').trim();
 if(!name||name.length>60||email.length>254||!/^\S+@\S+\.\S+$/.test(email))problem('이름과 이메일을 확인해 주세요.');
 const client=await db.connect();try{
  await client.query('BEGIN');
  if(databaseProvider==='postgres')await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`support-create:${who.actorKey}`]);
  const replay=(await client.query<any>('SELECT * FROM support_tickets WHERE request_key=$1',[b.requestKey])).rows[0];
  if(replay){if(!own(replay,who))problem('요청 키를 다시 생성해 주세요.',409);await client.query('COMMIT');return {id:replay.id,created:false};}
  for(const [key,value] of [['application',b.applicationId],['table',b.tableId]] as const) if(value){
   if(!who.user||!isCanonicalUuid(value))problem('연결할 신청이나 식탁을 확인해 주세요.');
   const checked=key==='application'?await client.query('SELECT 1 FROM applications WHERE id=$1 AND user_id=$2',[value,who.user.id]):await client.query('SELECT 1 FROM table_members WHERE table_id=$1 AND user_id=$2',[value,who.user.id]);
   if(!checked.rowCount)problem('본인의 신청이나 식탁만 연결할 수 있어요.',403);
  }
  const id=randomUUID(),number=`TT-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${id.slice(0,6).toUpperCase()}`;
  const app=b.applicationId?(await client.query<any>('SELECT is_demo FROM applications WHERE id=$1',[b.applicationId])).rows[0]:null;
  await client.query(`INSERT INTO support_tickets(id,number,user_id,visitor_id,contact_name,contact_email,subject,category,application_id,table_id,request_key,is_demo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,number,who.user?.id??null,who.visitorId,name,email,b.subject.trim(),b.category,b.applicationId??null,b.tableId??null,b.requestKey,Boolean(app?.is_demo)]);
  await client.query("INSERT INTO support_messages(id,ticket_id,author_user_id,author_name,kind,body,request_key) VALUES($1,$2,$3,$4,'PUBLIC',$5,$6)",[randomUUID(),id,who.user?.id??null,name,b.body.trim(),b.requestKey]);
  await activity(client,id,who,'CREATED',{category:b.category},name);
  await client.query("INSERT INTO product_events(id,user_id,event_type,entity_id,is_demo) VALUES($1,$2,'SUPPORT_CREATED',$3,$4)",[randomUUID(),who.user?.id??null,id,Boolean(app?.is_demo)]);
  await client.query('COMMIT');return {id,created:true};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function supportDetail(id:string,who:SupportIdentity) {
 const ticket=await getTicket(id,who);
 const messages=(await db.query<any>(`SELECT id,author_name,author_user_id,kind,body,created_at FROM support_messages WHERE ticket_id=$1 ${who.operator?'':"AND kind='PUBLIC'"} ORDER BY ordinal,created_at,id`,[id])).rows;
 const timeline=who.operator?(await db.query<any>('SELECT * FROM support_activity WHERE ticket_id=$1 ORDER BY created_at,id',[id])).rows.map(a=>({...a,details:parseJson(a.details,{})})):[];
 const presence=who.operator?(await db.query(`SELECT p.user_id,p.composing,o.display_name,o.avatar_color FROM support_presence p JOIN operator_profiles o ON o.user_id=p.user_id WHERE p.ticket_id=$1 AND p.expires_at>now() AND o.active=true`,[id])).rows:[];
 const context=who.operator&&ticket.user_id?{
  profile:(await db.query('SELECT display_name,birth_year,occupation FROM profiles WHERE user_id=$1',[ticket.user_id])).rows[0],
  applications:(await db.query(`SELECT a.id,a.status,a.matching_status,a.pass_choice,p.status payment_status,p.amount_cents FROM applications a LEFT JOIN payments p ON p.application_id=a.id WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 10`,[ticket.user_id])).rows,
  tables:(await db.query(`SELECT t.id,e.title,e.starts_at,e.area,v.name venue_name FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id LEFT JOIN venues v ON v.id=t.venue_id WHERE tm.user_id=$1 AND tm.status='ACTIVE' ORDER BY e.starts_at DESC LIMIT 10`,[ticket.user_id])).rows,
 }:null;
 const linkedImprovements=who.operator?(await db.query('SELECT i.id,i.title,i.status FROM improvement_items i JOIN improvement_tickets it ON it.item_id=i.id WHERE it.ticket_id=$1',[id])).rows:[];
 if(!who.operator){delete ticket.visitor_id;delete ticket.contact_email;}
 return {ticket:{...ticket,tags:parseJson(ticket.tags,[])},messages,timeline,presence,context,improvements:linkedImprovements};
}
export async function mutateSupport(id:string,who:SupportIdentity,b:any) {
 const client=await db.connect();try{
  await client.query('BEGIN');const ticket=await getTicket(id,who,client,true);
  if(b.action==='READ'){
   await client.query('INSERT INTO support_reads(ticket_id,actor_key,read_at) VALUES($1,$2,$3) ON CONFLICT(ticket_id,actor_key) DO UPDATE SET read_at=excluded.read_at',[id,who.actorKey,new Date()]);
  } else if(b.action==='PRESENCE'){
   if(!who.operator)problem('운영자 권한이 필요해요.',403);
   await client.query('INSERT INTO support_presence(ticket_id,user_id,composing,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(ticket_id,user_id) DO UPDATE SET composing=excluded.composing,expires_at=excluded.expires_at',[id,who.operator.id,Boolean(b.composing),new Date(Date.now()+20000)]);
  } else if(b.action==='HELPFUL'){
   if(who.operator||ticket.status!=='RESOLVED'||typeof b.helpful!=='boolean')problem('해결된 문의에서 평가할 수 있어요.');
   await client.query('UPDATE support_tickets SET helpful=$2 WHERE id=$1',[id,b.helpful]);
  } else if(b.action==='MESSAGE'){
   if(!isCanonicalUuid(b.requestKey)||typeof b.body!=='string'||!b.body.trim()||b.body.length>5000)problem('답변 내용을 확인해 주세요.');
   const kind=b.kind==='INTERNAL'?'INTERNAL':'PUBLIC';if(kind==='INTERNAL'&&!who.operator)problem('내부 메모는 운영자만 작성할 수 있어요.',403);
   const replay=(await client.query<any>('SELECT body,kind,author_user_id FROM support_messages WHERE ticket_id=$1 AND request_key=$2',[id,b.requestKey])).rows[0];
   if(replay){if(replay.body!==b.body.trim()||replay.kind!==kind||replay.author_user_id!==(who.user?.id??null))problem('이 요청은 다른 메시지에 사용됐어요.',409);await client.query('COMMIT');return {ok:true,replayed:true};}
   if(Number(b.version)!==Number(ticket.version))problem('다른 운영자나 참가자가 내용을 변경했어요. 최신 내용을 확인하고 다시 보내 주세요.',409);
   const messageId=randomUUID(),label=who.operator?.display_name??ticket.contact_name;
   await client.query('INSERT INTO support_messages(id,ticket_id,author_user_id,author_name,kind,body,request_key,ordinal,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[messageId,id,who.user?.id??null,label,kind,b.body.trim(),b.requestKey,Number(ticket.version)+1,new Date()]);
   await client.query(`UPDATE support_tickets SET version=version+1,updated_at=$4,last_public_at=CASE WHEN $2='PUBLIC' THEN $4 ELSE last_public_at END,
    status=CASE WHEN $2='INTERNAL' THEN status WHEN $3=true THEN 'WAITING_CUSTOMER' ELSE 'OPEN' END,
    first_response_at=CASE WHEN $3=true AND $2='PUBLIC' THEN COALESCE(first_response_at,now()) ELSE first_response_at END,
    resolved_at=CASE WHEN $2='PUBLIC' THEN NULL ELSE resolved_at END WHERE id=$1`,[id,kind,Boolean(who.operator),new Date()]);
   if(who.operator&&kind==='PUBLIC'&&ticket.user_id)await client.query("INSERT INTO notifications(recipient_user_id,message,channel,status,sent_by,action_url) VALUES($1,$2,'IN_APP','SENT',$3,$4)",[ticket.user_id,`문의 ${ticket.number}에 답변이 도착했어요. 문의함에서 확인해 주세요.`,who.operator.id,`/support?id=${id}`]);
   if(kind==='PUBLIC')await client.query('INSERT INTO support_reads(ticket_id,actor_key,read_at) VALUES($1,$2,$3) ON CONFLICT(ticket_id,actor_key) DO UPDATE SET read_at=excluded.read_at',[id,who.actorKey,new Date()]);
   await activity(client,id,who,kind==='INTERNAL'?'INTERNAL_NOTE':'REPLIED',{messageId},label);
  } else if(b.action==='UPDATE'){
   if(!who.operator)problem('운영자 권한이 필요해요.',403);
   if(Number(b.version)!==Number(ticket.version))problem('다른 운영자가 변경했어요. 새로고침 후 다시 시도해 주세요.',409);
   const next={status:b.status??ticket.status,category:b.category??ticket.category,priority:b.priority??ticket.priority,assigneeId:b.assigneeId===undefined?ticket.assignee_id:b.assigneeId,tags:b.tags??parseJson(ticket.tags,[]),followup:b.nextFollowupAt===undefined?ticket.next_followup_at:b.nextFollowupAt};
   if(!(Object.hasOwn(SUPPORT_STATUSES,next.status))||!(Object.hasOwn(SUPPORT_CATEGORIES,next.category))||!['LOW','NORMAL','HIGH','URGENT'].includes(next.priority)||!Array.isArray(next.tags)||next.tags.length>8||next.tags.some((t:unknown)=>typeof t!=='string'||t.length>30))problem('분류나 처리 상태를 확인해 주세요.');
   if(next.assigneeId&&!(await client.query('SELECT 1 FROM operator_profiles WHERE user_id=$1 AND active=true',[next.assigneeId])).rowCount)problem('활성 운영자에게만 배정할 수 있어요.');
   if(next.followup&&!Number.isFinite(new Date(next.followup).getTime()))problem('다음 확인 시각을 확인해 주세요.');
   await client.query(`UPDATE support_tickets SET status=$2,category=$3,priority=$4,assignee_id=$5,tags=$6,next_followup_at=$7,version=version+1,updated_at=now(),resolved_at=CASE WHEN $2='RESOLVED' THEN now() ELSE NULL END WHERE id=$1`,[id,next.status,next.category,next.priority,next.assigneeId,JSON.stringify(next.tags),next.followup?new Date(next.followup):null]);
   await activity(client,id,who,'UPDATED',{before:{status:ticket.status,category:ticket.category,assigneeId:ticket.assignee_id,priority:ticket.priority,tags:parseJson(ticket.tags,[]),followup:ticket.next_followup_at},after:next});
  } else if(b.action==='IMPROVEMENT'){
   if(!who.operator)problem('운영자 권한이 필요해요.',403);
   let itemId=b.itemId;
   if(!itemId){if(typeof b.title!=='string'||b.title.trim().length<2||b.title.length>160)problem('개선 과제 제목을 입력해 주세요.');itemId=randomUUID();await client.query('INSERT INTO improvement_items(id,title,category,created_by) VALUES($1,$2,$3,$4)',[itemId,b.title.trim(),ticket.category,who.operator.id]);}
   else if(!(await client.query('SELECT 1 FROM improvement_items WHERE id=$1',[itemId])).rowCount)problem('개선 과제를 찾을 수 없어요.',404);
   await client.query('INSERT INTO improvement_tickets(item_id,ticket_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[itemId,id]);
   await activity(client,id,who,'IMPROVEMENT_LINKED',{itemId});
  } else problem('지원하지 않는 작업이에요.');
  await client.query('COMMIT');return {ok:true};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
