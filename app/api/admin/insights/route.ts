import {db} from '@/lib/db';
import {requestOperator,errorResponse,problem} from '@/lib/operators';
import {feedbackInsights,type InsightSource} from '@/lib/insights';
export const dynamic='force-dynamic';
function day(value:string){
 const parsed=new Date(`${value}T00:00:00Z`);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)problem('조회 날짜를 확인해 주세요.');
 return new Date(`${value}T00:00:00+09:00`);
}
export async function GET(request:Request){try{
 if(!await requestOperator(request))problem('활성 운영자 권한이 필요합니다.',403);
 const params=new URL(request.url).searchParams,source=params.get('source')??'real';
 if(!['real','demo','all'].includes(source))problem('조회 자료 구분을 확인해 주세요.');
 const from=day(params.get('from')??new Date(Date.now()-90*86400000).toISOString().slice(0,10));
 const end=day(params.get('to')??new Date().toISOString().slice(0,10));const to=new Date(end.getTime()+86400000);
 if(from>=to)problem('조회 시작일과 종료일을 확인해 주세요.');
 return Response.json(await feedbackInsights(db,source as InsightSource,from.toISOString(),to.toISOString()));
}catch(e){return errorResponse(e);}}
