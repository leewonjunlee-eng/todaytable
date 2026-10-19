import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {db,databaseProvider,type QueryClient} from '../lib/db';
import {showcaseId as uid,planShowcase,showcaseThursday,type SourceRow,type ShowcasePerson,type Cohort} from '../lib/showcase-plan';
import {activeShowcase,type ShowcaseSummary} from '../lib/showcase';
import {groupScore,type MatchCandidate} from '../lib/matching';
import {conversationQuestions} from '../lib/table-experience';
import {hashPassword} from '../lib/security';
import {populateOperatorInventory,operatorInventoryVenueIds} from './populate-operator-workspace';
import {parseJson} from '../lib/operators';
const DAY=86400000;
type Payload={sha256:string;manifest:any;records:SourceRow[];original_base64?:string};
export async function populateLifecycleShowcase(payload:Payload,now=new Date()){
 if(!/^[a-f0-9]{64}$/.test(payload.sha256)||!payload.records.length||new Set(payload.records.map(r=>r.sheet_row)).size!==payload.records.length)throw Error('A complete source dataset with unique row keys is required.');
 if(Number(payload.manifest?.record_count)!==payload.records.length)throw Error('Source manifest count does not match the complete dataset.');
 if(payload.original_base64&&createHash('sha256').update(Buffer.from(payload.original_base64,'base64')).digest('hex')!==payload.sha256)throw Error('Source workbook checksum mismatch.');
 const anchor=showcaseThursday(now),anchorDate=anchor.toISOString().slice(0,10),batch=`source-lifecycle-v1:${payload.sha256}:${anchorDate}`;
 const previous=(await db.query<any>('SELECT summary FROM showcase_batches WHERE id=$1',[batch])).rows[0];if(previous)return {created:false,...parseJson<ShowcaseSummary>(previous.summary,{} as ShowcaseSummary)};
 await populateOperatorInventory();
 const c=await db.connect(),plan=planShowcase(payload.records),eventIds:string[]=[],userIds:string[]=[],primary=new Map<number,{userId:string;appId:string;person:ShowcasePerson;cohort:Cohort}>();
 const password=await hashPassword(randomUUID());let tables=0,applications=0,past=0,upcoming=0,recruiting=0,feedbackCount=0,chatCount=0;
 const policy={id:'showcase-v1',name:'취향이 이어지는 저녁',description:'원본 설문을 바탕으로 구성한 운영 체험 자료',minScore:0,learningEnabled:false,weights:{gender:.4,mbti:.25,interests:.2,traits:.1,novelty:.05}};
 try{
 await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
 const exists=(await c.query<any>('SELECT summary FROM showcase_batches WHERE id=$1',[batch])).rows[0];if(exists){await c.query('COMMIT');return {created:false,...parseJson(exists.summary,{})};}
 const admin=(await c.query<any>("SELECT u.id FROM users u JOIN operator_profiles o ON o.user_id=u.id WHERE u.role='ADMIN' AND o.active=true ORDER BY o.created_at LIMIT 1")).rows[0];if(!admin)throw Error('An active operator is required.');
 await c.query('INSERT INTO showcase_batches(id,dataset_sha256,anchor_date,created_by) VALUES($1,$2,$3,$4)',[batch,payload.sha256,anchorDate,admin.id]);
 const venueIds=new Set(operatorInventoryVenueIds());const venues=(await c.query<any>('SELECT v.id,v.name,v.area,v.address,v.capacity,vp.cuisine FROM venues v JOIN venue_profiles vp ON vp.venue_id=v.id WHERE v.active=true ORDER BY v.area,v.id')).rows.filter(v=>venueIds.has(v.id));
 const personById=new Map<string,ShowcasePerson>();
 for(const person of plan.people){const userId=uid(`${batch}:person:${person.row.sheet_row}`);userIds.push(userId);personById.set(userId,person);
  await c.query("INSERT INTO users(id,email,password_hash,is_demo,created_at) VALUES($1,$2,$3,true,$4)",[userId,`dinner-${userId}@showcase.todaytable.invalid`,password,new Date(+now-45*DAY+(person.row.sheet_row%12)*DAY)]);
  await c.query("INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,occupation,mbti,interests,traits,desired_traits,food_budgets,dietary_notes,consent_privacy,consent_operations,consent_version,consented_at) VALUES($1,$2,'',$3,$4,$5,$6,$7,$8,$9,$10,$11,true,true,'fictional-showcase-v1',$12)",[userId,person.name,2026-person.age,person.gender,person.row.fields.occupation??'',person.mbti,person.interests,person.traits,person.desiredTraits,person.budgets,person.row.fields.dietary_notes??'',new Date(+now-40*DAY)]);
 }
 const addApplication=async(userId:string,person:ShowcasePerson,eventId:string,key:string,starts:Date,cohort:Cohort)=>{
  const appId=uid(`${batch}:app:${key}`),paymentId=uid(`${batch}:payment:${key}`),grantId=uid(`${batch}:grant:${key}`),created=new Date(Math.min(+starts-6*DAY,+now-(2+(applications%14))*3600000));applications++;
  await c.query('INSERT INTO applications(id,user_id,request_key,matching_status,pass_choice,pass_uses,amount_cents,is_demo,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$8)',[appId,userId,uid(`${batch}:request:${key}`),cohort==='RECRUITING'?'WAITING':'CONFIRMED',person.uses===3?'THREE_PASS':'SINGLE',person.uses,person.amount,created]);
  await c.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',[appId,eventId]);
  await c.query("INSERT INTO payments(id,application_id,idempotency_key,status,amount_cents,provider,created_at) VALUES($1,$2,$3,'PAID',$4,'MOCK',$5)",[paymentId,appId,`showcase:${key}:${batch}`,person.amount,created]);
  await c.query("INSERT INTO payment_attempts(id,user_id,request_key,application_id,amount_cents,outcome,selection,created_at) VALUES($1,$2,$3,$4,$5,'SUCCEEDED',$6,$7)",[uid(`${batch}:attempt:${key}`),userId,uid(`${batch}:attempt-request:${key}`),appId,person.amount,JSON.stringify({eventIds:[eventId],pass:person.uses===3?'THREE_PASS':'SINGLE'}),created]);
  await c.query("INSERT INTO payment_ledger(id,payment_id,request_key,kind,amount_cents,source,created_at) VALUES($1,$2,$3,'CHARGE',$4,'SHOWCASE',$5)",[uid(`${batch}:charge:${key}`),paymentId,`showcase-charge:${batch}:${key}`,person.amount,created]);
  await c.query('INSERT INTO entitlements(id,user_id,source_payment_id,original_uses,remaining_uses,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[grantId,userId,paymentId,person.uses,person.uses-1,person.uses>1?new Date(+now+50*DAY):null]);
  await c.query("INSERT INTO entitlement_entries(entitlement_id,application_id,entry_type,created_at) VALUES($1,$2,'USE',$3)",[grantId,appId,created]);
  await c.query("INSERT INTO product_events(id,user_id,event_type,entity_id,is_demo,created_at) VALUES($1,$2,'APPLICATION_STARTED',$3,true,$4)",[uid(`${batch}:start:${key}`),userId,appId,new Date(+created-180000)]);
  if(cohort==='RECRUITING')await c.query('INSERT INTO availability_registrations(id,user_id,application_id,dates,areas,request_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(`${batch}:availability:${key}`),userId,appId,JSON.stringify([new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(starts)]),JSON.stringify([person.area]),uid(`${batch}:availability-request:${key}`),created]);
  return {appId,paymentId,created};
 };
 const addGroup=async(people:{userId:string;person:ShowcasePerson;key:string}[],cohort:Cohort,index:number,viewer=false)=>{
  const area=people[0].person.area,starts=new Date(+anchor+(cohort==='PAST'?-(1+Math.floor(index/3)%3)*7:cohort==='UPCOMING'?index%2*7:14+index%2*7)*DAY),ends=new Date(+starts+7200000),deadline=new Date(cohort==='RECRUITING'?+starts-3*DAY:+starts-5*DAY);
  // Confirmed future tables have already passed their matching deadline.
  if(cohort==='UPCOMING'&&+deadline>=+now)deadline.setTime(+now-3600000);
  const eventId=uid(`${batch}:event:${index}:${viewer?'viewer':'source'}`),localVenues=venues.filter(v=>v.area===area),venue=localVenues[Math.floor(index/3)%localVenues.length];if(!venue)throw Error('Missing fictional venue inventory.');
  const titles=['취향이 이어지는 저녁','여행 이야기 한 접시','퇴근 후, 새로운 우리','느린 대화가 좋은 날','주말을 기다리는 식탁','서로의 플레이리스트'];
  const title=`${area.split('/')[0]} · ${titles[index%titles.length]}`;eventIds.push(eventId);
  await c.query("INSERT INTO events(id,title,starts_at,ends_at,application_deadline,area,capacity,price_cents,status,created_by,venue_id,is_demo) VALUES($1,$2,$3,$4,$5,$6,$7,8000,$8,$9,$10,true)",[eventId,title,starts,ends,deadline,area,cohort==='RECRUITING'?12:people.length,cohort==='RECRUITING'?'OPEN':'CLOSED',admin.id,venue.id]);
  await c.query('INSERT INTO venue_slots(id,venue_id,starts_at,ends_at,seats,table_limit,closed,created_by) VALUES($1,$2,$3,$4,$5,6,false,$6) ON CONFLICT(id) DO NOTHING',[uid(`${batch}:slot:${venue.id}:${starts.toISOString()}`),venue.id,starts,ends,venue.capacity,admin.id]);
  await c.query('UPDATE venues SET schedule_required=true WHERE id=$1',[venue.id]);
  const roster:MatchCandidate[]=[],appRows:{userId:string;person:ShowcasePerson;appId:string;created:Date}[]=[];
  for(const item of people){const app=await addApplication(item.userId,item.person,eventId,item.key,starts,cohort);roster.push({applicationId:app.appId,userId:item.userId,birthYear:2026-item.person.age,gender:item.person.gender,mbti:item.person.mbti,interests:item.person.interests,traits:item.person.traits,desiredTraits:item.person.desiredTraits,eventIds:[eventId],paid:true,valid:true});appRows.push({...item,appId:app.appId,created:app.created});
   if(!viewer){primary.set(item.person.row.sheet_row,{userId:item.userId,appId:app.appId,person:item.person,cohort});await c.query('INSERT INTO showcase_members(batch_id,dataset_sha256,sheet_name,sheet_row,user_id,application_id,payment_id,event_id,cohort,assumptions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[batch,payload.sha256,item.person.row.sheet_name??'설문지 응답 시트1',item.person.row.sheet_row,item.userId,app.appId,app.paymentId,eventId,cohort,JSON.stringify(item.person.assumptions)]);if(cohort==='PAST')past++;else if(cohort==='UPCOMING')upcoming++;else recruiting++;}
  }
  if(cohort==='RECRUITING')return;
  if(people.length<4||people.length>6||Math.max(...people.map(p=>p.person.age))-Math.min(...people.map(p=>p.person.age))>8)throw Error('Invalid showcase table constraints.');
  tables++;const tableId=uid(`${batch}:table:${index}`),runId=uid(`${batch}:run:${index}`),roomId=uid(`${batch}:room:${index}`),created=new Date(+deadline+300000),score=groupScore(roster,policy.weights),topics=conversationQuestions(roster);
  await c.query("INSERT INTO match_runs(id,event_id,rule_version,seed,input_snapshot,matched_count,quality_score,created_at,completed_at) VALUES($1,$2,'showcase-v1',$3,$4,$5,$6,$7,$7)",[runId,eventId,batch,JSON.stringify({simulation:true,policy,candidates:roster,sourceRows:people.map(p=>p.person.row.sheet_row)}),people.length,score,created]);
  await c.query("INSERT INTO dining_tables(id,event_id,match_run_id,table_number,status,quality_score,venue_id,starts_at,area,capacity,locked_at,provision_status,confirmation_source,created_at) VALUES($1,$2,$3,1,'CONFIRMED',$4,$5,$6,$7,$8,$9,'PROVISIONED','AUTO',$9)",[tableId,eventId,runId,score,venue.id,starts,area,people.length,created]);
  const reservation=`우연한 식탁 ${index+1}`;
  await c.query("INSERT INTO table_reservations(table_id,venue_id,reservation_name,meeting_time,status,provider) VALUES($1,$2,$3,$4,'CONFIRMED','MOCK')",[tableId,venue.id,reservation,starts]);
  await c.query("INSERT INTO venue_booking_tasks(table_id,status,reservation_name,confirmation_code,note,updated_by,updated_at) VALUES($1,'CONFIRMED',$2,$3,$4,$5,$6)",[tableId,reservation,`TT-${anchorDate.replaceAll('-','')}-${index+1}`,'안쪽 테이블, 함께 도착하지 않아도 예약명으로 안내해 주세요.',admin.id,created]);
  await c.query('INSERT INTO journey_rooms(id,table_id,welcome_message,rules_message,curation_message,topics,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[roomId,tableId,'우리 식탁에 오신 것을 환영해요.','서로의 이야기를 존중하고 편안한 속도로 대화해요.','함께 좋아하는 이야기로 시작해 보세요.',JSON.stringify(topics),created]);
  const guide=`${title} 식탁이 준비됐어요. ${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'numeric',minute:'numeric'}).format(starts)} · ${venue.name} · 예약명 ${reservation}`;
  await c.query("INSERT INTO journey_messages(id,room_id,author_user_id,body,request_key,kind,created_at) VALUES($1,$2,NULL,$3,$4,'SYSTEM',$5)",[uid(`${batch}:guide:${index}`),roomId,guide,uid(`${batch}:guide-request:${index}`),created]);
  for(const [j,item] of appRows.entries()){
   await c.query("INSERT INTO table_members(table_id,application_id,user_id,joined_at) VALUES($1,$2,$3,$4)",[tableId,item.appId,item.userId,created]);
   const attended=cohort==='PAST'&&(!viewer&&index%7===0&&j===people.length-1?false:true),attendance=cohort==='PAST'?(attended?'ATTENDED':'NO_SHOW'):'SCHEDULED';
   await c.query('INSERT INTO attendance_records(application_id,event_id,status,checked_in_at) VALUES($1,$2,$3,$4)',[item.appId,eventId,attendance,attended?new Date(+starts-600000+j*90000):null]);
   if(item.person.row.fields.dietary_notes?.trim())await c.query('INSERT INTO venue_dietary_checks(id,venue_id,user_id,notes,valid_until,confirmed_by) VALUES($1,$2,$3,$4,$5,$6)',[uid(`${batch}:dietary:${item.appId}`),venue.id,item.userId,item.person.row.fields.dietary_notes,new Date(+ends+DAY),admin.id]);
   if(cohort==='UPCOMING')await c.query("INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at,next_attempt_at) VALUES($1,'JOURNEY_REMINDER',$2,$3,$3)",[`${batch}:reminder:${item.appId}`,JSON.stringify({tableId,applicationId:item.appId}),new Date(+starts-DAY)]);
   await c.query('INSERT INTO match_explanations(id,match_run_id,application_id,table_id,kind,message,details,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(`${batch}:reason:${item.appId}`),runId,item.appId,tableId,'CONFIRMED','선택한 지역과 비슷한 연령대, 함께 나눌 관심사로 연결된 식탁이에요.',JSON.stringify({simulation:true,sourceRow:item.person.row.sheet_row,score}),created]);
   await c.query("INSERT INTO notifications(id,event_id,recipient_user_id,message,channel,status,sent_by,action_url,created_at) VALUES($1,$2,$3,$4,'IN_APP','SENT',$5,$6,$7)",[uid(`${batch}:notification:${item.appId}`),eventId,item.userId,guide,admin.id,`/tables/${tableId}`,created]);
   const interest=item.person.interests[0]??'일상',messages=cohort==='PAST'?['함께한 저녁 정말 즐거웠어요. 다음 식탁에서도 만나면 좋겠어요!','말씀해주신 곳 저장해뒀어요. 추천 감사해요 🙂',`${interest} 이야기를 이렇게 오래 할 줄 몰랐어요. 즐거웠습니다!`]:['안녕하세요! 이번 식탁에서 만나게 되어 반가워요 🙂',`저는 ${interest} 좋아해요. 다들 어떤 이야기 좋아하세요?`,'식당 위치 확인했어요. 퇴근하고 바로 갈게요!','저도 처음인데, 벌써 기대돼요. 편하게 이야기 나눠요.'];
   if(j<4){chatCount++;await c.query("INSERT INTO journey_messages(id,room_id,author_user_id,body,request_key,kind,created_at) VALUES($1,$2,$3,$4,$5,'USER',$6)",[uid(`${batch}:chat:${item.appId}`),roomId,item.userId,messages[j%messages.length],uid(`${batch}:chat-request:${item.appId}`),new Date(cohort==='PAST'?+ends+(j+1)*3600000:Math.max(+created,+now-3*3600000)+(j+1)*300000)]);}
   if(attended&&j%4!==3&&!viewer){const feedbackId=uid(`${batch}:feedback:${item.appId}`),feedbackAt=new Date(+ends+(j+2)*3600000),text=[`${interest} 취향이 비슷한 분들이어서 첫 만남인데도 이야기가 자연스러웠어요.`,'낯선 자리라 긴장했는데 대화 카드가 도움이 됐어요. 다음에도 참여할게요.','처음 가본 식당인데 공간이 조용하고 음식도 좋았습니다.','서로 다른 경험을 듣는 시간이 좋았어요. 두 시간이 금방 지나갔네요.'][j%4];feedbackCount++;
    await c.query('INSERT INTO journey_feedback(id,table_id,author_user_id,table_score,conversation_score,venue_score,return_intent,recommend_intent,comment,is_demo,created_at) VALUES($1,$2,$3,$4,$5,$6,true,true,$7,true,$8)',[feedbackId,tableId,item.userId,4+j%2,4+j%2,4+(index+j)%2,text,feedbackAt]);
    await c.query('INSERT INTO feedback_details(feedback_id,positives,good_text,next_interests) VALUES($1,$2,$3,$4)',[feedbackId,JSON.stringify(['편안한 분위기','공통 관심사']),text,JSON.stringify(item.person.interests)]);
    await c.query('INSERT INTO venue_public_reviews(id,venue_id,author_user_id,table_id,feedback_id,score,body,is_demo,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8)',[uid(`${batch}:public-review:${item.appId}`),venue.id,item.userId,tableId,feedbackId,4+(index+j)%2,text,feedbackAt]);
   }
  }
  if(cohort==='UPCOMING')for(const [kind,at] of [['POST_CONTENT',starts],['CLOSE_ATTENDANCE',ends],['JOURNEY_FEEDBACK_REQUEST',ends],['FEEDBACK_FOLLOWUP',new Date(+ends+DAY)]] as const)await c.query('INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at,next_attempt_at) VALUES($1,$2,$3,$4,$4)',[`${batch}:${kind}:${tableId}`,kind,JSON.stringify({tableId,eventId}),at]);
  for(const a of appRows)for(const b of appRows)if(a.userId!==b.userId)await c.query('INSERT INTO match_history(id,table_id,user_id,other_user_id,created_at) VALUES($1,$2,$3,$4,$5)',[uid(`${batch}:history:${tableId}:${a.userId}:${b.userId}`),tableId,a.userId,b.userId,created]);
 };
 for(const [i,group] of plan.groups.entries())await addGroup(group.people.map(person=>({userId:uid(`${batch}:person:${person.row.sheet_row}`),person,key:`source:${person.row.sheet_row}`})),group.cohort,i);
 // Keep review credentials and legacy records intact while giving that account the complete journey.
 const viewers=(await c.query<any>("SELECT u.id,p.birth_year,p.display_name,p.gender,p.mbti,p.interests FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.role='PARTICIPANT' AND u.email IN ('user@todaytable','guest@todaytable.local') ORDER BY u.email")).rows.slice(0,1);
 for(const viewer of viewers){const age=2026-Number(viewer.birth_year),available=[...primary.values()].filter(p=>p.cohort==='RECRUITING'&&p.person.area==='홍대/합정'&&Math.abs(p.person.age-age)<=4).slice(0,5);if(available.length<5)throw Error('Five compatible fictional peers are required for the review account.');
  const own={...available[0].person,name:viewer.display_name,age,gender:viewer.gender,mbti:viewer.mbti,interests:parseJson<string[]>(viewer.interests,[]),uses:1,amount:8000};userIds.push(viewer.id);await c.query('INSERT INTO showcase_viewers(batch_id,user_id) VALUES($1,$2)',[batch,viewer.id]);
  for(const [n,cohort] of (['PAST','UPCOMING','RECRUITING'] as const).entries()){const index=plan.groups.length+n;await addGroup([{userId:viewer.id,person:own,key:`viewer:${viewer.id}:${cohort}`},...(cohort==='RECRUITING'?[]:available.map(p=>({userId:p.userId,person:p.person,key:`repeat:${viewer.id}:${cohort}:${p.person.row.sheet_row}`})))],cohort,index,true);}
 }
 const inquiryExamples=[['MATCHING','식당에서 조금 일찍 기다려도 될까요?','퇴근 후 바로 이동하면 15분 정도 일찍 도착할 것 같아요. 예약명으로 먼저 안내받을 수 있을까요?'],['APPLICATION','함께 고른 날짜는 어디서 확인하나요?','신청한 날짜와 매칭 마감 시간을 다시 확인하고 싶어요.'],['PAYMENT','남은 참가권을 다음에 사용할 수 있나요?','이번 만남 이후 남아 있는 참가권은 언제까지 사용할 수 있는지 궁금해요.'],['OTHER','처음 참여하는데 준비할 것이 있나요?','처음이라 조금 떨리네요. 시작 전에 참고할 내용이 있을까요?']];
 for(const [i,person] of [...primary.values()].filter(p=>p.cohort!=='PAST').slice(0,12).entries()){
  const ticket=uid(`${batch}:ticket:${i}`),example=inquiryExamples[i%4],status=['OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED'][i%4],created=new Date(+now-(24+i)*3600000);
  await c.query("INSERT INTO support_tickets(id,number,user_id,contact_name,contact_email,category,subject,status,is_demo,application_id,assignee_id,created_at,updated_at,last_public_at,first_response_at,resolved_at) VALUES($1,$2,$3,$4,'',$5,$6,$7,true,$8,$9,$10,$11,$11,$12,$13)",[ticket,`TT-${anchorDate.replaceAll('-','')}-${String(i+1).padStart(3,'0')}`,person.userId,person.person.name,example[0],example[1],status,person.appId,i%4?admin.id:null,created,new Date(+created+1800000),i%4?new Date(+created+1200000):null,status==='RESOLVED'?new Date(+created+1800000):null]);
  await c.query("INSERT INTO support_messages(id,ticket_id,author_user_id,author_name,kind,body,request_key,created_at) VALUES($1,$2,$3,$4,'PUBLIC',$5,$6,$7)",[uid(`${batch}:question:${i}`),ticket,person.userId,person.person.name,example[2],uid(`${batch}:question-request:${i}`),created]);
  if(i%4)await c.query("INSERT INTO support_messages(id,ticket_id,author_user_id,author_name,kind,body,request_key,created_at) VALUES($1,$2,$3,'운영팀','PUBLIC',$4,$5,$6)",[uid(`${batch}:answer:${i}`),ticket,admin.id,['','안녕하세요. 식탁 안내의 일정과 예약명을 확인해 주세요. 추가로 궁금한 점이 있으면 이어서 말씀해 주세요.','확인을 위해 가능한 시간대를 알려주시겠어요? 편하게 답변 남겨 주세요.','확인했어요. 요청하신 내용으로 안내를 정리했습니다. 즐거운 저녁 보내세요!'][i%4],uid(`${batch}:answer-request:${i}`),new Date(+created+1200000)]);
 }
 const summary:ShowcaseSummary&{feedback:number;chatMessages:number}={sourceRows:payload.records.length,participants:userIds.length,applications,past,upcoming,recruiting,tables,eventIds,userIds,anchorDate,feedback:feedbackCount,chatMessages:chatCount};
 await c.query('UPDATE showcase_batches SET active=false WHERE active=true');await c.query('UPDATE showcase_batches SET summary=$2,active=true WHERE id=$1',[batch,JSON.stringify(summary)]);
 await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'SHOWCASE_LIFECYCLE_POPULATED','showcase_batch',$2,$3)",[admin.id,batch,JSON.stringify({...summary,userIds:undefined,eventIds:undefined})]);
 await c.query('COMMIT');return {created:true,...summary};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function main(){const path=process.argv[2]??'.data/provided-data-import.json',payload=JSON.parse(await readFile(path,'utf8')) as Payload;const result=await populateLifecycleShowcase(payload);const {eventIds,userIds,...summary}=result as any;console.log(JSON.stringify(summary));}
if(process.argv[1]?.endsWith('populate-lifecycle-showcase.ts'))main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.end());
