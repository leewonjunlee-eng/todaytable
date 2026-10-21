import {loginDestination} from '@/lib/login-destination';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { newSessionToken, requireSecret, tokenHash, verifyPassword } from '@/lib/security';
import { sameOrigin } from '@/lib/http';
import { isOperatorHost } from '@/lib/site-origins';
export const runtime='nodejs';
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
    requireSecret();
    const body=await request.json();
    if (typeof body.email!=='string' || typeof body.password!=='string' || body.password.length>200) return NextResponse.json({error:'아이디와 비밀번호를 입력해 주세요.'},{status:400});
    const {rows}=await db.query<{id:string;email:string;role:string;password_hash:string;restricted_status:string}>('SELECT id,email,role,password_hash,restricted_status FROM users WHERE email=$1',[body.email.trim().toLowerCase()]);
    if (!rows[0] || rows[0].restricted_status!=='ACTIVE' || !(await verifyPassword(body.password,rows[0].password_hash))) return NextResponse.json({error:'아이디 또는 비밀번호를 확인해 주세요.'},{status:401});
    const operatorLogin=body.audience==='operator'||isOperatorHost(request.headers,request.url);
    if(operatorLogin){
      const activeOperator=rows[0].role==='ADMIN'&&(await db.query('SELECT 1 FROM operator_profiles WHERE user_id=$1 AND active=true',[rows[0].id])).rowCount;
      if(!activeOperator)return NextResponse.json({error:'활성 운영자 계정으로 로그인해 주세요.'},{status:403});
    }
    const token=newSessionToken();
    await db.query(
      'INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'7 days\')',
      [rows[0].id,tokenHash(token)],
      "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,datetime('now','+7 days'))",
    );
    const profile=rows[0].role==='PARTICIPANT'?(await db.query('SELECT 1 FROM profiles WHERE user_id=$1',[rows[0].id])).rowCount:1;
    const destination=loginDestination(body.next,operatorLogin);
    const response=NextResponse.json({role:rows[0].role,next:profile?(destination??(operatorLogin?'/admin':'/')):destination?`/profile/test?next=${encodeURIComponent(destination)}`:'/profile/test'});
    response.cookies.set('todaytable_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:60*60*24*7});
    return response;
  } catch { return NextResponse.json({error:'로그인할 수 없습니다.'},{status:500}); }
}
