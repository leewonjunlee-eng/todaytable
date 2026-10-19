import {pairFeatures,type MatchCandidate} from './matching';
import type {QueryClient} from './db';
import type {MatchWeights} from './matching';
import {parseJson} from './operators';

type Feature=keyof MatchWeights;
const keys:Feature[]=['gender','mbti','interests','traits','novelty'];
type Sample={features:MatchWeights;outcome:number};
const overlap=(a:string[],b:string[])=>a.filter(value=>b.includes(value)).length/Math.max(1,a.length,b.length);
const bounded=(value:number)=>Math.min(1,Math.max(0,value));

/** A conservative, bounded correlation update. Sparse or flat evidence preserves the operator's settings. */
export function learnOutcomeWeights(base:MatchWeights,samples:Sample[]){
 if(samples.length<20)return base;
 const meanOutcome=samples.reduce((n,s)=>n+s.outcome,0)/samples.length;
 const reliability=Math.min(1,(samples.length-19)/31);
 const adjusted={} as MatchWeights;
 for(const key of keys){
  const mean=samples.reduce((n,s)=>n+s.features[key],0)/samples.length;
  const covariance=samples.reduce((n,s)=>n+(s.features[key]-mean)*(s.outcome-meanOutcome),0);
  const variance=samples.reduce((n,s)=>n+(s.features[key]-mean)**2,0);
  const shift=variance>0?Math.max(-.04,Math.min(.04,covariance/variance*.04))*reliability:0;
  adjusted[key]=Math.max(.01,base[key]+shift);
 }
 const baseTotal=keys.reduce((n,key)=>n+base[key],0),total=keys.reduce((n,key)=>n+adjusted[key],0);
 const result=Object.fromEntries(keys.map(key=>[key,Math.min(base[key]+.04,Math.max(Math.max(.01,base[key]-.04),adjusted[key]*baseTotal/total))])) as MatchWeights;
 for(let iteration=0;iteration<20;iteration++){
  const delta=baseTotal-keys.reduce((n,key)=>n+result[key],0);if(Math.abs(delta)<1e-10)break;
  const free=keys.filter(key=>delta>0?result[key]<base[key]+.04-1e-10:result[key]>Math.max(.01,base[key]-.04)+1e-10);if(!free.length)break;
  for(const key of free)result[key]=Math.min(base[key]+.04,Math.max(Math.max(.01,base[key]-.04),result[key]+delta/free.length));
 }
 return Object.fromEntries(keys.map(key=>[key,Number(result[key].toFixed(6))])) as MatchWeights;
}

export async function outcomeWeightEvidence(client:Pick<QueryClient,'query'>,base:MatchWeights){
 const rows=(await client.query<any>(`SELECT t.id table_id,t.created_at table_created_at,e.ends_at,mr.input_snapshot,tm.user_id,p.gender,p.mbti,p.interests,p.traits,p.desired_traits,ar.status attendance_status,f.conversation_score,f.return_intent
 FROM dining_tables t JOIN events e ON e.id=t.event_id JOIN table_members tm ON tm.table_id=t.id AND tm.status='ACTIVE'
 JOIN applications a ON a.id=tm.application_id JOIN users u ON u.id=tm.user_id JOIN match_runs mr ON mr.id=t.match_run_id LEFT JOIN profiles p ON p.user_id=tm.user_id
 LEFT JOIN attendance_records ar ON ar.application_id=a.id AND ar.event_id=e.id
 LEFT JOIN journey_feedback f ON f.table_id=t.id AND f.author_user_id=tm.user_id AND f.is_demo=false
 WHERE t.id IN (SELECT dt.id FROM dining_tables dt JOIN events ev ON ev.id=dt.event_id WHERE dt.status='CONFIRMED' AND ev.is_demo=false AND ev.ends_at<CURRENT_TIMESTAMP ORDER BY ev.ends_at DESC LIMIT 200)
 AND a.is_demo=false AND u.is_demo=false AND u.restricted_status='ACTIVE' ORDER BY t.id,tm.user_id`)).rows;
 const byTable=new Map<string,any[]>();for(const row of rows)byTable.set(row.table_id,[...(byTable.get(row.table_id)??[]),row]);
 const history=(await client.query<any>("SELECT h.user_id,h.other_user_id,t.created_at FROM match_history h JOIN dining_tables t ON t.id=h.table_id WHERE t.status='CONFIRMED'")).rows;
 const firstPair=new Map<string,number>();for(const h of history){const key=[h.user_id,h.other_user_id].sort().join(':');const when=+new Date(h.created_at),old=firstPair.get(key);if(old===undefined||when<old)firstPair.set(key,when);}
 const returns=(await client.query<any>("SELECT a.user_id,a.created_at FROM applications a JOIN payments p ON p.application_id=a.id WHERE a.status='SUBMITTED' AND a.is_demo=false AND p.status IN ('PAID','REFUND_AVAILABLE','REFUNDED')")).rows;
 const returnByUser=new Map<string,number[]>();for(const row of returns)returnByUser.set(row.user_id,[...(returnByUser.get(row.user_id)??[]),+new Date(row.created_at)]);
 const samples:Sample[]=[];
 for(const currentMembers of [...byTable.values()].sort((a,b)=>+new Date(a[0].ends_at)-+new Date(b[0].ends_at))){
  const frozen=parseJson<any>(currentMembers[0]?.input_snapshot,{}).candidates as MatchCandidate[]|undefined;
  if(!frozen||currentMembers.some(m=>!frozen.some(f=>f.userId===m.user_id)))continue;
  const members=currentMembers.map(m=>({...m,frozen:frozen.find(f=>f.userId===m.user_id)!}));
  if(+new Date(members[0].ends_at)+30*86400000>Date.now())continue;
  const feedback=members.filter(m=>m.conversation_score!=null);if(members.length<4||feedback.length<3)continue;
  let pairs=0;const totals:MatchWeights={gender:0,mbti:0,interests:0,traits:0,novelty:0};
  for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++){
   const a=members[i].frozen,b=members[j].frozen,features=pairFeatures(a,b);
   for(const key of keys)totals[key]+=features[key];
   pairs++;
  }
  if(!pairs)continue;
  const features=Object.fromEntries(keys.map(key=>[key,bounded(totals[key]/pairs)])) as MatchWeights;
  const conversation=feedback.reduce((n,m)=>n+(Number(m.conversation_score)-1)/4,0)/feedback.length;
  const attendance=members.filter(m=>m.attendance_status==='ATTENDED').length/members.length;
  const revisit=members.filter(m=>(returnByUser.get(m.user_id)??[]).some(when=>when>+new Date(m.ends_at)&&when<=+new Date(m.ends_at)+30*86400000)).length/members.length;
  samples.push({features,outcome:bounded(.6*conversation+.2*attendance+.2*revisit)});
 }
 const split=Math.floor(samples.length*.8),training=samples.slice(0,split),holdout=samples.slice(split);
 const weights=learnOutcomeWeights(base,samples);
 const error=(w:MatchWeights)=>holdout.length?holdout.reduce((n,s)=>n+(keys.reduce((v,k)=>v+w[k]*s.features[k],0)-s.outcome)**2,0)/holdout.length:null;
 return {weights,sampleCount:samples.length,validation:{trainingCount:training.length,holdoutCount:holdout.length,baseError:error(base),learnedError:error(learnOutcomeWeights(base,training))}};
}
