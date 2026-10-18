import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';
import {submitApplication} from '../lib/application-service';
import {tick} from '../worker/index';
if(process.env.DATABASE_PROVIDER!=='sqlite'||!process.env.SQLITE_PATH?.endsWith('goal-browser.sqlite'))throw new Error('Browser fixture requires the isolated goal-browser.sqlite database.');
const statePath='.data/goal-browser-state.json';
async function main(){try{
 const phase=process.argv[2];
 if(phase==='setup'){
  await db.query("UPDATE table_members SET status='REMOVED' WHERE table_id IN (SELECT t.id FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE e.title='[모의] 통합 검증 식탁')");
  await db.query("UPDATE dining_tables SET status='CANCELLED' WHERE event_id IN (SELECT id FROM events WHERE title='[모의] 통합 검증 식탁')");
  await db.query("UPDATE events SET status='CANCELLED' WHERE title='[모의] 통합 검증 식탁'");
  await db.query("INSERT INTO venues(name,area,address,capacity) VALUES('[모의] 통합 검증 식당','강남','모의 장소 · 방문 불가',100)");
  const owner=(await db.query<any>("SELECT id FROM users WHERE email='admin@todaytable.local'")).rows[0].id;
  const event=randomUUID(),start=new Date(Date.now()+37*86400000);
  await db.query("INSERT INTO events(id,title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by,is_demo) VALUES($1,'[모의] 통합 검증 식탁',$2,$3,$4,'강남',6,8000,$5,true)",[event,start,new Date(start.getTime()+7200000),new Date(Date.now()+86400000),owner]);
  for(let n=0;n<3;n++){
   const id=randomUUID();await db.query("INSERT INTO users(id,email,password_hash,is_demo) VALUES($1,$2,'browser-fixture-no-login',true)",[id,`fixture-${id}@demo.todaytable.invalid`]);
   await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,traits,desired_traits,consent_privacy,consent_operations) VALUES($1,$2,'',1995,'PREFER_NOT_TO_SAY','INTJ','["독서","여행"]','[]','[]',true,true)`,[id,`시연 참가자 ${n+1}`]);
   await submitApplication(id,{eventIds:[event],pass:'SINGLE',requestKey:randomUUID()});
  }
  await writeFile(statePath,JSON.stringify({event}),{mode:0o600});console.log(JSON.stringify({event}));
 }else{
  const state=JSON.parse(await readFile(statePath,'utf8'));
  if(phase==='match'){
   await db.query('UPDATE events SET application_deadline=$2 WHERE id=$1',[state.event,new Date(Date.now()-60000)]);
   for(let n=0;n<120;n++){
    await tick('product-browser-fixture');
    const table=(await db.query<any>("SELECT id FROM dining_tables WHERE event_id=$1 AND provision_status='PROVISIONED'",[state.event])).rows[0];
    if(table){state.table=table.id;break;}
   }
   if(!state.table)throw new Error('The fixture worker did not provision the table.');
   await writeFile(statePath,JSON.stringify(state),{mode:0o600});
  }else if(phase==='checkin')await db.query('UPDATE events SET starts_at=$2,ends_at=$3 WHERE id=$1',[state.event,new Date(Date.now()-60000),new Date(Date.now()+3600000)]);
  else if(phase==='finish')await db.query('UPDATE events SET starts_at=$2,ends_at=$3 WHERE id=$1',[state.event,new Date(Date.now()-10800000),new Date(Date.now()-60000)]);
  else throw new Error('Unknown fixture phase.');
  console.log(JSON.stringify(state));
 }
}finally{await db.end();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
