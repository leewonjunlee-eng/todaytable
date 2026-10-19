import {NextResponse} from 'next/server';
import {apiUser} from '@/lib/auth';
import {sameOrigin} from '@/lib/http';
import {recruitingEvents,participantAvailability,registerAvailability} from '@/lib/availability';
import {REGIONS} from '@/lib/domain';
import {errorResponse} from '@/lib/operators';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=await apiUser(request);if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401});
 const events=await recruitingEvents();return NextResponse.json({events,days:[...new Set(events.map(e=>e.day))],areas:[...new Set(events.map(e=>e.area))],registrations:await participantAvailability(user.id)});
}
export async function POST(request:Request){
 const user=await apiUser(request);if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401});
 if(!sameOrigin(request))return NextResponse.json({error:'요청 출처를 확인해 주세요.'},{status:403});
 try{const result=await registerAvailability(user.id,await request.json());return NextResponse.json(result,{status:result.created?201:200});}catch(e){return errorResponse(e);}
}
