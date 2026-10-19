import {requestOperator,errorResponse,problem} from '@/lib/operators';
import {operatorWorkspace} from '@/lib/operator-workspace';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{if(!await requestOperator(request))problem('운영자 권한이 필요합니다.',403);const view=new URL(request.url).searchParams.get('view')??'applications';if(!['applications','matched','past'].includes(view))problem('조회할 현황을 확인해 주세요.');return Response.json(await operatorWorkspace(view));}catch(e){return errorResponse(e);}}
