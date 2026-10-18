import {matchingReviewQueue,decideMatchingProposal,generateMatchingProposals} from '@/lib/matching-review';
import {requestOperator,problem,errorResponse} from '@/lib/operators';
import {sameOrigin} from '@/lib/http';
import {isCanonicalUuid} from '@/lib/domain';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{if(!await requestOperator(r))problem('운영자 권한이 필요합니다.',403);return Response.json(await matchingReviewQueue());}catch(e){return errorResponse(e);}}
export async function POST(r:Request){try{if(!sameOrigin(r))problem('요청 출처를 확인해 주세요.',403);const me=await requestOperator(r);if(!me)problem('운영자 권한이 필요합니다.',403);const b=await r.json().catch(()=>({}));if(b.action==='GENERATE'){if(!isCanonicalUuid(b.eventId))problem('일정을 선택해 주세요.');return Response.json(await generateMatchingProposals(b.eventId));}if(!isCanonicalUuid(b.id))problem('검토할 매칭을 선택해 주세요.');return Response.json(await decideMatchingProposal(me.id,b.id,b));}catch(e){return errorResponse(e);}}
