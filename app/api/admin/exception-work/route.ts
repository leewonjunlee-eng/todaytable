import {randomUUID} from 'node:crypto';
import {db} from '@/lib/db';
import {isCanonicalUuid} from '@/lib/domain';
import {sameOrigin} from '@/lib/http';
import {requestOperator,problem,errorResponse} from '@/lib/operators';
export async function POST(request:Request){
 try{
  const operator=await requestOperator(request);if(!operator)problem('운영자 권한이 필요합니다.',403);
  if(!sameOrigin(request))problem('요청 출처를 확인해 주세요.',403);
  const body=await request.json().catch(()=>({}));
  if(!isCanonicalUuid(body.tableId)||!isCanonicalUuid(body.exceptionId)||!['START','STOP'].includes(body.action))problem('작업 형식을 확인해 주세요.');
  const table=await db.query<any>('SELECT event_id FROM dining_tables WHERE id=$1',[body.tableId]);if(!table.rowCount)problem('식탁을 찾을 수 없습니다.',404);
  const exception=await db.query<any>('SELECT status FROM lifecycle_exceptions WHERE id=$1 AND entity_id IN ($2,$3)',[body.exceptionId,body.tableId,table.rows[0].event_id]);if(!exception.rowCount)problem('이 식탁의 예외를 찾을 수 없습니다.',404);
  if(body.action==='START'){
   if(exception.rows[0].status==='RESOLVED')problem('해결된 예외는 작업을 시작할 수 없습니다.',409);
   const active=await db.query<any>('SELECT operator_id FROM operator_work_sessions WHERE exception_id=$1 AND ended_at IS NULL',[body.exceptionId]);
   if(active.rowCount)problem(active.rows[0].operator_id===operator.id?'이미 작업 시간을 기록 중입니다.':'다른 운영자가 작업 시간을 기록 중입니다.',409);
   try{await db.query('INSERT INTO operator_work_sessions(id,exception_id,table_id,operator_id) VALUES($1,$2,$3,$4)',[randomUUID(),body.exceptionId,body.tableId,operator.id]);}catch(error){if(String(error).includes('UNIQUE')||String(error).includes('duplicate key'))problem('이미 작업 시간을 기록 중입니다.',409);throw error;}
  }else{
   const stopped=await db.query('UPDATE operator_work_sessions SET ended_at=CURRENT_TIMESTAMP WHERE exception_id=$1 AND table_id=$2 AND operator_id=$3 AND ended_at IS NULL',[body.exceptionId,body.tableId,operator.id]);
   if(!stopped.rowCount)problem('진행 중인 내 작업 기록을 찾을 수 없습니다.',409);
  }
  return Response.json({ok:true});
 }catch(error){return errorResponse(error);}
}
