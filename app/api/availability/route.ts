import {db} from '@/lib/db';
import {NextResponse} from 'next/server';
import {apiUser} from '@/lib/auth';
import {sameOrigin} from '@/lib/http';
import {recruitingEvents,participantAvailability,registerAvailability} from '@/lib/availability';
import {REGIONS} from '@/lib/domain';
import {errorResponse} from '@/lib/operators';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=await apiUser(request);if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401});
 const profile=(await db.query<any>('SELECT gender,consent_privacy,consent_operations FROM profiles WHERE user_id=$1',[user.id])).rows[0];
 const canApply=Boolean(profile?.consent_privacy&&profile?.consent_operations&&['MAN','WOMAN'].includes(profile.gender));
 const events=await recruitingEvents();return NextResponse.json({eligibility:{canApply,reason:canApply?'':'현재 성비 기준으로 신청하려면 프로필의 성별과 필수 동의를 먼저 확인해 주세요.'},events,days:[...new Set(events.map(e=>e.day))],areas:[...new Set(events.map(e=>e.area))],registrations:await participantAvailability(user.id)});
}
export async function POST(request:Request){
 const user=await apiUser(request);if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401});
 if(!sameOrigin(request))return NextResponse.json({error:'요청 출처를 확인해 주세요.'},{status:403});
 try{const result=await registerAvailability(user.id,await request.json());return NextResponse.json(result,{status:result.created?201:200});}catch(e){return errorResponse(e);}
}
