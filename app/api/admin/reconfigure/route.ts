import {requestOperator,problem,errorResponse} from '@/lib/operators';
import {sameOrigin} from '@/lib/http';
import {reconfigureTables} from '@/lib/operator-reconfigure';
export async function POST(request:Request){try{if(!sameOrigin(request))problem('요청 출처를 확인해 주세요.',403);const me=await requestOperator(request);if(!me)problem('운영자 권한이 필요합니다.',403);return Response.json(await reconfigureTables(me.id,await request.json()));}catch(e){return errorResponse(e);}}
