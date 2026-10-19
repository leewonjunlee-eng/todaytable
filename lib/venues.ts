import {db,type QueryClient} from './db';
import {parseJson} from './operators';
import {sharedInterestKeywords} from './table-experience';
export async function venueCatalog(client:Pick<QueryClient,'query'>=db,includePrivate=false){
 const rows=(await client.query<any>(`SELECT v.*,vp.cuisine,vp.description,vp.atmosphere,vp.interest_tags,vp.price_min,vp.price_max,vp.dietary_support,vp.contact_phone,vp.booking_url FROM venues v LEFT JOIN venue_profiles vp ON vp.venue_id=v.id WHERE v.active=true ORDER BY v.area,v.name,v.id`)).rows;
 const publicReviews=(await client.query<any>(`SELECT r.id,r.feedback_id,r.venue_id,r.score,r.body,r.created_at,'식탁 멤버' author_name FROM venue_public_reviews r ORDER BY r.created_at DESC`)).rows;
 const privateReviews=includePrivate?(await client.query<any>(`SELECT f.id,t.venue_id,f.venue_score score,f.comment body,f.created_at,p.display_name author_name FROM journey_feedback f JOIN dining_tables t ON t.id=f.table_id JOIN table_members tm ON tm.table_id=t.id AND tm.user_id=f.author_user_id AND tm.status='ACTIVE' JOIN attendance_records ar ON ar.application_id=tm.application_id AND ar.event_id=t.event_id AND ar.status='ATTENDED' LEFT JOIN profiles p ON p.user_id=f.author_user_id WHERE t.venue_id IS NOT NULL ORDER BY f.created_at DESC`)).rows:[];
 return rows.map(v=>{const reviews=publicReviews.filter(r=>r.venue_id===v.id);const feedback=privateReviews.filter(r=>r.venue_id===v.id&&!publicReviews.some(p=>p.feedback_id===r.id));return {...v,atmosphere:parseJson<string[]>(v.atmosphere,[]),interestTags:parseJson<string[]>(v.interest_tags,[]),dietarySupport:parseJson<string[]>(v.dietary_support,[]),priceMin:Number(v.price_min??20000),priceMax:Number(v.price_max??30000),cuisine:v.cuisine??'다이닝',description:v.description??'편안하게 이야기를 나누는 식탁',reviews:reviews.slice(0,8),privateFeedback:feedback.slice(0,8),reviewCount:reviews.length,averageScore:reviews.length?reviews.reduce((n,r)=>n+Number(r.score),0)/reviews.length:null};});
}
const budgetFits=(v:any,budgets:string[])=>!budgets.length||budgets.includes('ANY')||budgets.some(b=>b==='UNDER_20000'?v.priceMax<=20000:b==='20000_30000'?v.priceMin>=20000&&v.priceMax<=30000:b==='OVER_30000'?v.priceMin>=30000:false);
export async function recommendVenues(client:Pick<QueryClient,'query'>,event:any,members:any[],options:{proposalId?:string;sourceTableId?:string}={}){
 const venues=(await venueCatalog(client)).filter(v=>v.area===event.area);
 const slots=(await client.query<any>('SELECT * FROM venue_slots')).rows;
 const dietaryChecks=(await client.query<any>('SELECT * FROM venue_dietary_checks WHERE valid_until>now()')).rows;
 const occupied=(await client.query<any>(`SELECT t.venue_id,t.id,t.capacity,e.starts_at,COALESCE(e.ends_at,e.starts_at+interval '2 hours') ends_at FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE t.status='CONFIRMED'`,[],`SELECT t.venue_id,t.id,t.capacity,e.starts_at,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) ends_at FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE t.status='CONFIRMED'`)).rows;
 const reserved=(await client.query<any>(`SELECT p.id,p.venue_id,p.source_table_id,p.candidates,e.starts_at,COALESCE(e.ends_at,e.starts_at+interval '2 hours') ends_at FROM matching_proposals p JOIN events e ON e.id=p.event_id WHERE p.status IN ('PENDING','HELD')`,[],`SELECT p.id,p.venue_id,p.source_table_id,p.candidates,e.starts_at,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) ends_at FROM matching_proposals p JOIN events e ON e.id=p.event_id WHERE p.status IN ('PENDING','HELD')`)).rows;
 const profiles=(await client.query<any>('SELECT user_id,food_budgets,dietary_notes FROM profiles')).rows;const profileById=new Map(profiles.map(p=>[p.user_id,p]));
 const interests=sharedInterestKeywords(members).map(k=>k.label),start=new Date(event.starts_at).getTime(),end=new Date(event.ends_at??new Date(start+7200000)).getTime();
 const overlaps=(r:any)=>new Date(r.starts_at).getTime()<end&&start<new Date(r.ends_at).getTime();
 return venues.map(v=>{const used=occupied.filter(r=>r.venue_id===v.id&&r.id!==options.sourceTableId&&overlaps(r)).reduce((n,r)=>n+Number(r.capacity??6),0)+reserved.filter(r=>r.venue_id===v.id&&r.id!==options.proposalId&&(!options.sourceTableId||r.source_table_id!==options.sourceTableId)&&overlaps(r)).reduce((n,r)=>n+parseJson<any[]>(r.candidates,[]).length,0);
 const applicable=slots.filter(r=>r.venue_id===v.id&&overlaps(r)),covering=applicable.filter(r=>+new Date(r.starts_at)<=start&&+new Date(r.ends_at)>=end);
 const slotOk=(!v.schedule_required&&!slots.some(r=>r.venue_id===v.id)||covering.length>0)&&!applicable.some(r=>r.closed);
 const seatLimit=covering.length?Math.min(Number(v.capacity),...covering.map(r=>Number(r.seats))):Number(v.capacity);
 const tablesUsed=occupied.filter(r=>r.venue_id===v.id&&r.id!==options.sourceTableId&&overlaps(r)).length+reserved.filter(r=>r.venue_id===v.id&&r.id!==options.proposalId&&(!options.sourceTableId||r.source_table_id!==options.sourceTableId)&&overlaps(r)).length;
 const tableLimit=covering.length?Math.min(...covering.map(r=>Number(r.table_limit))):Number.POSITIVE_INFINITY;
 const budgetOk=members.every(m=>budgetFits(v,parseJson(profileById.get(m.userId)?.food_budgets,[]))),capacityOk=slotOk&&seatLimit-used>=members.length&&tablesUsed<tableLimit;
 const common=interests.filter(i=>v.interestTags.includes(i));const calm=members.some(m=>m.atmosphere==='CALM'||m.atmosphere==='DEEP');const atmosphereOk=!calm||v.atmosphere.some((a:string)=>['CALM','QUIET'].includes(a));
 const dietary=members.filter(m=>{const notes=profileById.get(m.userId)?.dietary_notes;return typeof notes==='string'&&notes.trim()&&!dietaryChecks.some(d=>d.venue_id===v.id&&d.user_id===m.userId&&d.notes===notes&&+new Date(d.valid_until)>=end);});
 const reasons=[`${event.area} 지역`,budgetOk?'참가자 식사 예산에 맞음':'식사 예산 확인 필요',...common.map(i=>`${i}와 어울리는 공간`),...(calm&&atmosphereOk?['조용한 대화 분위기']:[]),`남은 수용 인원 ${Math.max(0,seatLimit-used)}명`];
 return {...v,eligible:budgetOk&&capacityOk,availableSeats:Math.max(0,seatLimit-used),score:common.length*3+(atmosphereOk?2:0)+(v.averageScore??0)/5,warnings:[...(!slotOk?['해당 날짜·시간의 영업 슬롯을 확인해 주세요.']:[]),...(dietary.length?['음식·알레르기 요청이 있어 식당에 사전 확인이 필요합니다.']:[])],requiresDietaryConfirmation:dietary.length>0,reasons};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score||a.name.localeCompare(b.name));
}
