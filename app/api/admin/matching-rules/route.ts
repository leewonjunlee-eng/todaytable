import {db,databaseProvider} from '@/lib/db';
import {sameOrigin} from '@/lib/http';
import {requestOperator,errorResponse,problem} from '@/lib/operators';
import {effectivePolicy} from '@/lib/matching-policy';
export async function GET(request:Request){try{
 if(!await requestOperator(request))problem('활성 운영자 권한이 필요합니다.',403);
 const p=await effectivePolicy(db,'00000000-0000-4000-8000-000000000000');
 return Response.json({version:p.id,minScore:p.minScore,weights:p.weights,learningEnabled:p.learningEnabled});
}catch(e){return errorResponse(e);}}
/** Compatibility entry point: publish an immutable policy and select it as the default. */
export async function PUT(request:Request){try{
 const me=await requestOperator(request);if(!me||me.team_role!=='OWNER')problem('총괄 운영자 권한이 필요합니다.',403);
 if(!sameOrigin(request))problem('요청 출처를 확인할 수 없습니다.',403);
 const b=await request.json().catch(()=>null);if(!b||typeof b!=='object'||Array.isArray(b))problem('규칙 형식을 확인해 주세요.');const keys=['gender','mbti','interests','traits','novelty'];
 const weights=Object.fromEntries(keys.map(k=>[k,Number(b.weights?.[k])])),values=Object.values(weights);
 if(typeof b.version!=='string'||!/^[A-Za-z0-9._-]{1,40}$/.test(b.version)||!Number.isFinite(b.minScore)||b.minScore<0||b.minScore>1||values.some(x=>!Number.isFinite(x)||x<0||x>1)||Math.abs(values.reduce((a,b)=>a+b,0)-1)>1e-6||b.learningEnabled!==undefined&&typeof b.learningEnabled!=='boolean')problem('규칙 형식이 올바르지 않습니다.');
 const client=await db.connect();try{
  await client.query('BEGIN');if(databaseProvider==='postgres')await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
  const actor=(await client.query<any>('SELECT team_role,active FROM operator_profiles WHERE user_id=$1 FOR UPDATE',[me.id])).rows[0];if(!actor?.active||actor.team_role!=='OWNER')problem('총괄 운영 권한이 변경됐어요.',403);
  if((await client.query('SELECT 1 FROM matching_policies WHERE id=$1',[b.version])).rowCount)problem('이미 사용된 정책 버전입니다.',409);
  await client.query(`INSERT INTO matching_policies(id,name,description,weights,min_score,learning_enabled,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,[b.version,`운영 기준 ${b.version}`,'상세 규칙에서 생성한 정책',JSON.stringify(weights),b.minScore,b.learningEnabled??true,me.id]);
  await client.query('UPDATE matching_defaults SET policy_id=$1,version=version+1 WHERE id=1',[b.version]);
  await client.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'POLICY_DEFAULT','matching_policy',$2,$3)",[me.id,b.version,JSON.stringify(b)]);
  await client.query('COMMIT');return Response.json({version:b.version,minScore:b.minScore,weights});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}catch(e){return errorResponse(e);}}
