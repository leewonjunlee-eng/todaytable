import {requestOperator,errorResponse,problem} from '@/lib/operators';
import {operatorTable} from '@/lib/operator-table';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const operator=await requestOperator(request);if(!operator)problem('운영자 권한이 필요합니다.',403);return Response.json({...await operatorTable((await params).id),operatorId:operator.id});}catch(e){return errorResponse(e);}}
