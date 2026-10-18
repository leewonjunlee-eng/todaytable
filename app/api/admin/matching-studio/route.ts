import {createHash,randomUUID} from 'node:crypto';
import {db,databaseProvider} from '@/lib/db';
import {requestOperator,errorResponse,parseJson,problem} from '@/lib/operators';
import {effectivePolicy,matchingInput,evaluatePolicy,type MatchingPolicy} from '@/lib/matching-policy';
import {sameOrigin} from '@/lib/http';
import {isCanonicalUuid} from '@/lib/domain';
export const dynamic='force-dynamic';
const policy=(p:any):MatchingPolicy=>({id:p.id,name:p.name,description:p.description,weights:parseJson(p.weights,{} as any),minScore:Number(p.min_score),learningEnabled:Boolean(p.learning_enabled)});
export async function GET(request:Request){try{
 const me=await requestOperator(request);if(!me)problem('활성 운영자 권한이 필요합니다.',403);
 const [policies,defaults,events,runs]=await Promise.all([
  db.query('SELECT * FROM matching_policies ORDER BY created_at,id'),db.query('SELECT * FROM matching_defaults WHERE id=1'),
  db.query(`SELECT e.id,e.title,e.starts_at,e.application_deadline,e.area,e.status,e.is_demo,ep.policy_id,
   (SELECT count(*) FROM application_options o JOIN applications a ON a.id=o.application_id JOIN payments p ON p.application_id=a.id WHERE o.event_id=e.id AND a.status='SUBMITTED' AND a.matching_status IN ('WAITING','REALLOCATING') AND p.status='PAID') waiting_count,
   (SELECT count(*) FROM dining_tables t WHERE t.event_id=e.id) table_count FROM events e LEFT JOIN event_policies ep ON ep.event_id=e.id WHERE e.starts_at>now() AND e.status IN ('OPEN','CLOSED') ORDER BY e.starts_at`,[],`SELECT e.id,e.title,e.starts_at,e.application_deadline,e.area,e.status,e.is_demo,ep.policy_id,(SELECT count(*) FROM application_options o JOIN applications a ON a.id=o.application_id JOIN payments p ON p.application_id=a.id WHERE o.event_id=e.id AND a.status='SUBMITTED' AND a.matching_status IN ('WAITING','REALLOCATING') AND p.status='PAID') waiting_count,(SELECT count(*) FROM dining_tables t WHERE t.event_id=e.id) table_count FROM events e LEFT JOIN event_policies ep ON ep.event_id=e.id WHERE e.starts_at>CURRENT_TIMESTAMP AND e.status IN ('OPEN','CLOSED') ORDER BY e.starts_at`),
  db.query(`SELECT r.id,r.event_id,r.rule_version,r.matched_count,r.quality_score,r.created_at,e.title,p.name policy_name FROM match_runs r JOIN events e ON e.id=r.event_id LEFT JOIN matching_policies p ON p.id=r.rule_version ORDER BY r.created_at DESC LIMIT 30`),
 ]);
 return Response.json({policies:policies.rows.map(policy),defaults:defaults.rows[0],events:events.rows,runs:runs.rows,me:{id:me.id,role:me.team_role}});
}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))problem('요청 출처를 확인할 수 없어요.',403);const me=await requestOperator(request);if(!me)problem('활성 운영자 권한이 필요합니다.',403);
 const b=await request.json().catch(()=>null);if(!b||typeof b!=='object'||Array.isArray(b))problem('작업 형식을 확인해 주세요.');const client=await db.connect();try{
 await client.query('BEGIN');if(databaseProvider==='postgres')await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
 const actor=(await client.query<any>('SELECT team_role,active FROM operator_profiles WHERE user_id=$1 FOR UPDATE',[me.id])).rows[0];
 if(!actor?.active)problem('운영 권한이 변경됐어요.',403);me.team_role=actor.team_role;
 let result:any={ok:true};
 if(b.action==='PREVIEW'){
  if(!isCanonicalUuid(b.eventId))problem('회차를 선택해 주세요.');
  const input=await matchingInput(client,b.eventId,true,true);if(new Date(input.event.starts_at).getTime()<=Date.now())problem('지난 행사는 다시 매칭하지 않아요.');
  if(input.candidates.length<4 && !b.forcePreview){
    const policies=(await client.query<any>('SELECT * FROM matching_policies ORDER BY created_at,id')).rows.map(policy);const active=await effectivePolicy(client,b.eventId);
    const results=policies.map(p=>evaluatePolicy(input,p));const baseline=results.find(r=>r.policyId===active.id)??evaluatePolicy(input,active);
    const comparisons=results.map(r=>({...r,changedSeats:0,groups:[],matchedCount:0,unmatched:input.candidates.map(c=>c.applicationId),qualityScore:0}));
    const id=randomUUID();
    result={id,snapshotHash:input.hash,eventId:b.eventId,baselinePolicy:active.id,results:comparisons,notice:`이 회차의 대기 인원(${input.candidates.length}명)으로는 4명 이상인 최소 식탁을 만들 수 없습니다. ${4-input.candidates.length}명 이상이 더 필요합니다.`};
  }else{
    const policies=(await client.query<any>('SELECT * FROM matching_policies ORDER BY created_at,id')).rows.map(policy);const active=await effectivePolicy(client,b.eventId);
    const results=policies.map(p=>evaluatePolicy(input,p));const baseline=results.find(r=>r.policyId===active.id)??evaluatePolicy(input,active);
    const baselinePairs=new Set(baseline.groups.flatMap(g=>g.members.flatMap(a=>g.members.filter(m=>m.userId!==a.userId).map(m=>`${a.userId}:${m.userId}`))));
    const named=(await client.query<any>('SELECT user_id,display_name FROM profiles')).rows;const byName=new Map(named.map(p=>[p.user_id,p.display_name]));
    const comparisons=results.map(r=>({...r,changedSeats:r.groups.flatMap(g=>g.members).filter(m=>{const group=r.groups.find(g=>g.members.some(x=>x.userId===m.userId));return group?.members.some(peer=>peer.userId!==m.userId&&!baselinePairs.has(`${m.userId}:${peer.userId}`));}).length,groups:r.groups.map(g=>({...g,members:g.members.map(m=>({...m,name:byName.get(m.userId)??'참가자'}))}))}));
    const id=randomUUID();await client.query('INSERT INTO matching_previews(id,event_id,snapshot_hash,snapshot,results,created_by) VALUES($1,$2,$3,$4,$5,$6)',[id,b.eventId,input.hash,JSON.stringify(input.snapshot),JSON.stringify(comparisons),me.id]);
    result={id,snapshotHash:input.hash,eventId:b.eventId,baselinePolicy:active.id,results:comparisons,notice:input.candidates.length<4?'조건을 만족하는 참가자가 네 명 이상 모이면 식탁을 구성할 수 있어요.':'같은 참가자와 정책이면 결과가 재현됩니다. 후보가 적으면 기조별 결과가 같을 수 있어요.'};
  }
 }else if(b.action==='APPLY'){
  const preview=(await client.query<any>('SELECT * FROM matching_previews WHERE id=$1',[b.previewId])).rows[0];if(!preview)problem('미리보기를 먼저 실행해 주세요.',404);
  const event=(await client.query<any>('SELECT status,starts_at FROM events WHERE id=$1 FOR UPDATE',[preview.event_id])).rows[0];
  if(!event||event.status==='CANCELLED'||new Date(event.starts_at).getTime()<=Date.now())problem('이미 종료되거나 취소된 회차예요.',409);
  if((await client.query('SELECT 1 FROM dining_tables WHERE event_id=$1 LIMIT 1',[preview.event_id])).rowCount)problem('이미 확정된 식탁이 있어요. 이 회차의 기조는 바꿀 수 없습니다.',409);
  if(!(await client.query('SELECT 1 FROM matching_policies WHERE id=$1',[b.policyId])).rowCount)problem('매칭 기조를 확인해 주세요.');
  const results=parseJson<any[]>(preview.results,[]);if(!results.some(r=>r.policyId===b.policyId))problem('비교한 정책만 적용할 수 있어요.');
  const input=await matchingInput(client,preview.event_id,true,true);if(input.hash!==preview.snapshot_hash)problem('참가자나 선호가 바뀌었어요. 미리보기를 다시 실행해 주세요.',409);
  await client.query('INSERT INTO event_policies(event_id,policy_id,preview_hash,applied_by) VALUES($1,$2,$3,$4) ON CONFLICT(event_id) DO UPDATE SET policy_id=excluded.policy_id,preview_hash=excluded.preview_hash,applied_by=excluded.applied_by,applied_at=now()',[preview.event_id,b.policyId,input.hash,me.id]);
  // A changed policy replaces only unapproved recommendations; confirmed tables are guarded above.
  const retired=(await client.query<any>("UPDATE matching_proposals SET status='STALE',version=version+1,review_note='매칭 기조가 변경되어 다시 추천합니다.' WHERE event_id=$1 AND status IN ('PENDING','HELD') RETURNING id",[preview.event_id])).rows;
  for(const p of retired)await client.query("UPDATE applications SET matching_status='WAITING' WHERE matching_status='MATCHING' AND id IN (SELECT application_id FROM matching_proposal_members WHERE proposal_id=$1)",[p.id]);
  await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'MATCH_EVENT',$2,now()) ON CONFLICT(job_key) DO NOTHING`,[`policy-match:${preview.id}:${b.policyId}`,JSON.stringify({eventId:preview.event_id})]);
 }else if(b.action==='DEFAULT'){
  if(me.team_role!=='OWNER')problem('총괄 운영자만 기본 기조를 바꿀 수 있어요.',403);
  if(!(await client.query('SELECT 1 FROM matching_policies WHERE id=$1',[b.policyId])).rowCount)problem('정책을 확인해 주세요.');
  const current=(await client.query<any>('SELECT version FROM matching_defaults WHERE id=1 FOR UPDATE')).rows[0];if(Number(current.version)!==Number(b.version))problem('기본 정책이 변경됐어요. 새로고침 후 다시 시도해 주세요.',409);
  await client.query('UPDATE matching_defaults SET policy_id=$1,version=version+1 WHERE id=1',[b.policyId]);
 }else if(b.action==='CUSTOM_POLICY'){
  if(me.team_role!=='OWNER')problem('총괄 운영자만 정책 버전을 만들 수 있어요.',403);
  if(typeof b.name!=='string'||b.name.length<2||b.name.length>60||typeof b.description!=='string'||b.description.length>500)problem('기조 이름과 설명을 확인해 주세요.');
  const keys=['gender','mbti','interests','traits','novelty'];const weights=Object.fromEntries(keys.map(k=>[k,Number(b.weights?.[k])])),values=Object.values(weights);
  if(values.some(v=>!Number.isFinite(v)||v<0||v>1)||Math.abs(values.reduce((a,b)=>a+b,0)-1)>1e-6||!Number.isFinite(b.minScore)||b.minScore<0||b.minScore>1||typeof b.learningEnabled!=='boolean')problem('가중치의 합은 1, 점수는 0~1이어야 해요.');
  const id=`custom-${randomUUID()}`;await client.query('INSERT INTO matching_policies(id,name,description,weights,min_score,learning_enabled,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,b.name,b.description,JSON.stringify(weights),b.minScore,b.learningEnabled,me.id]);result={id};
 }else problem('지원하지 않는 작업입니다.');
 await client.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'matching_policy',$3,$4)",[me.id,`POLICY_${b.action}`,b.eventId??b.policyId??result.id,JSON.stringify({...b,...(b.action==='PREVIEW'?{snapshotHash:result.snapshotHash}: {})})]);
 await client.query('COMMIT');return Response.json(result);
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}catch(e){return errorResponse(e);}}