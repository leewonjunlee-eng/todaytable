import {createHash} from 'node:crypto';
import {groupScore,isAllowedGenderComposition} from './matching';
import {REGIONS} from './domain';
import {normalizeInterests} from './feedback-domain';
export type SourceRow={sheet_row:number;sheet_name?:string;fields:Record<string,string>;issues?:string[]};
export type ShowcasePerson={row:SourceRow;name:string;age:number;gender:string;mbti:string;areas:string[];area:string;interests:string[];traits:string[];desiredTraits:string[];budgets:string[];uses:number;amount:number;assumptions:Record<string,unknown>};
export type Cohort='PAST'|'UPCOMING'|'RECRUITING';
export const showcaseId=(key:string)=>{const h=createHash('sha256').update('showcase-lifecycle-v1:'+key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export function normalizeSource(row:SourceRow):ShowcasePerson{
 const f=row.fields,list=(v='')=>v.split(/,\s*(?![^()]*\))/).map(v=>v.trim()).filter(Boolean);
 const rawAge=Number(f.age?.match(/\d+/)?.[0]),age=rawAge>=18&&rawAge<=100?rawAge:30;
 const rawArea=f.areas??'',areas=REGIONS.filter((area,i)=>i===0?/홍대|합정|부평/.test(rawArea):i===1?/잠실/.test(rawArea):i===2?/강남|신논현|분당|판교|광교|수지/.test(rawArea):/을지로|종로|동대문/.test(rawArea));
 if(!areas.length)areas.push(...(/모두|무방|상관없/.test(rawArea)?REGIONS:[REGIONS[0]]));
 const rawMbti=(f.mbti??'').trim().toUpperCase(),match=rawMbti.match(/\b[IE][NS][FT][JP]\b/),mbti=match?.[0]??'INFP';
 const budgets=list(f.food_budgets).map(s=>/상관|무관|모두/.test(s)?'ANY':/이하|미만|1만원|1만|2만원 미만/.test(s)?'UNDER_20000':/이상|3만원 초과|3만 초과/.test(s)?'OVER_30000':'20000_30000');
 const uses=/[34]\s*회/.test(f.pass_choice??'')?3:1;
 return {row,name:(f.name??'').trim()||`참가자 ${row.sheet_row}`,age,gender:/^여/.test(f.gender??'')?'WOMAN':/^남/.test(f.gender??'')?'MAN':'PREFER_NOT_TO_SAY',mbti,areas:[...areas],area:areas[0],interests:normalizeInterests(list(f.interests)),traits:list(f.traits),desiredTraits:list(f.desired_traits),budgets:budgets.length?[...new Set(budgets)]:['ANY'],uses,amount:uses===3?15000:8000,assumptions:{sourceRow:row.sheet_row,sourceIssues:row.issues??[],birthYear:`2026 minus supplied age ${age}`,originalDates:f.dates??'',dateMapping:'Supplied yearless choices are represented by relative Thursday cohorts for this fictional operating timeline.',originalAreas:rawArea,areaMapping:areas,mbtiReview:!match||match[0]!==rawMbti,originalMbti:f.mbti??'',contact:'No source phone or Instagram is copied; accounts are synthetic and cannot receive external delivery.',payment:'MOCK approval; no charge or external booking',consent:'Synthetic review identities only; original consent is preserved in source, not inferred.'}};
}
/** Preserve every supplied row; only complete, valid compositions are confirmed. */
export function planShowcase(rows:SourceRow[]){
 const people=rows.map(normalizeSource),groups:{people:ShowcasePerson[];cohort:Cohort;area:string}[]=[];
 const pairs=[[4,2],[5,2],[5,3],[6,2],[6,3],[6,4]];
 const score=(members:ShowcasePerson[])=>groupScore(members.map(p=>({applicationId:String(p.row.sheet_row),userId:String(p.row.sheet_row),birthYear:2026-p.age,gender:p.gender,mbti:p.mbti,interests:p.interests,traits:p.traits,desiredTraits:p.desiredTraits,eventIds:['showcase'],paid:true,valid:true})));
 for(const area of REGIONS){let pool=people.filter(p=>p.area===area).sort((a,b)=>a.age-b.age||a.row.sheet_row-b.row.sheet_row),turn=0;
  const consume=(members:ShowcasePerson[],cohort:Cohort)=>{groups.push({people:members,cohort,area});const used=new Set(members);pool=pool.filter(p=>!used.has(p));};
  // Reserve compatible peers for the existing review account's past and future dinners.
  if(area===REGIONS[0]){const peers=pool.filter(p=>p.age>=27&&p.age<=33),men=peers.filter(p=>p.gender==='MAN').slice(0,2),women=peers.filter(p=>p.gender==='WOMAN').slice(0,4);if(men.length===2&&women.length===4)consume([...men,...women],'RECRUITING');}
  while(pool.length>=4){
   let selected:ShowcasePerson[]|undefined;
   for(const [size,men] of [...pairs.slice(turn%pairs.length),...pairs.slice(0,turn%pairs.length)]){
    let best=-1;
    for(const age of [...new Set(pool.map(p=>p.age))]){
     const window=pool.filter(p=>p.age>=age&&p.age<=age+8);
     for(const anchor of window.slice(0,12)){
      const affinity=(p:ShowcasePerson)=>p.interests.filter(x=>anchor.interests.includes(x)).length*3+Number(p.mbti===anchor.mbti)*2-Math.abs(p.age-anchor.age)*.1;
      const rank=(a:ShowcasePerson,b:ShowcasePerson)=>affinity(b)-affinity(a)||a.row.sheet_row-b.row.sheet_row;
      const m=window.filter(p=>p.gender==='MAN').sort(rank).slice(0,men),f=window.filter(p=>p.gender==='WOMAN').sort(rank).slice(0,size-men);
      if(m.length!==men||f.length!==size-men)continue;const candidate=[...m,...f],quality=score(candidate);
      if(quality>best){best=quality;selected=candidate;}
     }
    }
    if(selected)break;
   }
   if(!selected)break;
   consume(selected,(['PAST','UPCOMING','RECRUITING','UPCOMING','PAST'] as const)[turn%5]);turn++;
  }
  while(pool.length)consume(pool.slice(0,6),'RECRUITING');
 }
 for(const g of groups)if(g.cohort!=='RECRUITING'&&!isAllowedGenderComposition(g.people))throw Error('Invalid showcase gender composition.');
 return {people,groups};
}
export function showcaseThursday(now=new Date()){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),midnight=new Date(`${day}T00:00:00+09:00`),weekday=new Date(+midnight+9*3600000).getUTCDay();
 return new Date(+midnight+(((4-weekday+7)%7)||7)*86400000+19.5*3600000);
}
