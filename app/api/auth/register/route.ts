import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {hashPassword,newSessionToken,requireSecret,tokenHash} from '@/lib/security';
import {sameOrigin} from '@/lib/http';
export const runtime='nodejs';
export async function POST(request:Request){
 if(!sameOrigin(request))return NextResponse.json({error:'요청 출처를 확인할 수 없습니다.'},{status:403});
 let body:any;try{body=await request.json();}catch{return NextResponse.json({error:'아이디와 비밀번호를 확인해 주세요.'},{status:400});}
 const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
 if(!/^[a-z0-9][a-z0-9._+-]*@[a-z0-9][a-z0-9.-]*$/.test(email)||email.length>120||typeof body?.password!=='string'||body.password.length<8||body.password.length>200)return NextResponse.json({error:'이메일 형식의 아이디와 8자 이상의 비밀번호를 입력해 주세요.'},{status:400});
 const client=await db.connect();
 try{
  requireSecret();
  const passwordHash=await hashPassword(body.password),token=newSessionToken();
  await client.query('BEGIN');
  const result=await client.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'PARTICIPANT') ON CONFLICT(email) DO NOTHING RETURNING id",[email,passwordHash]);
  if(!result.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'이미 사용 중인 아이디예요. 다른 아이디를 선택해 주세요.'},{status:409});}
  const userId=result.rows[0].id;
  await client.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')",[userId,tokenHash(token)],"INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,datetime('now','+7 days'))");
  await client.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,'ACCOUNT_CREATED','user',$2)",[userId,userId]);
  await client.query('COMMIT');
  const response=NextResponse.json({ok:true,role:'PARTICIPANT',next:'/profile/test'},{status:201});
  response.cookies.set('todaytable_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:60*60*24*7});return response;
 }catch{await client.query('ROLLBACK').catch(()=>{});return NextResponse.json({error:'가입하지 못했어요. 잠시 후 다시 시도해 주세요.'},{status:500});}finally{client.release();}
}
