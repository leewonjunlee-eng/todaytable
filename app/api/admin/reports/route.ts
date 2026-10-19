import {requestOperator,errorResponse,problem} from '@/lib/operators';
import {operatorReports} from '@/lib/operator-table';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{if(!await requestOperator(request))problem('운영자 권한이 필요합니다.',403);return Response.json({reports:await operatorReports()});}catch(e){return errorResponse(e);}}
