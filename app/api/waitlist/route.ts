import {apiUser} from '@/lib/auth';
import {sameOrigin} from '@/lib/http';
import {errorResponse} from '@/lib/operators';
import {participantOffers,respondToOffer} from '@/lib/waitlist';
import {isCanonicalUuid} from '@/lib/domain';
export const dynamic='force-dynamic';
export async function GET(request:Request){const user=await apiUser(request);if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});return Response.json({offers:await participantOffers(user.id)});}
export async function POST(request:Request){if(!sameOrigin(request))return Response.json({error:'요청 출처를 확인할 수 없습니다.'},{status:403});const user=await apiUser(request);if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});const b=await request.json().catch(()=>({}));if(!isCanonicalUuid(b.id)||typeof b.accept!=='boolean')return Response.json({error:'참가 여부를 확인해 주세요.'},{status:400});try{return Response.json(await respondToOffer(user.id,b.id,b.accept));}catch(e){return errorResponse(e);}}
