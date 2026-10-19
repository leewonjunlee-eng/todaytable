import {createHash} from 'node:crypto';
import {apiUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {sameOrigin} from '@/lib/http';
import {errorResponse} from '@/lib/operators';
export async function POST(request:Request){
 try{
  const user=await apiUser(request);
  if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});
  if(!sameOrigin(request))return Response.json({error:'요청 출처를 확인해 주세요.'},{status:403});
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const id=createHash('sha256').update(`APPLICATION_STARTED:${user.id}:${day}`).digest('hex');
  await db.query("INSERT INTO product_events(id,user_id,event_type,is_demo) SELECT $1,id,'APPLICATION_STARTED',is_demo FROM users WHERE id=$2 ON CONFLICT(id) DO NOTHING",[id,user.id]);
  return Response.json({recorded:true});
 }catch(error){return errorResponse(error);}
}
