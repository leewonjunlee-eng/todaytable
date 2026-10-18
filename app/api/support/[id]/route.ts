import {NextResponse} from 'next/server';
import {supportIdentity,supportDetail,mutateSupport} from '@/lib/support';
import {sameOrigin} from '@/lib/http';
import {errorResponse,problem} from '@/lib/operators';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,c:Context){try{return NextResponse.json(await supportDetail((await c.params).id,await supportIdentity(request,false,new URL(request.url).searchParams.get('view')==='operator')));}catch(e){return errorResponse(e);}}
export async function POST(request:Request,c:Context){try{if(!sameOrigin(request))problem('요청 출처를 확인할 수 없어요.',403);return NextResponse.json(await mutateSupport((await c.params).id,await supportIdentity(request,false,new URL(request.url).searchParams.get('view')==='operator'),await request.json().catch(()=>({}))));}catch(e){return errorResponse(e);}}
