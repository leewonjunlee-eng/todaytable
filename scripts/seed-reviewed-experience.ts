/** Additive showcase content. Never promotes existing private feedback to public reviews. */
import {createHash} from 'node:crypto';
import {db,databaseProvider} from '../lib/db';
import {runMatching} from '../lib/lifecycle-service';
import {REGIONS} from '../lib/domain';
const id=(s:string)=>{const h=createHash('sha256').update(`reviewed-experience-v1:${s}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const styles=[{cuisine:'계절 한식',description:'따뜻한 한 끼와 길게 이어지는 이야기를 위한 작은 다이닝. 여럿이 둘러앉아 편안하게 대화를 나눌 수 있어요.',tags:['맛집·카페 탐방','여행'],atmosphere:['CALM','QUIET']},{cuisine:'이탈리안',description:'파스타와 함께 가벼운 안부부터 여행 이야기까지 나누는 곳. 처음 만나는 자리에도 편안한 분위기가 이어져요.',tags:['여행','영화·드라마'],atmosphere:['BALANCED']},{cuisine:'모던 한식',description:'퇴근 후 천천히 저녁을 즐기는 식탁. 정갈한 한 상과 서로의 하루에 귀 기울이기 좋은 공간이에요.',tags:['독서·글쓰기','음악'],atmosphere:['CALM','QUIET']},{cuisine:'컨템퍼러리 다이닝',description:'오래된 골목에서 새로운 취향을 만나는 저녁. 공연과 전시, 좋아하는 이야기를 나누기 좋은 식탁이에요.',tags:['전시·공연·아트','사진·영상'],atmosphere:['BALANCED','QUIET']}];
const reviewBodies=['옆자리와 이야기하기 편한 간격이라 처음 만난 분들과도 대화가 자연스럽게 이어졌어요.','음식이 한 번에 나와 함께 식사하기 좋았고, 저녁 내내 서두르지 않고 이야기할 수 있었어요.','찾아가기 편했고 둘러앉는 자리가 특히 좋았어요. 다음에도 이 근처에서 만나고 싶어요.'];
export async function seedReviewedExperience(){
 const c=await db.connect();let profiles=0,reviews=0,registrations=0;
 try{await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
  const venues=(await c.query<any>("SELECT id,name,area FROM venues WHERE active=true ORDER BY area,name")).rows;
  const authors=(await c.query<any>("SELECT u.id FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.is_demo=true AND u.role='PARTICIPANT' ORDER BY u.id LIMIT 12")).rows;
  for(const v of venues){
   const index=REGIONS.indexOf(v.area);if(index<0)continue;const style=styles[index];
   profiles+=(await c.query('INSERT INTO venue_profiles(venue_id,cuisine,description,atmosphere,interest_tags,price_min,price_max) VALUES($1,$2,$3,$4,$5,20000,30000) ON CONFLICT(venue_id) DO NOTHING',[v.id,style.cuisine,style.description,JSON.stringify(style.atmosphere),JSON.stringify(style.tags)])).rowCount;
   // Only the existing fictional showcase venues receive new fictional public review content.
   if(!['온기 다이닝','잠실 작은식탁','논현 저녁정원','종로 취향살롱'].includes(v.name))continue;
   for(let n=0;n<3&&authors.length;n++)reviews+=(await c.query('INSERT INTO venue_public_reviews(id,venue_id,author_user_id,score,body,is_demo) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(id) DO NOTHING',[id(`review:${v.id}:${n}`),v.id,authors[(index*3+n)%authors.length].id,n===1?4:5,reviewBodies[n]])).rowCount;
  }
  const options=(await c.query<any>(`SELECT a.id,a.user_id,e.starts_at,e.area FROM applications a JOIN application_options o ON o.application_id=a.id JOIN events e ON e.id=o.event_id WHERE a.status='SUBMITTED' AND a.matching_status IN ('WAITING','MATCHING','REALLOCATING') ORDER BY a.id,e.starts_at`)).rows;
  for(const appId of new Set(options.map(o=>o.id))){
   const rows=options.filter(o=>o.id===appId),dates=[...new Set(rows.map(o=>new Date(o.starts_at).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'})))].sort(),areas=[...new Set(rows.map(o=>o.area))].sort();
   registrations+=(await c.query('INSERT INTO availability_registrations(id,user_id,application_id,dates,areas,request_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(application_id) DO NOTHING',[id(`availability:${appId}`),rows[0].user_id,appId,JSON.stringify(dates),JSON.stringify(areas),`legacy:${appId}`])).rowCount;
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 const events=(await db.query<any>("SELECT id FROM events WHERE status IN ('OPEN','CLOSED') AND starts_at>now() ORDER BY starts_at")).rows;let proposed=0;
 for(const event of events)proposed+=(await runMatching(event.id,'reviewed-experience-v1')).proposedCount;
 return {profiles,reviews,registrations,proposed};
}
if(process.argv[1]?.endsWith('seed-reviewed-experience.ts'))seedReviewedExperience().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.end());
