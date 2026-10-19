import {requestOperator,problem,errorResponse} from '@/lib/operators';
import {sameOrigin} from '@/lib/http';
import {db} from '@/lib/db';
import {processDeletion} from '@/lib/account-deletion';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{if(!await requestOperator(r))problem('운영자 권한이 필요합니다.',403);return Response.json((await db.query('SELECT d.*,u.email FROM deletion_requests d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC')).rows);}catch(e){return errorResponse(e);}}
export async function POST(r:Request){try{const user=await requestOperator(r);if(!user)problem('운영자 권한이 필요합니다.',403);if(!sameOrigin(r))problem('요청 출처를 확인해 주세요.',403);const b=await r.json();return Response.json(await processDeletion(user.id,b.id,b.version,b.action,b.reason));}catch(e){return errorResponse(e);}}
