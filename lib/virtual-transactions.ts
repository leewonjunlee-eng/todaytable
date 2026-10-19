import {queueBusinessEvent} from './business-events';
import {randomUUID} from 'node:crypto';
import {db,databaseProvider,type QueryClient} from './db';

/** Internal ledger only: never contacts a payment provider. Caller owns transaction. */
export async function completeVirtualRefund(c:QueryClient,resolutionId:string){
 const request=(await c.query<any>('SELECT r.*,p.application_id,p.amount_cents original_amount,p.status payment_status,rc.selected_choice,rc.status resolution_status FROM refund_requests r JOIN payments p ON p.id=r.payment_id JOIN resolution_cases rc ON rc.id=r.resolution_id WHERE r.resolution_id=$1 FOR UPDATE',[resolutionId])).rows[0];
 if(!request)throw new Error('환불 요청을 찾을 수 없어요.');
 if(request.status==='COMPLETED')return {status:'REFUNDED',amount:Number(request.amount_cents)};
 if(request.selected_choice!=='REFUND'||!['REFUND_REQUESTED','FAILED'].includes(request.resolution_status))throw new Error('환불 선택이 유지된 요청만 처리할 수 있어요. 해결 상태를 다시 확인해 주세요.');
 if(!['PAID','REFUND_AVAILABLE','REFUND_REQUESTED','REFUND_PROCESSING','REFUND_FAILED'].includes(request.payment_status))throw new Error('환불할 수 있는 승인 결제가 없어요.');
 // Older import/fixture writers predate the ledger. Record their existing approval, without changing its amount or status.
 await c.query("INSERT INTO payment_ledger(id,payment_id,request_key,kind,amount_cents,source) SELECT $1,$2,$3,'CHARGE',$4,'LEGACY' WHERE NOT EXISTS(SELECT 1 FROM payment_ledger WHERE payment_id=$2 AND kind='CHARGE') ON CONFLICT(request_key) DO NOTHING",[randomUUID(),request.payment_id,`legacy-charge:${request.payment_id}`,request.original_amount]);
 const charged=(await c.query<any>("SELECT COALESCE(SUM(CASE WHEN kind='CHARGE' THEN amount_cents ELSE -amount_cents END),0) balance FROM payment_ledger WHERE payment_id=$1",[request.payment_id])).rows[0];
 const amount=Number(request.amount_cents);
 if(amount<0||amount>Number(charged.balance))throw new Error('환불 금액이 남은 결제 금액을 초과합니다.');
 await c.query("UPDATE refund_requests SET status='PROCESSING',error=NULL WHERE id=$1",[request.id]);
 await c.query("UPDATE payments SET status='REFUND_PROCESSING',updated_at=now() WHERE id=$1",[request.payment_id]);
 await c.query("INSERT INTO payment_ledger(id,payment_id,request_key,kind,amount_cents) VALUES($1,$2,$3,'REFUND',$4) ON CONFLICT(request_key) DO NOTHING",[randomUUID(),request.payment_id,`refund:${request.id}`,amount]);
 await c.query("UPDATE payments SET status='REFUNDED',updated_at=now() WHERE id=$1",[request.payment_id]);
 await c.query("UPDATE refund_requests SET status='COMPLETED',completion_source='AUTO',completed_at=now(),error=NULL WHERE id=$1",[request.id]);
 await c.query("UPDATE resolution_cases SET status='REFUNDED',updated_at=now() WHERE id=$1",[resolutionId]);
 await c.query("UPDATE applications SET status='CANCELED',matching_status='NO_MATCH',updated_at=now() WHERE id=$1",[request.application_id]);
 await c.query("UPDATE availability_registrations SET status='CANCELLED' WHERE application_id=$1",[request.application_id]);
 await c.query("INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES('VIRTUAL_REFUND_COMPLETED','payment',$1,$2)",[request.payment_id,JSON.stringify({resolutionId,amount})]);
 const owner=(await c.query<any>('SELECT user_id FROM applications WHERE id=$1',[request.application_id])).rows[0];
 await queueBusinessEvent(c,{key:`refund:${request.id}`,kind:'REFUND_COMPLETED',userId:owner.user_id,applicationId:request.application_id,variables:{amount:String(amount)},url:'/payments'});
 return {status:'REFUNDED',amount};
}

export async function paymentHistory(userId:string){
 const [payments,attempts,ledger,refunds]=await Promise.all([
  db.query<any>('SELECT p.*,a.pass_choice,a.status application_status,e.remaining_uses,e.original_uses FROM payments p JOIN applications a ON a.id=p.application_id LEFT JOIN entitlements e ON e.source_payment_id=p.id WHERE a.user_id=$1 ORDER BY p.created_at DESC',[userId]),
  db.query<any>('SELECT id,request_key,application_id,amount_cents,outcome,created_at FROM payment_attempts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[userId]),
  db.query<any>('SELECT l.* FROM payment_ledger l JOIN payments p ON p.id=l.payment_id JOIN applications a ON a.id=p.application_id WHERE a.user_id=$1 ORDER BY l.created_at',[userId]),
  db.query<any>('SELECT r.id,r.payment_id,r.amount_cents,r.status,r.error,r.created_at,r.completed_at FROM refund_requests r JOIN payments p ON p.id=r.payment_id JOIN applications a ON a.id=p.application_id WHERE a.user_id=$1 ORDER BY r.created_at DESC',[userId])]);
 return {payments:payments.rows.map(p=>({...p,transactions:ledger.rows.filter(l=>l.payment_id===p.id),refunds:refunds.rows.filter(r=>r.payment_id===p.id)})),attempts:attempts.rows};
}

/** Refund unused portions of a held three-use pass at its original per-use price. */
export async function refundUnusedPass(userId:string,paymentId:string,requestKey:string){
 if(!/^[0-9a-f-]{36}$/i.test(paymentId)||!/^[0-9a-f-]{36}$/i.test(requestKey))throw new Error('요청 키를 확인해 주세요.');
 const c=await db.connect();try{
 await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
 const prior=(await c.query<any>("SELECT amount_cents,payment_id FROM payment_ledger WHERE request_key=$1 AND payment_id IN(SELECT p.id FROM payments p JOIN applications a ON a.id=p.application_id WHERE a.user_id=$2)",[`unused:${requestKey}`,userId])).rows[0];
 if(prior){if(prior.payment_id!==paymentId)throw new Error('이미 다른 결제 환불에 사용된 요청 키입니다.');await c.query('COMMIT');return {status:'REFUNDED',amount:Number(prior.amount_cents)};}
 const p=(await c.query<any>('SELECT p.*,e.id entitlement_id,e.remaining_uses,e.original_uses FROM payments p JOIN applications a ON a.id=p.application_id JOIN entitlements e ON e.source_payment_id=p.id WHERE p.id=$1 AND a.user_id=$2 FOR UPDATE',[paymentId,userId])).rows[0];
 if(!p||p.status!=='PAID'||Number(p.remaining_uses)<1)throw new Error('환불 가능한 잔여 참가권이 없어요.');
 const active=(await c.query<any>("SELECT 1 FROM entitlement_entries x JOIN applications a ON a.id=x.application_id WHERE x.entitlement_id=$1 AND x.entry_type='USE' AND a.status='SUBMITTED' AND NOT EXISTS(SELECT 1 FROM entitlement_entries r WHERE r.entitlement_id=x.entitlement_id AND r.application_id=x.application_id AND r.entry_type='RESTORE') AND EXISTS(SELECT 1 FROM application_options o JOIN events e ON e.id=o.event_id WHERE o.application_id=a.id AND e.starts_at>now()) LIMIT 1",[p.entitlement_id])).rowCount;
 if(active)throw new Error('진행 중인 신청을 먼저 취소하거나 참가권 보관으로 변경해 주세요.');
 const amount=Math.floor(Number(p.amount_cents)*Number(p.remaining_uses)/Number(p.original_uses));
 await c.query("INSERT INTO payment_ledger(id,payment_id,request_key,kind,amount_cents,source) SELECT $1,$2,$3,'CHARGE',$4,'LEGACY' WHERE NOT EXISTS(SELECT 1 FROM payment_ledger WHERE payment_id=$2 AND kind='CHARGE') ON CONFLICT(request_key) DO NOTHING",[randomUUID(),paymentId,`legacy-charge:${paymentId}`,p.amount_cents]);
 await c.query("INSERT INTO payment_ledger(id,payment_id,request_key,kind,amount_cents) VALUES($1,$2,$3,'REFUND',$4)",[randomUUID(),paymentId,`unused:${requestKey}`,amount]);
 await c.query('UPDATE entitlements SET remaining_uses=0 WHERE id=$1',[p.entitlement_id]);
 await c.query("UPDATE payments SET status='REFUNDED',updated_at=now() WHERE id=$1",[paymentId]);
 await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'UNUSED_PASS_REFUNDED','payment',$2,$3)",[userId,paymentId,JSON.stringify({amount,uses:Number(p.remaining_uses),originalUses:Number(p.original_uses)})]);
 await queueBusinessEvent(c,{key:`unused-refund:${requestKey}`,kind:'REFUND_COMPLETED',userId,variables:{amount:String(amount)},url:'/payments'});
 await c.query('COMMIT');return {status:'REFUNDED',amount};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
