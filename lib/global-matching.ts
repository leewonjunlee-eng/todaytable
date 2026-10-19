import {isAllowedGenderComposition,groupScore,isHardCompatible,preferredSize,type MatchCandidate,type MatchGroup} from './matching';
import type {MatchingPolicy,matchingInput} from './matching-policy';

type Input=Awaited<ReturnType<typeof matchingInput>>;
type Group=MatchGroup&{policy:MatchingPolicy};
/** A bounded beam search over a connected set of events. Existing seats remain fixed. */
export function globalMatching(input:Input,override?:MatchingPolicy){
 const events=input.events.slice().sort((a,b)=>+new Date(a.starts_at)-+new Date(b.starts_at)||a.area.localeCompare(b.area)||a.id.localeCompare(b.id));
 const candidates=input.candidates.filter(c=>c.paid&&c.valid).slice().sort((a,b)=>a.eventIds.length-b.eventIds.length||a.applicationId.localeCompare(b.applicationId));
 const capacity=new Map(events.map(e=>[e.id,Math.max(0,Number(e.capacity)-input.seated.filter(s=>s.event_id===e.id).length)]));
 const byEvent=new Map(events.map(e=>[e.id,e]));
 const overlap=(a:string,b:string)=>{const x=byEvent.get(a),y=byEvent.get(b);return x&&y&&+new Date(x.starts_at)<+new Date(y.ends_at)&&+new Date(y.starts_at)<+new Date(x.ends_at);};
 const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
 const days=new Map(events.map(e=>[e.id,dayFormat.format(new Date(e.starts_at))]));
 const origins=new Map(candidates.map(c=>[c.applicationId,events.find(e=>c.eventIds.includes(e.id))]));
 const rank=(member:MatchCandidate,eventId:string)=>{
  const origin=origins.get(member.applicationId),target=byEvent.get(eventId);
  if(!origin||!target)return 0;
  return Number(days.get(origin.id)!==days.get(target.id))*2+Number(origin.area!==target.area);
 };
 type State={groups:Group[];used:Set<string>;skipped:Set<string>;seats:Map<string,number>;count:number;cost:number;quality:number;key:string};
 const empty:State={groups:[],used:new Set(),skipped:new Set(),seats:new Map(),count:0,cost:0,quality:0,key:''};
 let beam=[empty],best=empty,exploredNodes=0,limited=false;
 const budget=12000,width=24;
 const compare=(a:State,b:State)=>b.count-a.count||a.cost-b.cost||b.quality-a.quality||a.key.localeCompare(b.key);
 // Establish a complete feasible incumbent before spending the improvement budget.
 // Scarce applicants lead each group; table sizes leave enough people for later tables.
 for(const order of [events,events.slice().reverse()]){
  const state:State={...empty,groups:[],used:new Set(),seats:new Map()};
  for(const event of order){
   const policy=event.id===input.event.id&&override?override:input.policies[event.id];
   let room=capacity.get(event.id)??0;
   while(room>=4){
    const pool=candidates.filter(c=>!state.used.has(c.applicationId)&&c.eventIds.includes(event.id)&&!state.groups.some(g=>g.members.some(m=>m.userId===c.userId)&&overlap(g.eventId!,event.id))).map(c=>({...c,eventIds:[event.id],...(!policy.learningEnabled?{atmosphere:undefined,preferredInterests:undefined,learnedInterests:undefined,signalConfidence:undefined}:{})}));
    if(pool.length<4)break;
    const preferred=preferredSize(Math.min(room,pool.length));
    let chosen:MatchCandidate[]|undefined;
    for(const size of [...new Set([preferred,4,5,6])].filter(n=>n>=4&&n<=room&&n<=pool.length)){
     let nodes=0;
     const find=(start:number,members:MatchCandidate[]):boolean=>{
      if(++nodes>2000)return false;
      if(members.length===size){if(!isAllowedGenderComposition(members)||groupScore(members,policy.weights)<policy.minScore)return false;chosen=members;return true;}
      for(let i=start;i<=pool.length-(size-members.length);i++)if(isHardCompatible(members,pool[i],0,policy.weights)&&find(i+1,[...members,pool[i]]))return true;
      return false;
     };
     if(find(0,[]))break;
    }
    if(!chosen)break;
    const score=groupScore(chosen,policy.weights);
    state.groups.push({members:chosen,eventId:event.id,policy,score,explanation:''});
    for(const m of chosen){state.used.add(m.applicationId);state.cost+=rank(m,event.id);}
    state.count+=chosen.length;state.quality+=score*chosen.length;room-=chosen.length;
    state.seats.set(event.id,(capacity.get(event.id)??0)-room);
   }
  }
  state.key=state.groups.map(g=>`${g.eventId}:${g.members.map(m=>m.applicationId).sort().join(',')}`).sort().join('|');
  if(compare(state,best)<0)best=state;
 }
 for(let iteration=0;iteration<candidates.length&&beam.length;iteration++){
  const next:State[]=[];
  for(const state of beam){
   const anchor=candidates.find(c=>!state.used.has(c.applicationId)&&!state.skipped.has(c.applicationId));if(!anchor)continue;
   next.push({...state,skipped:new Set([...state.skipped,anchor.applicationId])});
   for(const event of events){
    if(!anchor.eventIds.includes(event.id))continue;
    const remaining=(capacity.get(event.id)??0)-(state.seats.get(event.id)??0);if(remaining<4)continue;
    const policy=event.id===input.event.id&&override?override:input.policies[event.id];
    const pool=candidates.filter(c=>c.eventIds.includes(event.id)&&!state.used.has(c.applicationId)&&!state.skipped.has(c.applicationId)&&!state.groups.some(g=>g.members.some(m=>m.userId===c.userId)&&overlap(g.eventId!,event.id)))
     .map(c=>({...c,eventIds:[event.id],...(!policy.learningEnabled?{atmosphere:undefined,preferredInterests:undefined,learnedInterests:undefined,signalConfidence:undefined}:{})}));
    const first=pool.find(c=>c.applicationId===anchor.applicationId);if(!first)continue;
    const extras=pool.filter(c=>c.applicationId!==anchor.applicationId);
    // Large cohorts rotate windows so every applicant has a chance within the fixed budget.
    const localBudget=candidates.length>25?120:500;
    let local=0;
    const visit=(start:number,members:MatchCandidate[])=>{
     if(++exploredNodes>budget||++local>localBudget){limited=true;return;}
     if(isAllowedGenderComposition(members)&&groupScore(members,policy.weights)>=policy.minScore){
      const score=groupScore(members,policy.weights),group:Group={members,eventId:event.id,policy,score,explanation:''};
      const key=[...state.groups,group].map(g=>`${g.eventId}:${g.members.map(m=>m.applicationId).sort().join(',')}`).sort().join('|');
      const result:State={groups:[...state.groups,group],used:new Set([...state.used,...members.map(m=>m.applicationId)]),skipped:state.skipped,seats:new Map(state.seats).set(event.id,(state.seats.get(event.id)??0)+members.length),count:state.count+members.length,cost:state.cost+members.reduce((n,m)=>n+rank(m,event.id),0),quality:state.quality+score*members.length,key};
      next.push(result);if(compare(result,best)<0)best=result;
      if(next.length>4000){next.sort(compare);next.length=800;}
     }
     if(members.length>=Math.min(6,remaining))return;
     for(let j=start;j<extras.length;j++){
      if(local>=localBudget||exploredNodes>=budget)break;
      if(isHardCompatible(members,extras[j],0,policy.weights))visit(j+1,[...members,extras[j]]);
     }
    };
    visit(0,[first]);
   }
  }
  // Retain distinct decisions; the optimistic bound protects states that defer flexible users.
  const unique=new Map<string,State>();
  for(const s of next){const key=[...s.used].sort().join(',')+'|'+[...s.skipped].sort().join(',')+'|'+[...s.seats].sort().join(';');const prior=unique.get(key);if(!prior||compare(s,prior)<0)unique.set(key,s);}
  beam=[...unique.values()].sort((a,b)=>{
   const bound=(s:State)=>{
    const remaining=candidates.filter(c=>!s.used.has(c.applicationId)&&!s.skipped.has(c.applicationId));
    const feasible=new Set(events.filter(e=>(capacity.get(e.id)??0)-(s.seats.get(e.id)??0)>=4&&remaining.filter(c=>c.eventIds.includes(e.id)).length>=4).map(e=>e.id));
    return s.count+remaining.filter(c=>c.eventIds.some(e=>feasible.has(e))).length;
   };
   return bound(b)-bound(a)||compare(a,b);
  }).slice(0,width);
  if(exploredNodes>=budget){limited=true;break;}
 }
 return {groups:best.groups,unmatched:input.candidates.filter(c=>!best.used.has(c.applicationId)),search:{exploredNodes,budget,limited,stopReason:limited?'BUDGET':'EXHAUSTED',matchedCount:best.count,reallocationCost:best.cost}};
}
