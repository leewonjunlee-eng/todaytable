import {hasRecruitmentSelection} from '@/lib/recruitment-selection';
import {apiUser} from '@/lib/auth';
import {sameOrigin} from '@/lib/http';
import {validateAvailability,recruitingEvents} from '@/lib/availability';
import {openCheckout,resumeCheckout} from '@/lib/checkout';
import {problem,errorResponse} from '@/lib/operators';
export const dynamic='force-dynamic';
export async function GET(r:Request){const user=await apiUser(r);if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});return Response.json(await resumeCheckout(user.id));}
export async function POST(r:Request){try{const user=await apiUser(r);if(!user)problem('로그인이 필요합니다.',401);if(!sameOrigin(r))problem('요청 출처를 확인해 주세요.',403);const b=await r.json(),selection=validateAvailability(b),events=await recruitingEvents();if(!hasRecruitmentSelection(events,selection.dates,selection.areas))problem('모집 중인 회차를 선택해 주세요.');return Response.json(await openCheckout(user.id,{...selection,pass:b.pass}),{status:201});}catch(e){return errorResponse(e);}}
