import {apiUser} from '@/lib/auth';
import {db,databaseProvider} from '@/lib/db';
import {sameOrigin} from '@/lib/http';
import {ATMOSPHERES,normalizeInterests} from '@/lib/feedback-domain';
import {errorResponse,parseJson,problem} from '@/lib/operators';
import {updatePreferenceSignals} from '@/lib/feedback-service';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const user=await apiUser(request);if(!user)problem('로그인이 필요합니다.',401);
 const p=(await db.query<any>('SELECT * FROM participant_preferences WHERE user_id=$1',[user.id])).rows[0];
 const s=(await db.query<any>('SELECT evidence_count,confidence FROM preference_signals WHERE user_id=$1',[user.id])).rows[0];
 return Response.json({atmosphere:p?.atmosphere??'BALANCED',interests:normalizeInterests(parseJson(p?.interests,[])),confirmed:p?.confirmed??false,learningEnabled:p?.learning_enabled??true,evidenceCount:Number(s?.evidence_count??0),confidence:Number(s?.confidence??0),minimumEvidence:3,maxInfluence:.1});
}catch(e){return errorResponse(e);}}
export async function PUT(request:Request){try{
 const user=await apiUser(request);if(!user)problem('로그인이 필요합니다.',401);if(!sameOrigin(request))problem('요청 출처를 확인할 수 없습니다.',403);
 const b=await request.json().catch(()=>null);if(!b||typeof b!=='object'||Array.isArray(b))problem('선호 형식을 확인해 주세요.');
 if(typeof b.learningEnabled!=='boolean'||typeof b.confirmed!=='boolean'||typeof b.atmosphere!=='string'||!Object.hasOwn(ATMOSPHERES,b.atmosphere)||!Array.isArray(b.interests)||b.interests.length>10||b.interests.some((v:unknown)=>typeof v!=='string'||!v.trim()||v.length>60)||new Set(b.interests).size!==b.interests.length)problem('다음 만남 선호를 확인해 주세요.');
 const client=await db.connect();try{
  await client.query('BEGIN');if(databaseProvider==='postgres')await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
  await client.query(`INSERT INTO participant_preferences(user_id,atmosphere,interests,confirmed,learning_enabled) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(user_id) DO UPDATE SET atmosphere=excluded.atmosphere,interests=excluded.interests,confirmed=excluded.confirmed,
    learning_enabled=excluded.learning_enabled,source_feedback_id=NULL,updated_at=CURRENT_TIMESTAMP`,[user.id,b.atmosphere,JSON.stringify(normalizeInterests(b.interests)),b.confirmed&&b.learningEnabled,b.learningEnabled]);
  await updatePreferenceSignals(client,user.id);await client.query('COMMIT');return Response.json({ok:true});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}catch(e){return errorResponse(e);}}
