import {randomUUID,randomBytes} from 'node:crypto';
import {db,databaseProvider} from './db';
import {problem,parseJson} from './operators';
export async function registerDeletion(userId:string,ticketId:string){
 await db.query("INSERT INTO deletion_requests(id,user_id,ticket_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[randomUUID(),userId,ticketId]);
 return (await db.query<any>("SELECT * FROM deletion_requests WHERE user_id=$1 AND status<>'COMPLETED' ORDER BY created_at DESC LIMIT 1",[userId])).rows[0];
}
export async function processDeletion(operatorId:string,id:string,version:number,action:'EXECUTE'|'HOLD',reason=''){
 const c=await db.connect();try{await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
 const actor=(await c.query<any>('SELECT active FROM operator_profiles WHERE user_id=$1',[operatorId])).rows[0];if(!actor?.active)problem('운영자 권한이 필요합니다.',403);
 const row=(await c.query<any>('SELECT * FROM deletion_requests WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)problem('삭제 요청을 찾을 수 없어요.',404);
 if(row.status==='COMPLETED'){await c.query('COMMIT');return {status:'COMPLETED',result:parseJson(row.result,{})};}
 if(Number(row.version)!==version)problem('처리 상태가 변경됐어요. 새로고침해 주세요.',409);
 if(typeof reason!=='string'||reason.length>1000||!['EXECUTE','HOLD'].includes(action))problem('처리 내용을 확인해 주세요.');
 const userId=row.user_id,holds:string[]=[];
 if((await c.query("SELECT 1 FROM application_options o JOIN applications a ON a.id=o.application_id JOIN events e ON e.id=o.event_id WHERE a.user_id=$1 AND a.status='SUBMITTED' AND e.starts_at>now() LIMIT 1",[userId])).rowCount)holds.push('진행 중인 참가 신청');
 if((await c.query("SELECT 1 FROM refund_requests r JOIN payments p ON p.id=r.payment_id JOIN applications a ON a.id=p.application_id WHERE a.user_id=$1 AND r.status<>'COMPLETED' LIMIT 1",[userId])).rowCount)holds.push('진행 중인 환불');
 if((await c.query("SELECT 1 FROM safety_reports WHERE (reporter_user_id=$1 OR target_user_id=$1) AND decision='OPEN' LIMIT 1",[userId])).rowCount)holds.push('검토 중인 안전 신고');
 const tickets=(await c.query<any>("SELECT id FROM support_tickets WHERE user_id=$1 AND id<>$2 AND status<>'RESOLVED'",[userId,row.ticket_id])).rows;if(tickets.length)holds.push('처리 중인 문의');
 if(action==='HOLD'||holds.length){const message=holds.length?holds.join(' · '):reason;if(!message.trim())problem('보류 사유를 입력해 주세요.');await c.query("UPDATE deletion_requests SET status='HELD',version=version+1,reason=$2,processed_by=$3 WHERE id=$1",[id,message,operatorId]);await c.query('COMMIT');return {status:'HELD',reason:message};}
 await c.query("UPDATE deletion_requests SET status='PROCESSING',version=version+1,processed_by=$2 WHERE id=$1",[id,operatorId]);
 for(const table of ['sessions','push_subscriptions','profile_tests','participant_preferences','preference_signals','venue_dietary_checks'])await c.query(`DELETE FROM ${table} WHERE user_id=$1`,[userId]);
 await c.query('DELETE FROM profiles WHERE user_id=$1',[userId]);
 await c.query("UPDATE users SET email=$2,password_hash=$3,restricted_status='PERMANENT' WHERE id=$1",[userId,`deleted-${userId}@invalid.local`,randomBytes(48).toString('hex')]);
 await c.query("UPDATE journey_messages SET body='삭제된 회원의 메시지' WHERE author_user_id=$1",[userId]);
 await c.query("UPDATE journey_feedback SET comment='' WHERE author_user_id=$1",[userId]);
 await c.query("UPDATE feedback_details SET good_text='',improve_text='',next_interests='[]' WHERE feedback_id IN (SELECT id FROM journey_feedback WHERE author_user_id=$1)",[userId]);
 await c.query("UPDATE support_tickets SET contact_name='탈퇴 회원',contact_email='',subject='종료된 문의' WHERE user_id=$1",[userId]);
 await c.query("UPDATE support_messages SET author_name='탈퇴 회원',body='삭제된 회원의 문의' WHERE author_user_id=$1",[userId]);
 await c.query("UPDATE notifications SET message='삭제된 알림' WHERE recipient_user_id=$1",[userId]);
 await c.query("UPDATE business_events SET variables='{}',message='삭제된 알림' WHERE user_id=$1",[userId]);
 await c.query("UPDATE checkout_sessions SET selection='{}',status='EXPIRED',updated_at=now() WHERE user_id=$1 AND status<>'COMPLETED'",[userId]);
 // Historical matching inputs must not retain the deleted profile or feed learning.
 for(const table of ['match_runs','matching_previews']){
  const column=table==='match_runs'?'input_snapshot':'snapshot';const rows=(await c.query<any>(`SELECT id,${column} value FROM ${table}`)).rows;
  const scrub=(value:any):any=>{if(Array.isArray(value))return value.filter(v=>v?.userId!==userId&&v?.user_id!==userId).map(scrub);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,scrub(v)]));return value;};
  for(const r of rows){const original=parseJson<any>(r.value,{}),clean=scrub(original);if(JSON.stringify(original)!==JSON.stringify(clean))await c.query(`UPDATE ${table} SET ${column}=$2 WHERE id=$1`,[r.id,JSON.stringify(clean)]);}
 }
 const proposals=(await c.query<any>('SELECT id,candidates FROM matching_proposals')).rows;for(const p of proposals){const candidates=parseJson<any[]>(p.candidates,[]),clean=candidates.filter(m=>m.userId!==userId);if(clean.length!==candidates.length)await c.query('UPDATE matching_proposals SET candidates=$2 WHERE id=$1',[p.id,JSON.stringify(clean)]);}
 await c.query("UPDATE audit_logs SET before_data=$2,after_data=$2 WHERE actor_user_id=$1",[userId,JSON.stringify({personalDataRemoved:true})]);
 const result={profile:'DELETED',sessions:'REVOKED',personalization:'DELETED',ownText:'REDACTED',transactions:'PSEUDONYMIZED_RETAINED',safety:'RESTRICTED_RETAINED',completedAt:new Date().toISOString()};
 await c.query("UPDATE deletion_requests SET status='COMPLETED',completed_at=now(),reason='',result=$2 WHERE id=$1",[id,JSON.stringify(result)]);
 await c.query("UPDATE support_tickets SET status='RESOLVED',resolved_at=now(),version=version+1 WHERE id=$1",[row.ticket_id]);
 await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'ACCOUNT_DELETION_COMPLETED','deletion_request',$2,$3)",[operatorId,id,JSON.stringify(result)]);
 await c.query('COMMIT');return {status:'COMPLETED',result};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
