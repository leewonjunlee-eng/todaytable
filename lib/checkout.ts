import {randomUUID} from 'node:crypto';
import {db,type QueryClient} from './db';
import {problem,parseJson} from './operators';
export async function openCheckout(userId:string,selection:{dates:string[];areas:string[];pass:string}){
 if(!['SINGLE','THREE_PASS','EXISTING_PASS'].includes(selection.pass))problem('참가권을 확인해 주세요.');
 const id=randomUUID(),expires=new Date(Date.now()+30*60000);
 await db.query("INSERT INTO checkout_sessions(id,user_id,selection,status,expires_at) VALUES($1,$2,$3,'PENDING',$4)",[id,userId,JSON.stringify(selection),expires]);return {id,expiresAt:expires.toISOString(),...selection};
}
export async function resumeCheckout(userId:string){
 await db.query("UPDATE checkout_sessions SET status='EXPIRED',updated_at=now() WHERE user_id=$1 AND expires_at<=now() AND status IN ('PENDING','FAILED','CANCELED')",[userId]);
 const row=(await db.query<any>("SELECT * FROM checkout_sessions WHERE user_id=$1 AND status IN ('PENDING','FAILED','CANCELED') AND expires_at>now() ORDER BY created_at DESC,id DESC LIMIT 1",[userId])).rows[0];
 return row?{id:row.id,status:row.status,expiresAt:row.expires_at,...parseJson<any>(row.selection,{})}:null;
}
export async function checkoutGate(c:QueryClient,userId:string,id:string,selection:any){
 const row=(await c.query<any>('SELECT * FROM checkout_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId])).rows[0];
 if(row?.status==='COMPLETED')problem('이미 완료된 결제입니다. 신청 내역을 확인해 주세요.',409);
 if(!row||row.status==='EXPIRED'||+new Date(row.expires_at)<=Date.now())problem('결제 대기 시간이 만료됐어요. 일정을 다시 선택해 주세요.',409);
 const stored=parseJson<any>(row.selection,{});
 if(stored.pass!==selection.pass||JSON.stringify(stored.dates)!==JSON.stringify(selection.dates)||JSON.stringify(stored.areas)!==JSON.stringify(selection.areas))problem('결제 대기 내용이 변경됐어요. 일정을 다시 확인해 주세요.',409);
 return row;
}
