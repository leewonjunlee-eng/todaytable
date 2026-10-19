import {db,type QueryClient} from './db';
import {activeShowcase} from './showcase';
import {REGIONS} from './domain';
import {parseJson} from './operators';

const day=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const weekday=(value:string)=>new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',weekday:'short'}).format(new Date(value));
/** Returning-user suggestions use only that person's own choices, attendance and feedback. */
export async function nextEvents(userId:string,limit=3,client:Pick<QueryClient,'query'>=db){
 const [events,choices,past,booked,preference,profile]=await Promise.all([
  client.query<any>(`SELECT e.id,e.title,e.starts_at,e.ends_at,e.area,e.application_deadline,e.venue_id,v.name venue_name,vp.interest_tags,vp.atmosphere FROM events e LEFT JOIN venues v ON v.id=e.venue_id LEFT JOIN venue_profiles vp ON vp.venue_id=v.id WHERE e.status='OPEN' AND e.starts_at>now() AND e.application_deadline>now() AND (SELECT count(*) FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=e.id AND tm.status='ACTIVE' AND t.status='CONFIRMED')<e.capacity ORDER BY e.starts_at`,[],`SELECT e.id,e.title,e.starts_at,e.ends_at,e.area,e.application_deadline,e.venue_id,v.name venue_name,vp.interest_tags,vp.atmosphere FROM events e LEFT JOIN venues v ON v.id=e.venue_id LEFT JOIN venue_profiles vp ON vp.venue_id=v.id WHERE e.status='OPEN' AND e.starts_at>CURRENT_TIMESTAMP AND e.application_deadline>CURRENT_TIMESTAMP AND (SELECT count(*) FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=e.id AND tm.status='ACTIVE' AND t.status='CONFIRMED')<e.capacity ORDER BY e.starts_at`),
  client.query<any>(`SELECT e.id,e.area,e.starts_at,a.created_at FROM application_options o JOIN applications a ON a.id=o.application_id JOIN payments p ON p.application_id=a.id JOIN events e ON e.id=o.event_id WHERE a.user_id=$1 AND a.status='SUBMITTED' AND p.status='PAID' ORDER BY a.created_at DESC`,[userId]),
  client.query<any>(`SELECT e.starts_at,e.ends_at,e.area,t.venue_id,f.table_score,f.conversation_score,f.venue_score,f.return_intent FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id JOIN attendance_records ar ON ar.application_id=tm.application_id AND ar.event_id=e.id LEFT JOIN journey_feedback f ON f.table_id=t.id AND f.author_user_id=$1 WHERE tm.user_id=$1 AND tm.status='ACTIVE' AND ar.status='ATTENDED' AND t.status='CONFIRMED' ORDER BY e.starts_at DESC`,[userId]),
  client.query<any>(`SELECT e.starts_at,e.ends_at FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.user_id=$1 AND tm.status='ACTIVE' AND t.status='CONFIRMED' AND e.starts_at>now()`,[userId],`SELECT e.starts_at,e.ends_at FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.user_id=$1 AND tm.status='ACTIVE' AND t.status='CONFIRMED' AND e.starts_at>CURRENT_TIMESTAMP`),
  client.query<any>('SELECT interests,atmosphere,confirmed,learning_enabled FROM participant_preferences WHERE user_id=$1',[userId]),
  client.query<any>('SELECT interests FROM profiles WHERE user_id=$1',[userId]),
 ]);
 const now=Date.now(),selected=new Set(choices.rows.filter(c=>new Date(c.starts_at).getTime()>now).map(c=>c.id));
 const history=past.rows.filter(p=>new Date(p.ends_at??new Date(new Date(p.starts_at).getTime()+7200000)).getTime()<=now).slice(0,12);
 const recentChoices=choices.rows.filter(c=>new Date(c.created_at).getTime()>now-180*86400000);
 const confirmed=preference.rows[0]?.confirmed===true||preference.rows[0]?.confirmed===1;
 const interests=parseJson<string[]>(confirmed?preference.rows[0]?.interests:profile.rows[0]?.interests,[]);
 const atmosphere=confirmed?preference.rows[0]?.atmosphere:null;
 const learning=preference.rows[0]?.learning_enabled!==false&&preference.rows[0]?.learning_enabled!==0;
 const showcase=await activeShowcase(client);
 const scored=events.rows.filter(e=>(!showcase||showcase.summary.eventIds.includes(e.id))&&(REGIONS as readonly string[]).includes(e.area)&&!selected.has(e.id)&&!booked.rows.some(b=>new Date(b.starts_at).getTime()<new Date(e.ends_at??new Date(new Date(e.starts_at).getTime()+7200000)).getTime()&&new Date(e.starts_at).getTime()<new Date(b.ends_at??new Date(new Date(b.starts_at).getTime()+7200000)).getTime())).map(e=>{
  let score=0;const reasons:string[]=[];
  const areaHistory=history.filter(p=>p.area===e.area),areaChoices=recentChoices.filter(c=>c.area===e.area);
  if(areaHistory.length){score+=Math.min(areaHistory.length,3)*12;reasons.push('이전에 참석한 지역의 일정이에요.');}else if(areaChoices.length){score+=Math.min(areaChoices.length,3)*5;reasons.push('이전에 선택한 지역을 반영했어요.');}
  if(history.some(p=>weekday(p.starts_at)===weekday(e.starts_at))||recentChoices.some(c=>weekday(c.starts_at)===weekday(e.starts_at))){score+=6;reasons.push('익숙한 요일의 저녁이에요.');}
  if(learning&&areaHistory.some(p=>Number(p.table_score)>=4&&Number(p.conversation_score)>=4&&p.return_intent)){score+=12;reasons.unshift('좋은 후기를 남긴 지역의 다음 만남이에요.');}
  const shared=interests.filter(i=>parseJson<string[]>(e.interest_tags,[]).includes(i));
  if(shared.length){score+=Math.min(shared.length,3)*4;reasons.push(confirmed?'직접 확인한 관심사와 어울리는 공간이에요.':'나의 관심사와 어울리는 공간이에요.');}
  if(atmosphere&&parseJson<string[]>(e.atmosphere,[]).includes(atmosphere)){score+=5;reasons.push('직접 확인한 분위기 취향을 반영했어요.');}
  if(learning&&e.venue_id&&history.some(p=>p.venue_id===e.venue_id&&Number(p.venue_score)>0&&Number(p.venue_score)<=2&&new Date(p.starts_at).getTime()>now-180*86400000))score-=40;
  if(!reasons.length)reasons.push('신청 가능한 가까운 일정부터 살펴보세요.');
  return {id:e.id,title:e.title,starts_at:e.starts_at,area:e.area,application_deadline:e.application_deadline,venue_name:e.venue_name??null,reasons:[...new Set(reasons)].slice(0,2),href:`/apply?day=${day(e.starts_at)}&area=${encodeURIComponent(e.area)}`,score};
 });
 return scored.sort((a,b)=>b.score-a.score||new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime()||a.id.localeCompare(b.id)).slice(0,Math.max(0,Math.min(limit,12))).map(({score,...event})=>event);
}
