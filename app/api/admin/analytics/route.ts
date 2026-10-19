import {requestOperator,problem,errorResponse} from '@/lib/operators';
import {operationsAnalytics} from '@/lib/operations-analytics';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{if(!await requestOperator(request))problem('운영자 권한이 필요합니다.',403);return Response.json(await operationsAnalytics(new URL(request.url).searchParams));}catch(e){return errorResponse(e);}}
