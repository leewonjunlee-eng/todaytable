import {registerDeletion} from '@/lib/account-deletion';
import {db} from '@/lib/db';
import {apiUser} from '@/lib/auth';
import {sameOrigin} from '@/lib/http';
import {createTicket,supportIdentity} from '@/lib/support';
import {errorResponse} from '@/lib/operators';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'요청 출처를 확인할 수 없습니다.'},{status:403});
 const user=await apiUser(request);if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});
 const b=await request.json().catch(()=>({}));if(b.confirmed!==true)return Response.json({error:'처리 안내를 확인해 주세요.'},{status:400});
 try{const existing=(await db.query<any>("SELECT ticket_id,status FROM deletion_requests WHERE user_id=$1 AND status<>'COMPLETED'",[user.id])).rows[0];if(existing)return Response.json({id:existing.ticket_id,status:existing.status});const result=await createTicket(await supportIdentity(request,false,false),{requestKey:b.requestKey,category:'OTHER',subject:'회원 탈퇴 및 개인정보 삭제 요청',body:'회원 탈퇴와 개인정보 삭제를 요청합니다. 진행 중인 참가·환불·안전 문의 및 보관이 필요한 기록을 확인한 뒤, 삭제 범위와 처리 결과를 이 문의함에서 안내해 주세요.'});await registerDeletion(user.id,result.id);return Response.json({id:result.id,status:'REQUESTED'},{status:result.created?201:200});}catch(e){return errorResponse(e);}
}
