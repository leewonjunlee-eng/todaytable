import {requestOperator} from '@/lib/operators';
import {venueCatalog} from '@/lib/venues';
export const dynamic='force-dynamic';
export async function GET(request:Request){if(!await requestOperator(request))return Response.json({error:'운영자 권한이 필요합니다.'},{status:403});return Response.json({venues:await venueCatalog(undefined,true)});}
