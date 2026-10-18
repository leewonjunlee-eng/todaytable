import {NextResponse} from 'next/server';
import {apiUser} from '@/lib/auth';
import {sameOrigin} from '@/lib/http';
import {availabilityDays,participantAvailability,registerAvailability} from '@/lib/availability';
import {REGIONS} from '@/lib/domain';
import {errorResponse} from '@/lib/operators';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=await apiUser(request);if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401});
 return NextResponse.json({days:availabilityDays(),areas:REGIONS,registrations:await participantAvailability(user.id),meetingTime:'19:30–21:30'});
}
export async function POST(request:Request){
 const user=await apiUser(request);if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401});
 if(!sameOrigin(request))return NextResponse.json({error:'요청 출처를 확인해 주세요.'},{status:403});
 try{const result=await registerAvailability(user.id,await request.json());return NextResponse.json(result,{status:result.created?201:200});}catch(e){return errorResponse(e);}
}
