import {createHash} from 'node:crypto';
import {databaseProvider, db} from '../lib/db';
import {seedOperations} from './seed-operations';

const batch = 'showcase-content-v1';
const key = (name:string) => {
  const h=createHash('sha256').update(`${batch}:${name}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
};
const people=['김서연','이도윤','박지우','최하준','정수빈','강민재','윤하은','장유진','임지호','한소윤','오시우','신예린','이서현','박준서','최유나','정현우','강다은','윤도현','장수아','임태윤','한지민','오민서','신준영','김예진','이주원','박서아','최민준','정하린','강시온','윤예원','장건우','임채원','한지안','오승현','신다현','김수호','이예린','박유찬','최서우','정지훈','강나연','윤현서','장민규','임소은','한도경','오세은','신태민','김유정'];
const conversations = [
 ['APPLICATION','신청한 날짜를 하나 더 추가할 수 있을까요?','토요일 저녁으로 신청했는데 일요일도 가능해졌어요. 두 날짜 모두 열어두고 싶습니다.','가능한 일정을 함께 확인해 드릴게요. 신청 내역의 일정 조정에서 추가 날짜를 선택해 주세요. 이미 확정된 식탁은 유지됩니다.','일정 확인'],
 ['MATCHING','식탁 확정 안내는 언제 받을 수 있나요?','다음 주 홍대 식탁에 신청했어요. 장소와 함께할 분들은 언제 확인할 수 있나요?','신청 마감 후 공통 일정과 취향을 확인해 식탁을 준비합니다. 확정되면 내 식탁과 알림에서 장소와 채팅방을 확인하실 수 있어요.','배정 안내'],
 ['VENUE','견과류 알레르기가 있는데 메뉴 확인 부탁드려요','견과류 알레르기가 있어요. 소스나 디저트에 들어가는지 미리 확인할 수 있을까요?','알려주셔서 감사합니다. 식당에 메뉴와 조리 환경을 확인 중입니다. 교차 접촉 가능성까지 확인한 뒤 이 대화로 안내드릴게요.','식이 요청'],
 ['PAYMENT','남은 이용권은 어디에서 확인하나요?','3회권을 신청했고 한 번 참석했어요. 남은 횟수와 사용 기한을 알고 싶습니다.','신청 내역의 보유 이용권에서 남은 횟수와 만료일을 확인하실 수 있어요. 다음 신청에서 보유 이용권을 선택하시면 됩니다.','이용권'],
 ['CHAT','채팅방에 들어가는 방법을 알려주세요','식탁은 확정됐는데 채팅방 메뉴를 찾지 못했어요. 휴대폰에서 확인하고 있습니다.','홈의 다가오는 나의 식탁을 누른 뒤 채팅 탭을 열어주세요. 같은 식탁에 배정된 분들과 먼저 인사를 나누실 수 있어요.','이용 안내'],
 ['VENUE','약속 장소에 10분 정도 늦을 것 같아요','퇴근길 교통이 밀려서 7시 40분쯤 도착할 것 같아요. 식당에 전달 부탁드립니다.','알려주셔서 감사합니다. 식당과 같은 식탁에 도착 시간을 전달할게요. 이동 중 무리하지 마시고 채팅방에도 짧게 남겨주세요.','도착 안내'],
 ['APPLICATION','첫 참여인데 혼자 신청해도 괜찮을까요?','처음이라 조금 긴장돼요. 혼자 오시는 분들이 많은지 궁금합니다.','혼자 신청하시는 분들도 편하게 참여하실 수 있어요. 4~6명이 함께하며, 채팅과 대화 주제로 자연스럽게 인사 나눌 수 있도록 준비합니다.','첫 참여'],
 ['MATCHING','차분한 대화 분위기를 원해요','지난번에 즐겁게 참여했어요. 이번에는 조금 더 차분하게 이야기 나누고 싶습니다.','프로필의 내 선호에서 차분한 대화를 선택해 주세요. 공통 일정과 필수 조건을 먼저 확인하고, 가능한 범위에서 원하는 분위기를 함께 고려합니다.','분위기 선호'],
 ['VENUE','식당에서 식사 비용은 따로 계산하나요?','참가권과 식사 비용이 별도인지, 예산은 어느 정도 잡으면 되는지 알고 싶어요.','식사 비용은 현장에서 각자 부담해요. 확정된 식탁에서 식당과 예상 예산을 먼저 확인하실 수 있습니다. 메뉴 선택은 함께 상의해 주세요.','식사 예산'],
 ['PAYMENT','일정 변경으로 취소하려고 합니다','이번 주에는 참석이 어려워졌어요. 취소와 이용권 복구 절차를 안내 부탁드립니다.','신청 내역에서 취소 가능 여부를 확인하실 수 있어요. 행사 48시간 전까지 일반 취소하면 참가권 종류에 따라 환불 절차 또는 이용권 횟수 복구가 진행됩니다.','일정 변경'],
 ['OTHER','지난 식탁 후기를 수정하고 싶어요','후기를 작성한 뒤 생각난 내용이 있어서 추가하고 싶어요. 다시 작성할 수 있나요?','지난 식탁에서 해당 모임을 열고 후기 보기를 선택해 주세요. 작성한 점수와 내용을 다시 확인하고 수정하거나 삭제하실 수 있습니다.','후기 관리'],
 ['SAFETY','편안하게 참여하기 위한 안내가 있을까요?','처음 만나는 자리에서 서로 지켜야 할 약속을 미리 읽어보고 싶어요.','서로의 연락처나 개인 정보를 강요하지 않고, 상대가 편안한 주제로 이야기해 주세요. 불편한 일이 생기면 식탁의 안전 요청 또는 이 문의함으로 알려주세요.','참여 약속'],
] as const;

export async function populateShowcase() {
 await seedOperations();
 const c=await db.connect();
 try {
  await c.query('BEGIN');
  if(databaseProvider==='postgres') await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
  await c.query("UPDATE feedback_details SET good_text=$1 WHERE feedback_id='facedd01-602c-429d-a7b5-2cd4f87dbb68' AND good_text LIKE '모의 운영 배포 검증:%' AND feedback_id IN (SELECT id FROM journey_feedback WHERE is_demo=true)",['다른 분야에서 일하는 분들의 이야기가 흥미로웠고, 차분하게 대화할 수 있어 좋았어요.']);
  const previous=(await c.query<any>("SELECT id FROM support_tickets WHERE id='d3cf2751-c68e-40c2-b1c6-948aca612be1' AND is_demo=true AND subject LIKE '[모의]%' ")).rows;
  for(const t of previous){
   await c.query('UPDATE support_tickets SET subject=$2,tags=$3 WHERE id=$1',[t.id,'다음 식탁 일정과 선호를 확인하고 싶어요',JSON.stringify(['일정 확인'])]);
   const history=(await c.query<any>('SELECT m.id,m.kind,u.role FROM support_messages m LEFT JOIN users u ON u.id=m.author_user_id WHERE ticket_id=$1 ORDER BY m.ordinal,m.created_at',[t.id])).rows;
   for(const [i,m] of history.entries())await c.query('UPDATE support_messages SET body=$2 WHERE id=$1',[m.id,m.kind==='INTERNAL'?'참가자의 다음 일정을 확인했습니다. 기존 선호를 함께 참고해 안내해 주세요.':m.role==='ADMIN'?'가능한 일정과 선호는 신청 내역과 프로필에서 확인할 수 있어요. 다음 식탁도 편안하게 준비해 드리겠습니다.':i===0?'다음 식탁 신청 전에 가능한 일정과 제 선호가 잘 저장되어 있는지 확인하고 싶어요.':'확인했습니다. 친절한 안내 감사해요!']);
   await c.query('UPDATE support_activity SET details=$2 WHERE ticket_id=$1 AND details LIKE $3',[t.id,JSON.stringify({status:'RESOLVED',tags:['일정 확인']}),'%모의%']);
  }
  if((await c.query("SELECT 1 FROM audit_logs WHERE action='SHOWCASE_CONTENT_POPULATED' AND entity_id=$1",[key('batch')])).rowCount){await c.query('COMMIT');return {created:false,batch};}
  const operators=(await c.query<any>('SELECT user_id,display_name FROM operator_profiles WHERE active=true ORDER BY team_role DESC,user_id')).rows;
  if(operators.length<3)throw new Error('Three active operators are required.');
  const users=(await c.query<any>("SELECT u.id,p.display_name FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.email LIKE '%@demo.todaytable.invalid' ORDER BY u.email")).rows;
  const viewer=(await c.query<any>("SELECT u.id,p.display_name FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.email='user@todaytable.local'")).rows[0];
  for(let i=0;i<users.length;i++){
   users[i].display_name=people[i%people.length];
   await c.query('UPDATE profiles SET display_name=$2 WHERE user_id=$1',[users[i].id,users[i].display_name]);
  }
  if(viewer?.display_name==='체험 참가자'){viewer.display_name='김지안';await c.query('UPDATE profiles SET display_name=$2 WHERE user_id=$1',[viewer.id,viewer.display_name]);}
  const events=(await c.query<any>('SELECT id,title,venue_id FROM events WHERE is_demo=true ORDER BY starts_at')).rows;
  for(const e of events) await c.query('UPDATE events SET title=$2 WHERE id=$1',[e.id,e.title.replace(/^\[모의\]\s*/, '').replace(/^DEMO ONLY\s*[-·:]?\s*/, '')]);
  const venues=(await c.query<any>("SELECT id,name,address FROM venues WHERE id IN (SELECT venue_id FROM events WHERE is_demo=true)")).rows;
  for(const v of venues)await c.query('UPDATE venues SET name=$2,address=$3 WHERE id=$1',[v.id,v.name.replace(/^\[모의\]\s*/,''),v.address.replace(/\s*·\s*가상 식당/g,'')]);
  // Clean only the labelled seed content; keep provenance flags and source responses intact.
  const notifications=(await c.query<any>("SELECT id,message FROM notifications WHERE message LIKE '%모의%' OR message LIKE '%[모의]%'")).rows;
  for(const n of notifications)await c.query('UPDATE notifications SET message=$2 WHERE id=$1',[n.id,n.message.replace(/\[모의\]\s*/g,'').replace(/모의 /g,'')]);
  const cases=(await c.query<any>("SELECT r.id,r.reason FROM resolution_cases r JOIN applications a ON a.id=r.application_id WHERE a.is_demo=true")).rows;
  for(const r of cases)await c.query('UPDATE resolution_cases SET reason=$2 WHERE id=$1',[r.id,r.reason.replace(/\[모의\]\s*/g,'')]);
  let messages=0;
  const ticketIds:string[]=[];
  for(let i=0;i<24;i++){
   const [category,subject,question,answer,tag]=conversations[i%conversations.length];
   const person=[0,2,7,11,16,21].includes(i)&&viewer?viewer:users[(i*2+3)%users.length], operator=operators[i%3];
   const status=['OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED'][i%4];
   const created=new Date(Date.now()-(i*9+3)*3600000),answered=new Date(created.getTime()+45*60000),updated=status==='OPEN'?created:answered;
   const ticket=key(`ticket:${i}`);ticketIds.push(ticket);
   const application=(await c.query<any>('SELECT a.id FROM applications a WHERE a.user_id=$1 AND a.is_demo=true ORDER BY a.created_at DESC LIMIT 1',[person.id])).rows[0];
   await c.query(`INSERT INTO support_tickets(id,number,user_id,contact_name,subject,category,tags,status,priority,assignee_id,application_id,request_key,is_demo,created_at,updated_at,last_public_at,first_response_at,resolved_at,next_followup_at,helpful)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$14,$15,$16,$17,$18)`,
    [ticket,`TT-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(101+i)}`,person.id,person.display_name,subject,category,JSON.stringify([tag]),status,i%7===2?'HIGH':'NORMAL',status==='OPEN'?null:operator.user_id,application?.id??null,key(`request:${i}`),created.toISOString(),updated.toISOString(),status==='OPEN'?null:answered.toISOString(),status==='RESOLVED'?new Date(answered.getTime()+2*3600000).toISOString():null,status==='IN_PROGRESS'?new Date(Date.now()+3*3600000).toISOString():null,status==='RESOLVED'?i%8!==7:null]);
   const addMessage=async(n:number,author:string,name:string,kind:string,body:string,time:Date)=>{await c.query('INSERT INTO support_messages(id,ticket_id,author_user_id,author_name,kind,body,request_key,ordinal,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[key(`message:${i}:${n}`),ticket,author,name,kind,body,key(`message-request:${i}:${n}`),n,time.toISOString()]);messages++;};
   await addMessage(0,person.id,person.display_name,'PUBLIC',question,created);
   if(status!=='OPEN') {
    await addMessage(1,operator.user_id,operator.display_name,'INTERNAL',category==='VENUE'?'식당 담당자에게 전달했습니다. 확인 후 참가자에게 이어서 안내해 주세요.':'연결된 신청 내역 확인 완료. 다음 담당자도 이 대화에서 이어서 응대해 주세요.',new Date(created.getTime()+20*60000));
    await addMessage(2,operator.user_id,operator.display_name,'PUBLIC',answer,answered);
    await c.query('INSERT INTO support_activity(id,ticket_id,actor_user_id,actor_name,action,details,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[key(`activity:${i}`),ticket,operator.user_id,operator.display_name,'UPDATED',JSON.stringify({status,assigneeId:operator.user_id}),answered.toISOString()]);
   }
   if(status==='RESOLVED')await addMessage(3,person.id,person.display_name,'PUBLIC','안내 감사합니다. 덕분에 확인했어요! 다음 식탁도 기대할게요.',new Date(answered.getTime()+3600000));
  }
  const improvements=[['식당별 알레르기 확인 안내 보강','VENUE','PLANNED'],['첫 참가자를 위한 채팅방 안내 개선','CHAT','DONE'],['식탁 확정 알림과 일정 안내 정리','MATCHING','OPEN'],['이용권 잔여 횟수 안내 강화','PAYMENT','PLANNED']];
  for(let i=0;i<improvements.length;i++){
   const [title,category,status]=improvements[i];
   await c.query('INSERT INTO improvement_items(id,title,category,status,created_by) VALUES($1,$2,$3,$4,$5)',[key(`improvement:${i}`),title,category,status,operators[i%3].user_id]);
   for(let n=0;n<24;n++)if(conversations[n%12][0]===category)await c.query('INSERT INTO improvement_tickets(item_id,ticket_id) VALUES($1,$2)',[key(`improvement:${i}`),ticketIds[n]]);
  }
  const feedback=(await c.query<any>('SELECT f.id,f.comment FROM journey_feedback f WHERE f.is_demo=true ORDER BY f.created_at,f.id')).rows;
  for(let i=0;i<feedback.length;i++)await c.query(`INSERT INTO feedback_details(feedback_id,positives,improvements,good_text,improve_text,next_atmosphere,next_interests,preference_confirmed)
   VALUES($1,$2,$3,$4,$5,$6,$7,false) ON CONFLICT(feedback_id) DO NOTHING`,[feedback[i].id,JSON.stringify(i%2?['CONVERSATION','PERSPECTIVES']:['COMMON_INTERESTS','GROUP']),JSON.stringify(i%4===0?['FOOD']:[]),feedback[i].comment,i%4===0?'음악 소리가 조금 작으면 대화하기 더 좋을 것 같아요.':'',i%3===0?'CALM':'BALANCED',JSON.stringify(['독서·글쓰기','여행'])]);
  await c.query('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,$4,$5)',[operators[0].user_id,'SHOWCASE_CONTENT_POPULATED','content_batch',key('batch'),JSON.stringify({batch,tickets:24,messages,improvements:4,synthetic:true})]);
  await c.query('COMMIT');return {created:true,batch,tickets:24,messages,improvements:4,feedback:feedback.length,events:events.length,venues:venues.length};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
if(process.argv[1]?.endsWith('populate-showcase.ts'))populateShowcase().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.end());
