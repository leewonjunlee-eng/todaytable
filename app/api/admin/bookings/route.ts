import {requestOperator,problem,errorResponse} from '@/lib/operators';
import {sameOrigin} from '@/lib/http';
import {bookingBoard,updateBooking} from '@/lib/venue-bookings';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{if(!await requestOperator(request))problem('운영자 권한이 필요합니다.',403);return Response.json(await bookingBoard());}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{if(!sameOrigin(request))problem('요청 출처를 확인해 주세요.',403);const me=await requestOperator(request);if(!me)problem('운영자 권한이 필요합니다.',403);return Response.json(await updateBooking(me.id,await request.json()));}catch(e){return errorResponse(e);}}
