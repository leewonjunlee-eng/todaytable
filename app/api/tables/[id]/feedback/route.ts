import { randomUUID } from 'node:crypto';
import { apiUser } from '@/lib/auth';
import { db, databaseProvider, type QueryClient } from '@/lib/db';
import { sameOrigin } from '@/lib/http';
import { isCanonicalUuid } from '@/lib/domain';
import { ATMOSPHERES, FEEDBACK_TAGS, normalizeInterests } from '@/lib/feedback-domain';
import { errorResponse, parseJson, problem } from '@/lib/operators';
import { updatePreferenceSignals } from '@/lib/feedback-service';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function membership(client: Pick<QueryClient,'query'>, id: string, userId: string) {
  const row = (await client.query<any>(`SELECT e.starts_at,e.ends_at,e.is_demo,a.is_demo application_demo,u.is_demo user_demo,ar.status attendance_status,
    t.status table_status,t.venue_id,tm.application_id FROM table_members tm
    JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id
    JOIN applications a ON a.id=tm.application_id JOIN users u ON u.id=tm.user_id
    LEFT JOIN attendance_records ar ON ar.application_id=tm.application_id AND ar.event_id=e.id
    WHERE tm.table_id=$1 AND tm.user_id=$2 AND tm.status='ACTIVE'`, [id,userId])).rows[0];
  if (!row) problem('식탁을 찾을 수 없습니다.',404);
  return {...row,is_demo:Boolean(row.is_demo||row.application_demo||row.user_demo)};
}
export async function GET(request: Request, context: Context) {
  try {
    const user=await apiUser(request); if(!user)problem('로그인이 필요합니다.',401);
    const {id}=await context.params; if(!isCanonicalUuid(id))problem('식탁을 찾을 수 없습니다.',404);
    await membership(db,id,user.id);
    const f=(await db.query<any>(`SELECT f.*,d.positives,d.improvements,d.good_text,d.improve_text,
      d.next_atmosphere,d.next_interests,d.preference_confirmed FROM journey_feedback f
      LEFT JOIN feedback_details d ON d.feedback_id=f.id WHERE f.table_id=$1 AND f.author_user_id=$2`,[id,user.id])).rows[0];
    const pref=(await db.query<any>('SELECT learning_enabled FROM participant_preferences WHERE user_id=$1',[user.id])).rows[0];
    if(!f)return Response.json({feedback:null,learningEnabled:pref?.learning_enabled??true});
    const publicReview=(await db.query<any>('SELECT body FROM venue_public_reviews WHERE feedback_id=$1',[f.id])).rows[0];
    const rel=(await db.query<any>('SELECT target_user_id,relationship_type FROM feedback_relationships WHERE table_id=$1 AND source_user_id=$2',[id,user.id])).rows;
    return Response.json({feedback:{id:f.id,tableScore:f.table_score,conversationScore:f.conversation_score,venueScore:f.venue_score,
      publishVenueReview:Boolean(publicReview),venueReview:publicReview?.body??'',returnIntent:Boolean(f.return_intent),recommendIntent:Boolean(f.recommend_intent),comment:f.comment,
      positives:parseJson(f.positives,[]),improvements:parseJson(f.improvements,[]),goodText:f.good_text??'',improveText:f.improve_text??'',
      nextAtmosphere:f.next_atmosphere??'BALANCED',nextInterests:normalizeInterests(parseJson(f.next_interests,[])),preferenceConfirmed:f.preference_confirmed??false,
      likedUserIds:rel.filter(r=>r.relationship_type==='LIKE').map(r=>r.target_user_id),
      dislikedUserIds:rel.filter(r=>r.relationship_type==='DISLIKE').map(r=>r.target_user_id)},learningEnabled:pref?.learning_enabled??true});
  }catch(e){return errorResponse(e);}
}
function stringArray(value:unknown,max:number,allowed?:(value:string)=>boolean):string[] {
  if(!Array.isArray(value)||value.length>max||value.some(x=>typeof x!=='string'||x.length<1||x.length>60||allowed&&!allowed(x))||new Set(value).size!==value.length)problem('후기 선택 항목을 확인해 주세요.');
  return value;
}
async function mutate(request:Request,context:Context,remove=false){
  try {
    const user=await apiUser(request);if(!user)problem('로그인이 필요합니다.',401);
    if(!sameOrigin(request))problem('요청 출처를 확인할 수 없습니다.',403);
    const {id}=await context.params;if(!isCanonicalUuid(id))problem('식탁을 찾을 수 없습니다.',404);
    const b=remove?{}:await request.json().catch(()=>null);if(!b||typeof b!=='object')problem('후기 형식을 확인해 주세요.');
    const client=await db.connect();try{
      await client.query('BEGIN');
      if(databaseProvider==='postgres')await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
      const access=await membership(client,id,user.id);
      if(!remove){
        const end=new Date(access.ends_at??new Date(new Date(access.starts_at).getTime()+7200000)).getTime();
        if(Date.now()<end)problem('행사 종료 후 작성할 수 있습니다.');
        if(access.attendance_status!=='ATTENDED')problem('참석이 확인된 분만 후기를 작성할 수 있습니다.',403);
        const scores=[b.tableScore,b.conversationScore,b.venueScore];
        if(scores.some(x=>!Number.isInteger(x)||x<1||x>5)||typeof b.returnIntent!=='boolean'||typeof b.recommendIntent!=='boolean')problem('점수와 재참여 의견을 확인해 주세요.');
        for(const name of ['comment','goodText','improveText'])if(b[name]!==undefined&&(typeof b[name]!=='string'||b[name].length>2000))problem('메모는 2,000자 이내로 입력해 주세요.');
        if(b.publishVenueReview!==undefined&&typeof b.publishVenueReview!=='boolean')problem('식당 후기 공개 여부를 확인해 주세요.');
        if(b.publishVenueReview===true&&(!access.venue_id||typeof b.venueReview!=='string'||b.venueReview.trim().length<5||b.venueReview.length>1000))problem('공개할 식당 후기를 5~1,000자로 남겨주세요.');
        const positives=stringArray(b.positives??[],7,x=>Object.hasOwn(FEEDBACK_TAGS,x)),improvements=stringArray(b.improvements??[],7,x=>Object.hasOwn(FEEDBACK_TAGS,x));
        const interests=normalizeInterests(stringArray(b.nextInterests??[],10)),atmosphere=b.nextAtmosphere??'BALANCED';
        if(typeof atmosphere!=='string'||!Object.hasOwn(ATMOSPHERES,atmosphere))problem('다음 대화 분위기를 확인해 주세요.');
        for(const name of ['preferenceConfirmed','learningEnabled'])if(b[name]!==undefined&&typeof b[name]!=='boolean')problem('개인화 동의 항목을 확인해 주세요.');
        const likes=stringArray(b.likedUserIds??[],5,isCanonicalUuid),dislikes=stringArray(b.dislikedUserIds??[],5,isCanonicalUuid);
        const peers=new Set((await client.query<any>("SELECT user_id FROM table_members WHERE table_id=$1 AND status='ACTIVE' AND user_id<>$2",[id,user.id])).rows.map(r=>r.user_id));
        if([...likes,...dislikes].some(x=>!peers.has(x))||new Set([...likes,...dislikes]).size!==likes.length+dislikes.length)problem('다른 식탁 멤버만 중복 없이 선택해 주세요.');
        const feedbackId=(await client.query<any>(`INSERT INTO journey_feedback(id,table_id,author_user_id,table_score,conversation_score,venue_score,return_intent,recommend_intent,comment,is_demo)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(table_id,author_user_id) DO UPDATE SET table_score=excluded.table_score,
          conversation_score=excluded.conversation_score,venue_score=excluded.venue_score,return_intent=excluded.return_intent,recommend_intent=excluded.recommend_intent,
          comment=excluded.comment,is_demo=excluded.is_demo RETURNING id`,[randomUUID(),id,user.id,...scores,b.returnIntent,b.recommendIntent,b.comment??'',access.is_demo])).rows[0].id;
        if(b.publishVenueReview===true)await client.query(`INSERT INTO venue_public_reviews(id,venue_id,author_user_id,table_id,feedback_id,score,body,is_demo) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(feedback_id) DO UPDATE SET score=excluded.score,body=excluded.body,updated_at=now()`,[randomUUID(),access.venue_id,user.id,id,feedbackId,b.venueScore,b.venueReview.trim(),access.is_demo]);
        else await client.query('DELETE FROM venue_public_reviews WHERE feedback_id=$1',[feedbackId]);
        await client.query(`INSERT INTO feedback_details(feedback_id,positives,improvements,good_text,improve_text,next_atmosphere,next_interests,preference_confirmed)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(feedback_id) DO UPDATE SET positives=excluded.positives,improvements=excluded.improvements,
          good_text=excluded.good_text,improve_text=excluded.improve_text,next_atmosphere=excluded.next_atmosphere,next_interests=excluded.next_interests,
          preference_confirmed=excluded.preference_confirmed,updated_at=CURRENT_TIMESTAMP`,[feedbackId,JSON.stringify(positives),JSON.stringify(improvements),b.goodText??'',b.improveText??'',atmosphere,JSON.stringify(interests),b.preferenceConfirmed??false]);
        const previous=(await client.query<any>('SELECT learning_enabled FROM participant_preferences WHERE user_id=$1',[user.id])).rows[0];
        const enabled=b.learningEnabled??previous?.learning_enabled??true;
        const confirmed=Boolean(b.preferenceConfirmed)&&enabled&&!access.is_demo;
        // A demo review cannot replace a participant's real confirmed preference.
        if(!access.is_demo)await client.query(`INSERT INTO participant_preferences(user_id,atmosphere,interests,confirmed,source_feedback_id,learning_enabled)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET atmosphere=excluded.atmosphere,interests=excluded.interests,
          confirmed=excluded.confirmed,source_feedback_id=excluded.source_feedback_id,learning_enabled=excluded.learning_enabled,updated_at=CURRENT_TIMESTAMP`,[user.id,atmosphere,JSON.stringify(interests),confirmed,feedbackId,enabled]);
        await replaceRelationships(client,id,user.id,likes,dislikes);
      }else{
        await client.query('UPDATE participant_preferences SET source_feedback_id=NULL,confirmed=false WHERE user_id=$1 AND source_feedback_id IN (SELECT id FROM journey_feedback WHERE table_id=$2 AND author_user_id=$1)',[user.id,id]);
        await client.query('DELETE FROM feedback_details WHERE feedback_id IN (SELECT id FROM journey_feedback WHERE table_id=$1 AND author_user_id=$2)',[id,user.id]);
        await client.query('DELETE FROM journey_feedback WHERE table_id=$1 AND author_user_id=$2',[id,user.id]);
        await replaceRelationships(client,id,user.id,[],[]);
      }
      await updatePreferenceSignals(client,user.id);
      await client.query('COMMIT');return Response.json({ok:true});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }catch(e){return errorResponse(e);}
}
async function replaceRelationships(client:QueryClient,tableId:string,userId:string,likes:string[],dislikes:string[]){
  // Retract only exclusions originating in this review; retain exclusions from other tables and safety reports.
  const previous=(await client.query<any>("SELECT target_user_id FROM feedback_relationships WHERE table_id=$1 AND source_user_id=$2 AND relationship_type='DISLIKE'",[tableId,userId])).rows;
  await client.query('DELETE FROM feedback_relationships WHERE table_id=$1 AND source_user_id=$2',[tableId,userId]);
  for(const [type,ids] of [['LIKE',likes],['DISLIKE',dislikes]] as const)for(const target of ids)await client.query('INSERT INTO feedback_relationships(id,table_id,source_user_id,target_user_id,relationship_type) VALUES($1,$2,$3,$4,$5)',[randomUUID(),tableId,userId,target,type]);
  for(const target of new Set([...previous.map(r=>r.target_user_id),...dislikes])){
    const active=(await client.query("SELECT 1 FROM feedback_relationships WHERE source_user_id=$1 AND target_user_id=$2 AND relationship_type='DISLIKE'",[userId,target])).rowCount>0;
    await client.query(`INSERT INTO match_relationships(id,source_user_id,target_user_id,relationship_type,active) VALUES($1,$2,$3,'DISLIKE',$4)
      ON CONFLICT(source_user_id,target_user_id,relationship_type) DO UPDATE SET active=excluded.active`,[randomUUID(),userId,target,active]);
  }
}
export const POST=(request:Request,context:Context)=>mutate(request,context);
export const DELETE=(request:Request,context:Context)=>mutate(request,context,true);
