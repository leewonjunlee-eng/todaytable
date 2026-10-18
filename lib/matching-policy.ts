import {normalizeInterests} from './feedback-domain';
import {createHash} from 'node:crypto';
import {db,type QueryClient} from './db';
import {parseJson,problem} from './operators';
import {buildDeterministicGroups,type MatchCandidate,type MatchWeights,type MatchGroup} from './matching';
export const POLICY_PRESETS=[
 {id:'balanced-v1',name:'균형형',description:'취향과 새로운 만남, 식탁의 구성을 두루 살펴요.',weights:{gender:.35,mbti:.1,interests:.3,traits:.15,novelty:.1}},
 {id:'affinity-v1',name:'공감·취향형',description:'공통 관심사에서 시작되는 자연스러운 대화를 준비해요.',weights:{gender:.2,mbti:.05,interests:.5,traits:.2,novelty:.05}},
 {id:'discovery-v1',name:'새로운 발견형',description:'처음 만나는 사람과 새로운 관점을 발견해요.',weights:{gender:.25,mbti:.05,interests:.2,traits:.15,novelty:.35}},
 {id:'conversation-v1',name:'편안한 대화형',description:'대화의 분위기와 서로가 원하는 성향을 더 살펴요.',weights:{gender:.2,mbti:.05,interests:.25,traits:.4,novelty:.1}},
];
export type MatchingPolicy={id:string;name:string;description:string;weights:MatchWeights;minScore:number;learningEnabled:boolean};
export async function effectivePolicy(client:Pick<QueryClient,'query'>,eventId:string):Promise<MatchingPolicy>{
 const selected=await client.query<any>(`SELECT p.* FROM matching_policies p WHERE p.id=COALESCE((SELECT policy_id FROM event_policies WHERE event_id=$1),(SELECT policy_id FROM matching_defaults WHERE id=1))`,[eventId]);
 if(selected.rowCount){const p=selected.rows[0];return {id:p.id,name:p.name,description:p.description,weights:parseJson(p.weights,POLICY_PRESETS[0].weights),minScore:Number(p.min_score),learningEnabled:Boolean(p.learning_enabled)};}
 const fallback=(await client.query<any>('SELECT version,min_score,weights FROM matching_rules WHERE id=1')).rows[0];
 return {id:fallback?.version??'core-v1',name:'기존 운영 기준',description:'기존 매칭 규칙',weights:parseJson(fallback?.weights,{gender:.4,mbti:.25,interests:.2,traits:.1,novelty:.05}),minScore:Number(fallback?.min_score??0),learningEnabled:false};
}
export async function enrichCandidates(client:Pick<QueryClient,'query'>,candidates:MatchCandidate[],enabled:boolean){
 if(!enabled)return candidates;
 const [prefs,signals]=await Promise.all([client.query<any>('SELECT p.user_id,p.atmosphere,p.interests FROM participant_preferences p LEFT JOIN journey_feedback f ON f.id=p.source_feedback_id WHERE p.confirmed=true AND p.learning_enabled=true AND (p.source_feedback_id IS NULL OR f.is_demo=false)'),client.query<any>('SELECT s.user_id,s.atmosphere,s.interests,s.confidence,s.evidence_count FROM preference_signals s LEFT JOIN participant_preferences p ON p.user_id=s.user_id WHERE s.evidence_count>=3 AND (p.learning_enabled=true OR p.user_id IS NULL)')]);
 const byPref=new Map(prefs.rows.map(r=>[r.user_id,r])),bySignal=new Map(signals.rows.map(r=>[r.user_id,r]));
 return candidates.map(c=>{const pref=byPref.get(c.userId),signal=bySignal.get(c.userId);return {...c,atmosphere:pref?.atmosphere??signal?.atmosphere,preferredInterests:normalizeInterests(parseJson(pref?.interests,[])),learnedInterests:normalizeInterests(parseJson(signal?.interests,[])),signalConfidence:pref?1:Number(signal?.confidence??0)};});
}
export async function matchingInput(client:Pick<QueryClient,'query'>,eventId:string,preview=false,includeReserved=false){
 const events=(await client.query<any>("SELECT id,title,status,area,capacity,starts_at,application_deadline,COALESCE(ends_at,starts_at+interval '2 hours') ends_at,is_demo FROM events WHERE status IN ('OPEN','CLOSED') ORDER BY id",[],"SELECT id,title,status,area,capacity,starts_at,application_deadline,COALESCE(ends_at,datetime(starts_at,'+2 hours')) ends_at,is_demo FROM events WHERE status IN ('OPEN','CLOSED') ORDER BY id")).rows;
 const event=events.find(e=>e.id===eventId);if(!event)problem('신청 가능한 회차를 찾을 수 없어요.',404);
 const eligible=new Set(events.filter(e=>new Date(e.starts_at).getTime()>Date.now()&&((preview&&e.id===eventId)||new Date(e.application_deadline).getTime()<=Date.now())).map(e=>e.id));
 const options=(await client.query<any>('SELECT application_id,event_id FROM application_options ORDER BY application_id,event_id')).rows;
 const optionMap=new Map<string,string[]>();for(const o of options)if(eligible.has(o.event_id))optionMap.set(o.application_id,[...(optionMap.get(o.application_id)??[]),o.event_id]);
 const component=new Set([eventId]);let changed=true;while(changed){changed=false;for(const ids of optionMap.values())if(ids.some(e=>component.has(e)))for(const e of ids)if(!component.has(e)){component.add(e);changed=true;}}
 const rows=(await client.query<any>(`SELECT DISTINCT a.id application_id,a.user_id,pr.birth_year,pr.gender,pr.mbti,pr.interests,pr.traits,pr.desired_traits,a.is_demo FROM applications a JOIN users u ON u.id=a.user_id JOIN payments p ON p.application_id=a.id JOIN profiles pr ON pr.user_id=a.user_id WHERE a.status='SUBMITTED' AND a.matching_status IN ('WAITING','REALLOCATING'${includeReserved?",'MATCHING'":''}) AND p.status='PAID' AND u.restricted_status='ACTIVE' AND pr.consent_privacy AND pr.consent_operations AND NOT EXISTS(SELECT 1 FROM table_members tm WHERE tm.application_id=a.id AND tm.status='ACTIVE') AND NOT EXISTS(SELECT 1 FROM matching_proposal_members pm JOIN matching_proposals mp ON mp.id=pm.proposal_id WHERE pm.application_id=a.id AND mp.status IN ('PENDING','HELD') ${includeReserved?'AND mp.event_id<>$1':''}) ORDER BY a.id`,includeReserved?[eventId]:[])).rows;
 const relationships=(await client.query<any>("SELECT source_user_id,target_user_id FROM match_relationships WHERE active=true AND relationship_type IN ('BLOCK','DISLIKE','REPORT') ORDER BY source_user_id,target_user_id")).rows;
 const history=(await client.query<any>('SELECT user_id,other_user_id FROM match_history ORDER BY user_id,other_user_id')).rows;
 const seated=(await client.query<any>(`SELECT tm.user_id,t.event_id,tm.application_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE tm.status='ACTIVE' ORDER BY tm.user_id,t.event_id`)).rows;
 const reservedSeats=(await client.query<any>("SELECT pm.user_id,pm.application_id,p.event_id FROM matching_proposal_members pm JOIN matching_proposals p ON p.id=pm.proposal_id WHERE p.status IN ('PENDING','HELD')")).rows;
 for(const r of reservedSeats)if(!includeReserved||r.event_id!==eventId)seated.push(r);
 const times=Object.fromEntries(events.map(e=>[e.id,{startsAt:e.starts_at,endsAt:e.ends_at}]));
 const candidates:MatchCandidate[]=rows.filter(r=>(optionMap.get(r.application_id)??[]).some(e=>component.has(e))).map(r=>({applicationId:r.application_id,userId:r.user_id,birthYear:Number(r.birth_year),gender:r.gender,mbti:r.mbti,interests:normalizeInterests(parseJson(r.interests,[])),traits:parseJson(r.traits,[]),desiredTraits:parseJson(r.desired_traits,[]),eventIds:(optionMap.get(r.application_id)??[]).filter(e=>component.has(e)),eventTimes:times,paid:true,valid:true,priorUserIds:history.filter(h=>h.user_id===r.user_id).map(h=>h.other_user_id),blockedUserIds:relationships.filter(h=>h.source_user_id===r.user_id).map(h=>h.target_user_id)}));
 // Exclude only the overlapping options of a user who already has another seat.
 for(const c of candidates)c.eventIds=c.eventIds.filter(e=>!seated.some(s=>s.user_id===c.userId&&times[s.event_id]&&new Date(times[e].startsAt).getTime()<new Date(times[s.event_id].endsAt).getTime()&&new Date(times[s.event_id].startsAt).getTime()<new Date(times[e].endsAt).getTime()));
 const active=candidates.filter(c=>c.eventIds.length);const enriched=await enrichCandidates(client,active,true);
 const scopedEvents=events.filter(e=>component.has(e.id));
 const policies:Record<string,MatchingPolicy>={};for(const e of scopedEvents)policies[e.id]=await effectivePolicy(client,e.id);
 const snapshot={eventId,eventState:scopedEvents,candidates:enriched,occupied:seated.filter(s=>component.has(s.event_id)),policies};
 const hash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
 return {event,events:scopedEvents,candidates:enriched,seated,snapshot,hash,policies};
}
export function matchingPlan(input:Awaited<ReturnType<typeof matchingInput>>,override?:MatchingPolicy){
 const groups:Array<MatchGroup&{policy:MatchingPolicy}>=[],used=new Set<string>();
 const events=input.events.slice().sort((a,b)=>new Date(a.application_deadline).getTime()-new Date(b.application_deadline).getTime()||a.id.localeCompare(b.id));
 for(const event of events){
  const policy=event.id===input.event.id&&override?override:input.policies[event.id];
  const capacity=Number(event.capacity)-input.seated.filter(s=>s.event_id===event.id).length;
  if(capacity<4)continue;
  const candidates=input.candidates.filter(c=>!used.has(c.applicationId)&&c.eventIds.includes(event.id)&&!groups.some(g=>g.members.some(m=>m.userId===c.userId)&&new Date(event.starts_at).getTime()<new Date(input.events.find(e=>e.id===g.eventId)!.ends_at).getTime()&&new Date(input.events.find(e=>e.id===g.eventId)!.starts_at).getTime()<new Date(event.ends_at).getTime()))
   .map(c=>({...c,eventIds:[event.id],...(!policy.learningEnabled?{atmosphere:undefined,preferredInterests:undefined,learnedInterests:undefined,signalConfidence:undefined}:{})}));
  const result=buildDeterministicGroups(candidates,`event:${event.id}`,policy.minScore,policy.weights,capacity);
  for(const group of result.groups){groups.push({...group,policy,explanation:explainGroup(group.members,policy)});for(const m of group.members)used.add(m.applicationId);}
 }
 return {groups,unmatched:input.candidates.filter(c=>!used.has(c.applicationId))};
}
export function evaluatePolicy(input:Awaited<ReturnType<typeof matchingInput>>,policy:MatchingPolicy){
 const result=matchingPlan(input,policy);
 return {policyId:policy.id,policyName:policy.name,matchedCount:result.groups.reduce((n,g)=>n+g.members.length,0),unmatched:result.unmatched.map(c=>c.applicationId),qualityScore:result.groups.reduce((n,g)=>n+g.score,0),groups:result.groups.map(g=>({eventId:g.eventId,policyId:g.policy.id,score:g.score,members:g.members.map(m=>({applicationId:m.applicationId,userId:m.userId})),explanation:g.explanation})),candidateCount:input.candidates.length};
}
export function explainGroup(members:MatchCandidate[],policy:MatchingPolicy){
 const counts=new Map<string,number>();for(const m of members)for(const interest of new Set(m.interests))counts.set(interest,(counts.get(interest)??0)+1);
 const common=[...counts].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,3).map(([name])=>name);
 return `${policy.name}으로 준비한 ${members.length}명의 식탁이에요. ${common.length?`${common.join('·')} 이야기를 함께 나눌 수 있고, `:''}가능한 일정과 연령 폭, 서로의 만남 선호를 확인했어요.${policy.learningEnabled&&members.some(m=>m.signalConfidence)?' 직접 확인한 다음 선호와 누적된 경험도 함께 살폈어요.':''}`;
}
