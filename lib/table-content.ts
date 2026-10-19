import {randomUUID} from 'node:crypto';
import {db,type QueryClient} from './db';
import {parseJson,problem} from './operators';
const decode=(r:any)=>({...r,interest_tags:parseJson<string[]>(r.interest_tags,[]),topics:parseJson<string[]>(r.topics,[]),enabled:Boolean(r.enabled)});
export async function contentTemplates(){return (await db.query<any>('SELECT id,title,atmosphere,interest_tags,topics,game,enabled,priority,version,updated_at FROM table_content_templates ORDER BY priority DESC,created_at DESC')).rows.map(decode);}
export async function saveContentTemplate(actor:string,b:any){
 if(typeof b.title!=='string'||!b.title.trim()||b.title.length>100||!['ANY','BALANCED','LIVELY','CALM'].includes(b.atmosphere)||!Array.isArray(b.topics)||b.topics.length<3||b.topics.length>8||b.topics.some((t:any)=>typeof t!=='string'||t.trim().length<5||t.length>300)||typeof b.game!=='string'||b.game.trim().length<10||b.game.length>1000||!Array.isArray(b.interestTags)||b.interestTags.length>10||b.interestTags.some((t:any)=>typeof t!=='string'||t.length>60)||!Number.isInteger(b.priority)||Math.abs(b.priority)>100||typeof b.enabled!=='boolean')problem('제목, 대화 주제 3~8개, 게임 안내와 노출 조건을 확인해 주세요.');
 const c=await db.connect();try{await c.query('BEGIN');if(!(await c.query('SELECT 1 FROM operator_profiles WHERE user_id=$1 AND active=true',[actor])).rowCount)problem('활성 운영자 권한이 필요합니다.',403);
 const values=[b.title.trim(),b.atmosphere,JSON.stringify([...new Set(b.interestTags)]),JSON.stringify(b.topics.map((t:string)=>t.trim())),b.game.trim(),b.enabled,b.priority,actor],id=b.id||randomUUID();
 if(b.id){if(!Number.isInteger(b.version))problem('최신 콘텐츠를 다시 불러와 주세요.',409);const updated=await c.query('UPDATE table_content_templates SET title=$2,atmosphere=$3,interest_tags=$4,topics=$5,game=$6,enabled=$7,priority=$8,updated_by=$9,version=version+1,updated_at=now() WHERE id=$1 AND version=$10',[id,...values,b.version]);if(!updated.rowCount)problem('다른 운영자가 콘텐츠를 수정했습니다. 새로고침해 주세요.',409);}
 else await c.query('INSERT INTO table_content_templates(id,title,atmosphere,interest_tags,topics,game,enabled,priority,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)',[id,...values]);
 await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'TABLE_CONTENT_SAVED','table_content_template',$2,$3)",[actor,id,JSON.stringify({title:b.title,atmosphere:b.atmosphere,enabled:b.enabled,priority:b.priority})]);await c.query('COMMIT');return {ok:true,id,version:b.id?b.version+1:0};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function selectTableContent(c:Pick<QueryClient,'query'>,tableId:string,fallbackTopics:string[]){
 const people=(await c.query<any>(`SELECT pr.interests,pr.traits,pp.atmosphere FROM table_members tm JOIN profiles pr ON pr.user_id=tm.user_id LEFT JOIN participant_preferences pp ON pp.user_id=tm.user_id AND pp.confirmed=true WHERE tm.table_id=$1 AND tm.status='ACTIVE'`,[tableId])).rows;
 const interests=new Set(people.flatMap(p=>parseJson<string[]>(p.interests,[]))),v=(a:string)=>people.filter(p=>p.atmosphere===a).length;
 const atmosphere=v('CALM')>people.length/2?'CALM':v('LIVELY')>people.length/2?'LIVELY':'BALANCED';
 const templates=(await c.query<any>('SELECT * FROM table_content_templates WHERE enabled=true ORDER BY priority DESC,created_at DESC')).rows.map(decode);
 const selected=templates.find(t=>(t.atmosphere==='ANY'||t.atmosphere===atmosphere)&&(!t.interest_tags.length||t.interest_tags.some((i:string)=>interests.has(i))));
 return selected?{topics:selected.topics,game:selected.game,templateId:selected.id,atmosphere}:{topics:fallbackTopics,game:'취향 한 바퀴: 각자 이름과 요즘 빠진 것 하나를 소개하고, 오른쪽 사람에게 가벼운 질문 하나를 건네세요. 답하기 어려운 질문은 편하게 넘겨도 괜찮아요.',templateId:null,atmosphere};
}
