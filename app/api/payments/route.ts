import {NextResponse} from 'next/server';
import {apiUser} from '@/lib/auth';
import {sameOrigin} from '@/lib/http';
import {paymentHistory,refundUnusedPass} from '@/lib/virtual-transactions';
export async function GET(request:Request){const user=await apiUser(request);if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401});return NextResponse.json(await paymentHistory(user.id));}
export async function POST(request:Request){const user=await apiUser(request);if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401});if(!sameOrigin(request))return NextResponse.json({error:'요청 출처를 확인해 주세요.'},{status:403});try{const b=await request.json();return NextResponse.json(await refundUnusedPass(user.id,b.paymentId,b.requestKey));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'환불하지 못했어요.'},{status:400});}}
