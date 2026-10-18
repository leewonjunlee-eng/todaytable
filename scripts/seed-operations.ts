import { createHash, randomUUID } from 'node:crypto';
import { databaseProvider, db } from '../lib/db';
import { runMatching, provisionTable } from '../lib/lifecycle-service';
import { hashPassword } from '../lib/security';
import { INTERESTS, TRAITS, DESIRED_TRAITS, REGIONS } from '../lib/domain';

// A separate, repeat-safe synthetic dataset. Never imports real survey respondents.
const batch = 'operations-demo-v1';
const id = (key: string) => {
  const h = createHash('sha256').update(`${batch}:${key}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
};
const at = (offset: number) => {
  const day = new Date(Date.now() + offset * 86400000);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 10, 30));
};
const json = JSON.stringify;
const names = ['김서연','이도윤','박지우','최하준','정수빈','강민재','윤하은','장유진','임지호','한소윤','오시우','신예린'];
const occupations = ['서비스 기획자','개발자','브랜드 디자이너','마케터','연구원','콘텐츠 에디터'];
const mbtis = ['ENFP','INTJ','ISFJ','ENTP','INFP','ESFJ'];
const venueNames = ['온기 다이닝','잠실 작은식탁','논현 저녁정원','종로 취향살롱'];
const chat = ['안녕하세요! 이번 식탁에서 만나게 되어 반가워요 🙂','저는 근처 전시 보고 갈 예정이에요. 전시 좋아하시는 분 계신가요?','저도 전시랑 맛집 탐방 좋아해요. 벌써 기대되네요!','식당 위치 확인했어요. 시간 맞춰 도착할게요.','처음 참여하는데 편하게 이야기 나누면 좋겠어요.'];
const feedbackText = ['처음 만났는데도 공통 관심사가 많아 편하게 이야기했어요.','음식도 좋고 대화 주제 카드가 도움이 됐어요. 다음에도 참여하고 싶어요.','다양한 일을 하는 분들을 만나 새로운 자극을 받았어요.','분위기가 편안해서 시간 가는 줄 몰랐습니다.'];

export async function seedOperations() {
  const client = await db.connect();
  const passwordHash = await hashPassword(randomUUID());
  try {
    await client.query('BEGIN');
    if (databaseProvider === 'postgres') await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
    const exists = await client.query("SELECT 1 FROM audit_logs WHERE action='DEMO_OPERATIONS_SEEDED' AND entity_id=$1", [id('batch')]);
    if (exists.rowCount) { await client.query('COMMIT'); return { created: false, batch }; }
    const admin = await client.query<{id:string}>("SELECT id FROM users WHERE role='ADMIN' ORDER BY created_at LIMIT 1");
    if (!admin.rowCount) throw new Error('Run db:seed or provision an admin account first.');
    const adminId = admin.rows[0].id;
    const viewers = await client.query<{id:string;email:string}>("SELECT id,email FROM users WHERE email IN ('user@todaytable.local','guest@todaytable.local') AND role='PARTICIPANT' ORDER BY email");
    for (const viewer of viewers.rows) await client.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,consent_privacy,consent_operations,consented_at)
      VALUES($1,'체험 참가자','',1995,'PREFER_NOT_TO_SAY','INFP',true,true,now()) ON CONFLICT(user_id) DO NOTHING`, [viewer.id]);
    const users: string[] = [];
    for (let n=0; n<48; n++) {
      const userId=id(`user:${n}`); users.push(userId);
      await client.query("INSERT INTO users(id,email,password_hash,is_demo) VALUES($1,$2,$3,TRUE)",[userId,`participant${String(n+1).padStart(2,'0')}@demo.todaytable.invalid`,passwordHash]);
      const arrays = [json([INTERESTS[n%10], INTERESTS[(n+3)%10], '여행']),json([TRAITS[n%6],TRAITS[(n+2)%6]]),json([DESIRED_TRAITS[n%6]]),json(['20000_30000'])];
      await client.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,occupation,mbti,interests,traits,desired_traits,food_budgets,consent_privacy,consent_operations,consented_at)
        VALUES($1,$2,'', $3,$4,$5,$6,$7::text[],$8::text[],$9::text[],$10::text[],true,true,now())`,
        [userId,`${names[n%12]}${n>=12 ? ` ${Math.floor(n/12)+1}` : ''}`,1992+n%6,n%2?'MAN':'WOMAN',occupations[n%6],mbtis[n%6],...(databaseProvider==='postgres'?arrays.map(a=>JSON.parse(a)):arrays)],
        `INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,occupation,mbti,interests,traits,desired_traits,food_budgets,consent_privacy,consent_operations,consented_at)
        VALUES($1,$2,'',$3,$4,$5,$6,$7,$8,$9,$10,1,1,CURRENT_TIMESTAMP)`);
    }
    for (let n=0; n<4; n++) await client.query('INSERT INTO venues(id,name,area,address,capacity) VALUES($1,$2,$3,$4,60)',
          [id(`venue:${n}`),`[모의] ${venueNames[n]}`,REGIONS[n],['서울 마포구 합정동 · 가상 식당','서울 송파구 잠실동 · 가상 식당','서울 강남구 논현동 · 가상 식당','서울 종로구 관철동 · 가상 식당'][n]]);
        const cohorts = [
          {day:-21, count:6, state:'past'}, {day:-14,count:6,state:'past'}, {day:-7,count:6,state:'past'},
          {day:1,count:6,state:'confirmed'}, {day:3,count:6,state:'confirmed'}, {day:5,count:6,state:'confirmed'},
          {day:8,count:6,state:'waiting'}, {day:10,count:6,state:'waiting'}, {day:12,count:4,state:'waiting'},
          {day:15,count:4,state:'waiting'}, {day:6,count:2,state:'unmatched'}, {day:18,count:2,state:'refund'},
        ];
        let applicationCount=0, tableCount=0;
        for (let n=0; n<cohorts.length; n++) {
          const cohort=cohorts[n], eventId=id(`event:${n}`), start=at(cohort.day), end=new Date(start.getTime()+7200000);
          const deadline=new Date((cohort.state==='waiting'||cohort.state==='refund')?start.getTime()-172800000:Date.now()-60000);
          await client.query(`INSERT INTO events(id,title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by,venue_id,is_demo) VALUES($1,$2,$3,$4,$5,$6,24,8000,$7,$8,TRUE)`,
            [eventId,`[모의] ${REGIONS[n%4]} ${['취향을 나누는 저녁','여행 이야기 식탁','퇴근 후 새로운 만남'][n%3]}`,start,end,deadline,REGIONS[n%4],adminId,id(`venue:${n%4}`)]);
      const members = Array.from({length:cohort.count},(_,i)=>users[(n*6+i)%48]);
      if ([0,3,6].includes(n)) viewers.rows.slice(0,2).forEach((v,i)=>{members[i]=v.id;});
      const applications: string[]=[];
      for (let i=0;i<members.length;i++) {
        const app=id(`app:${n}:${i}`), pay=id(`payment:${n}:${i}`), grant=id(`grant:${n}:${i}`);
        const three = i%4===0, amount=three?15000:8000, uses=three?3:1;
        const created = new Date(Math.min(start.getTime()-3*86400000,Date.now()-((n*6+i+1)*3600000)));
        await client.query(`INSERT INTO applications(id,user_id,request_key,pass_choice,pass_uses,amount_cents,created_at,is_demo) VALUES($1,$2,$3,$4,$5,$6,$7,TRUE)`,[app,members[i],id(`request:${n}:${i}`),three?'THREE_PASS':'SINGLE',uses,amount,created]);
        await client.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',[app,eventId]);
        await client.query("INSERT INTO payments(id,application_id,idempotency_key,status,amount_cents,provider,created_at) VALUES($1,$2,$3,'PAID',$4,'MOCK',$5)",[pay,app,`mock-payment:${app}`,amount,created]);
        await client.query('INSERT INTO entitlements(id,user_id,source_payment_id,original_uses,remaining_uses,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[grant,members[i],pay,uses,uses-1,three?new Date(Date.now()+45*86400000):null]);
        await client.query("INSERT INTO entitlement_entries(entitlement_id,application_id,entry_type) VALUES($1,$2,'USE')",[grant,app]);
        await client.query(`INSERT INTO notifications(event_id,recipient_user_id,message,channel,status,sent_by,created_at) VALUES($1,$2,$3,'IN_APP','SENT',$4,$5)`,[eventId,members[i],`[모의] 참가 신청과 ${amount.toLocaleString('ko-KR')}원 모의 결제가 완료되었어요.`,adminId,created]);
        applications.push(app); applicationCount++;
      }
      if (['past','confirmed','unmatched'].includes(cohort.state)) {
        // Build historical demo tables through the same matching path inside this transaction.
        // Real matching excludes past events. No temporary dates escape the seed transaction.
        if(cohort.state==='past')await client.query('UPDATE events SET starts_at=$2,ends_at=$3 WHERE id=$1',[eventId,new Date(Date.now()+86400000),new Date(Date.now()+93600000)]);
        const result=await runMatching(eventId,`${batch}:${n}`,client);
        if(cohort.state==='past')await client.query('UPDATE events SET starts_at=$2,ends_at=$3 WHERE id=$1',[eventId,start,end]);
        const tables=await client.query<any>('SELECT id FROM dining_tables WHERE event_id=$1',[eventId]);
        for (const table of tables.rows) {
          tableCount++;
          const roster=await client.query<any>(`SELECT tm.application_id,tm.user_id,pr.birth_year,pr.gender,pr.mbti,pr.interests,pr.traits,pr.desired_traits FROM table_members tm JOIN profiles pr ON pr.user_id=tm.user_id WHERE tm.table_id=$1 AND tm.status='ACTIVE'`,[table.id]);
          await provisionTable(client,table.id,eventId,roster.rows.map(r=>({applicationId:r.application_id,userId:r.user_id,birthYear:r.birth_year,gender:r.gender,mbti:r.mbti,interests:typeof r.interests==='string'?JSON.parse(r.interests):r.interests,traits:[],desiredTraits:[],eventIds:[eventId],paid:true,valid:true})));
          const room=(await client.query<any>('SELECT id FROM journey_rooms WHERE table_id=$1',[table.id])).rows[0].id;
          for (let m=0;m<chat.length;m++) await client.query(`INSERT INTO journey_messages(id,room_id,author_user_id,body,request_key,kind,created_at) VALUES($1,$2,$3,$4,$5,'USER',$6)`,
            [id(`chat:${n}:${table.id}:${m}`),room,roster.rows[m%roster.rowCount].user_id,chat[m],id(`chat-key:${n}:${table.id}:${m}`),new Date(Math.min(Date.now(),start.getTime())-(chat.length-m)*3600000)]);
          if (cohort.state==='past') {
            for (let r=0;r<roster.rows.length;r++) {
              const member=roster.rows[r], attended=r!==5;
                    await client.query('UPDATE attendance_records SET status=$2,checked_in_at=$3,checked_by=$4,checked_at=$3 WHERE application_id=$1 AND event_id=$5',[member.application_id,attended?'ATTENDED':'NO_SHOW',attended?start:null,adminId,eventId]);
                    if (attended) await client.query(`INSERT INTO journey_feedback(id,table_id,author_user_id,table_score,conversation_score,venue_score,return_intent,recommend_intent,comment,created_at,is_demo) VALUES($1,$2,$3,$4,$5,$6,true,true,$7,$8,TRUE)`,
                      [id(`feedback:${n}:${r}`),table.id,member.user_id,r%3?5:4,r%2?5:4,4,feedbackText[r%4],new Date(end.getTime()+3000000)]);
            }
            await client.query(`UPDATE scheduled_jobs SET status='DONE',completed_at=$2 WHERE payload->>'tableId'=$1`,[table.id,end],`UPDATE scheduled_jobs SET status='DONE',completed_at=$2 WHERE json_extract(payload,'$.tableId')=$1`);
          }
        }
        if (cohort.state!=='unmatched' && result.matchedCount!==members.length) throw new Error(`Demo cohort ${n}: incomplete matching ${result.matchedCount}/${members.length}`);
      }
      if (cohort.state==='waiting') await client.query(`INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'MATCH_EVENT',$2,$3) ON CONFLICT(job_key) DO NOTHING`,[`match-event:${eventId}`,json({eventId}),deadline]);
      if (cohort.state==='refund') {
        for (let i=0;i<applications.length;i++) {
          const app=applications[i], resolution=id(`refund-case:${i}`), payment=id(`payment:${n}:${i}`);
          const amount=i%4===0?15000:8000;
          await client.query("UPDATE applications SET status='CANCELED',matching_status='NO_MATCH' WHERE id=$1",[app]);
          await client.query("UPDATE payments SET status='REFUNDED' WHERE id=$1",[payment]);
          await client.query('UPDATE entitlements SET remaining_uses=0 WHERE source_payment_id=$1',[payment]);
          await client.query(`INSERT INTO resolution_cases(id,application_id,status,version,reason,alternatives,selected_choice,result_payload) VALUES($1,$2,'REFUNDED',1,'[모의] 일정 변경에 따른 환불','[]','REFUND',$3)`,[resolution,app,json({status:'REFUND',source:'DEMO'})]);
          await client.query(`INSERT INTO refund_requests(id,resolution_id,payment_id,request_key,amount_cents,status) VALUES($1,$2,$3,$4,$5,'COMPLETED')`,[id(`refund:${i}`),resolution,payment,`refund:${resolution}`,amount]);
        }
      }
    }
    await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'DEMO_OPERATIONS_SEEDED','demo_batch',$2,$3)`,[adminId,id('batch'),json({batch,users:48,events:cohorts.length,applications:applicationCount,tables:tableCount,synthetic:true})]);
    await client.query('COMMIT');
    return {created:true,batch,users:48,events:cohorts.length,applications:applicationCount,tables:tableCount};
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

if (process.argv[1]?.endsWith('seed-operations.ts')) seedOperations().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.end());
