import {NextResponse} from 'next/server';
import {supportIdentity,listSupport,createTicket,limitSupport} from '@/lib/support';
import {sameOrigin} from '@/lib/http';
import {errorResponse,problem} from '@/lib/operators';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{return NextResponse.json(await listSupport(await supportIdentity(request)));}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))problem('요청 출처를 확인할 수 없어요.',403);
 const b=await request.json().catch(()=>({}));if(b.website)problem('접수 정보를 확인해 주세요.');await limitSupport(request);
 const who=await supportIdentity(request,true),result=await createTicket(who,b);
 const response=NextResponse.json(result,{status:result.created?201:200});
 if(who.cookieToken)response.cookies.set('todaytable_support',who.cookieToken,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:30*86400});
 return response;
}catch(e){return errorResponse(e);}}
