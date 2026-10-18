import {type QueryClient} from './db';
import {parseJson} from './operators';
export type InsightSource='real'|'demo'|'all';
export async function feedbackInsights(client:Pick<QueryClient,'query'>,source:InsightSource,from:string,to:string){
 const records=(await client.query<any>(`SELECT t.id table_id,t.match_run_id,e.starts_at,e.ends_at,e.title,e.is_demo event_demo,
  r.rule_version,p.name policy_name,tm.user_id,a.is_demo application_demo,u.is_demo user_demo,
  ar.status attendance_status,f.id feedback_id,f.is_demo feedback_demo,f.table_score,f.conversation_score,f.venue_score,f.return_intent,
  f.recommend_intent,f.comment,f.created_at feedback_at,fd.positives,fd.improvements,fd.good_text,fd.improve_text
  FROM dining_tables t JOIN events e ON e.id=t.event_id JOIN match_runs r ON r.id=t.match_run_id
  LEFT JOIN matching_policies p ON p.id=r.rule_version
  LEFT JOIN table_members tm ON tm.table_id=t.id AND tm.status='ACTIVE' LEFT JOIN applications a ON a.id=tm.application_id
  LEFT JOIN users u ON u.id=tm.user_id LEFT JOIN attendance_records ar ON ar.application_id=tm.application_id AND ar.event_id=e.id
  LEFT JOIN journey_feedback f ON f.table_id=t.id AND f.author_user_id=tm.user_id LEFT JOIN feedback_details fd ON fd.feedback_id=f.id
  WHERE e.starts_at >= $1 AND e.starts_at < $2 AND t.status='CONFIRMED' ORDER BY e.starts_at,t.id,tm.user_id`,[from,to])).rows
  .filter(r=>new Date(r.ends_at??new Date(new Date(r.starts_at).getTime()+7200000)).getTime()<=Date.now());
 const submissions=(await client.query<any>(`SELECT a.user_id,a.created_at,a.is_demo,u.is_demo user_demo FROM applications a JOIN users u ON u.id=a.user_id
  JOIN payments p ON p.application_id=a.id WHERE a.status='SUBMITTED' AND p.status='PAID' ORDER BY a.created_at`)).rows;
 type Bucket={policyId:string;policyName:string;source:string;tables:Set<string>;attendees:Set<string>;feedback:Set<string>;reapplications:Set<string>;tableTotal:number;conversationTotal:number;venueTotal:number;returnIntent:number;recommendIntent:number;positiveTags:Record<string,number>;improvementTags:Record<string,number>;};
 const buckets=new Map<string,Bucket>(),latest:any[]=[];
 for(const r of records){
  const demo=Boolean(r.event_demo||r.application_demo||r.user_demo),kind=demo?'demo':'real';
  if(source!=='all'&&source!==kind)continue;
  const key=`${r.rule_version}:${kind}`;
  let b=buckets.get(key);if(!b){b={policyId:r.rule_version,policyName:r.policy_name??r.rule_version,source:kind,tables:new Set(),attendees:new Set(),feedback:new Set(),reapplications:new Set(),tableTotal:0,conversationTotal:0,venueTotal:0,returnIntent:0,recommendIntent:0,positiveTags:{},improvementTags:{}};buckets.set(key,b);}
  b.tables.add(r.table_id);
  if(r.attendance_status!=='ATTENDED'||!r.user_id)continue;
  const attendee=`${r.table_id}:${r.user_id}`;b.attendees.add(attendee);
  const end=new Date(r.ends_at??new Date(new Date(r.starts_at).getTime()+7200000)).getTime();
  if(submissions.some(a=>a.user_id===r.user_id&&Boolean(a.is_demo||a.user_demo)===demo&&new Date(a.created_at).getTime()>end))b.reapplications.add(attendee);
  if(!r.feedback_id||Boolean(r.feedback_demo)!==demo||b.feedback.has(r.feedback_id))continue;
  b.feedback.add(r.feedback_id);b.tableTotal+=Number(r.table_score);b.conversationTotal+=Number(r.conversation_score);b.venueTotal+=Number(r.venue_score);
  b.returnIntent+=r.return_intent?1:0;b.recommendIntent+=r.recommend_intent?1:0;
  for(const tag of new Set(parseJson<string[]>(r.positives,[])))b.positiveTags[tag]=(b.positiveTags[tag]??0)+1;
  for(const tag of new Set(parseJson<string[]>(r.improvements,[])))b.improvementTags[tag]=(b.improvementTags[tag]??0)+1;
  latest.push({id:r.feedback_id,policyName:b.policyName,source:kind,title:r.title,createdAt:new Date(r.feedback_at).toISOString(),conversationScore:r.conversation_score,venueScore:r.venue_score,comment:r.comment,goodText:r.good_text??'',improveText:r.improve_text??''});
 }
 const metrics=[...buckets.values()].map(b=>({policyId:b.policyId,policyName:b.policyName,source:b.source,tables:b.tables.size,attendees:b.attendees.size,feedbackCount:b.feedback.size,responseRate:b.attendees.size?b.feedback.size/b.attendees.size:null,
  tableScore:b.feedback.size?b.tableTotal/b.feedback.size:null,conversationScore:b.feedback.size?b.conversationTotal/b.feedback.size:null,venueScore:b.feedback.size?b.venueTotal/b.feedback.size:null,
  returnIntent:b.returnIntent,recommendIntent:b.recommendIntent,actualReapplications:b.reapplications.size,reapplicationRate:b.attendees.size?b.reapplications.size/b.attendees.size:null,positiveTags:b.positiveTags,improvementTags:b.improvementTags}));
 const support=(await client.query<any>(`SELECT t.is_demo ticket_demo,t.category,t.status,t.created_at,t.resolved_at,t.first_response_at,u.is_demo user_demo,
  a.is_demo application_demo,e.is_demo event_demo FROM support_tickets t LEFT JOIN users u ON u.id=t.user_id
  LEFT JOIN applications a ON a.id=t.application_id LEFT JOIN dining_tables dt ON dt.id=t.table_id LEFT JOIN events e ON e.id=dt.event_id
  WHERE t.created_at >= $1 AND t.created_at < $2`,[from,to])).rows.filter(r=>source==='all'||source===(r.ticket_demo||r.user_demo||r.application_demo||r.event_demo?'demo':'real'));
 const categories:Record<string,number>={};let responseHours=0,responseCount=0;
 for(const row of support){categories[row.category]=(categories[row.category]??0)+1;if(row.first_response_at){responseHours+=(new Date(row.first_response_at).getTime()-new Date(row.created_at).getTime())/3600000;responseCount++;}}
 const improvements=(await client.query('SELECT i.id,i.title,i.status,count(l.ticket_id) linked_tickets FROM improvement_items i LEFT JOIN improvement_tickets l ON l.item_id=i.id GROUP BY i.id,i.title,i.status ORDER BY i.created_at DESC LIMIT 20')).rows;
 return {source,from,to,metrics,latest:latest.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20),support:{count:support.length,categories,averageFirstResponseHours:responseCount?responseHours/responseCount:null,unresolved:support.filter(r=>r.status!=='RESOLVED').length},improvements,
  insufficientData:metrics.filter(m=>m.source==='real'&&m.feedbackCount>=3).length<2,
  note:'재참여 의향과 실제 재신청은 별도 지표입니다. 정책별 차이는 표본·기간·참가자 구성이 달라 원인으로 단정할 수 없습니다.'};
}
