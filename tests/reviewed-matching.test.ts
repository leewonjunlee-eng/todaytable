import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

test('availability jobs produce private proposals; hold/reject do not notify, approval alone creates member chat and notification',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'todaytable-reviewed-'));
 process.env.DATABASE_PROVIDER=process.env.REVIEW_TEST_POSTGRES?'postgres':'sqlite';process.env.SQLITE_PATH=join(dir,'review.sqlite');process.env.SESSION_SECRET='review-'+randomUUID();process.env.APP_URL='http://localhost';
 const {db}=await import('../lib/db'),{tokenHash}=await import('../lib/security');
 try{
  for(const file of(await readdir(process.env.REVIEW_TEST_POSTGRES?'db/migrations':'db/sqlite')).filter(n=>n.endsWith('.sql')).sort())await db.execScript(await readFile(join(process.env.REVIEW_TEST_POSTGRES?'db/migrations':'db/sqlite',file),'utf8'));
  const admin=(await db.query<any>("INSERT INTO users(email,password_hash,role) VALUES('ceo@todaytable','x','ADMIN') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO operator_profiles(user_id,display_name,team_role) VALUES($1,'대표','OWNER')",[admin]);
  const venue=(await db.query<any>("INSERT INTO venues(name,area,address,capacity) VALUES('조용한 식당','홍대/합정','서울 마포구',40) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO venue_profiles(venue_id,interest_tags) VALUES($1,'[\"음악\"]')",[venue]);
  const users:string[]=[],tokens:string[]=[];
  for(let i=0;i<9;i++){
   const id=(await db.query<any>("INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id",[`member${i}@todaytable`])).rows[0].id;users.push(id);
   await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,food_budgets,consent_privacy,consent_operations) VALUES($1,$2,'01012345678',1995,'PREFER_NOT_TO_SAY','ENFP',$3,$4,true,true)`,[id,`멤버${i}`,['음악','영화·드라마'],['ANY']]);
  }
  for(const id of [admin,...users]){const token=randomUUID();tokens.push(token);await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[id,tokenHash(token),new Date(Date.now()+3600000)]);}
  const request=(path:string,index:number,body?:any)=>new Request('http://localhost'+path,{headers:{origin:'http://localhost','content-type':'application/json',cookie:`todaytable_session=${tokens[index]}`},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const availability=await import('../app/api/availability/route'),review=await import('../app/api/admin/matching-review/route');
  const choices=await(await availability.GET(request('/api/availability',1))).json(),dates=[choices.days[7]],areas=['홍대/합정'];
  let firstKey='',firstId='';
  for(let i=0;i<4;i++){
   const key=randomUUID();const r=await availability.POST(request('/api/availability',i+1,{dates,areas,pass:'SINGLE',requestKey:key}));assert.equal(r.status,201,JSON.stringify(await r.clone().json()));if(i===0){firstKey=key;firstId=(await r.json()).id;}
  }
  const replay=await availability.POST(request('/api/availability',1,{dates,areas,pass:'SINGLE',requestKey:firstKey}));assert.equal(replay.status,200);assert.equal((await replay.json()).id,firstId);
  assert.equal((await availability.POST(request('/api/availability',1,{dates,areas:['잠실'],pass:'SINGLE',requestKey:firstKey}))).status,409);
  assert.equal((await db.query('SELECT * FROM applications')).rowCount,4);
  assert.equal((await db.query('SELECT * FROM availability_slots')).rowCount,1);
  const {claimJob,processJob}=await import('../worker/index');
  for(let i=0;i<16;i++){const job=await claimJob('review-test');if(!job)break;await processJob(job,'review-test');}
  const p=(await db.query<any>('SELECT * FROM matching_proposals')).rows[0];assert.ok(p);assert.equal(p.status,'PENDING');
  for(const table of ['dining_tables','table_members','journey_rooms','notifications'])assert.equal((await db.query(`SELECT * FROM ${table}`)).rowCount,0,table);
  assert.equal((await review.GET(request('/api/admin/matching-review',1))).status,403);
  const queue=await(await review.GET(request('/api/admin/matching-review',0))).json();
  assert.ok(Array.isArray(queue.upcoming));
  assert.ok(Array.isArray(queue.past));
  // Note: review proposals are no longer returned by GET; POST endpoints still work for matching operations
  const {recommendVenues}=await import('../lib/venues');
  const eventRow=(await db.query<any>('SELECT * FROM events WHERE id=$1',[p.event_id])).rows[0];
  const members=JSON.parse(p.candidates);
  await db.query('UPDATE venues SET capacity=4 WHERE id=$1',[venue]);
  const recommendations=await recommendVenues(db,eventRow,members,{sourceTableId:null as any});assert.equal(recommendations[0].eligible,false);assert.equal(recommendations[0].availableSeats,0);
  const ownVenue=await recommendVenues(db,eventRow,members,{proposalId:p.id});assert.equal(ownVenue[0].eligible,true);assert.equal(ownVenue[0].availableSeats,4);
  await db.query('UPDATE venues SET capacity=40 WHERE id=$1',[venue]);
  const decision=(body:any)=>review.POST(request('/api/admin/matching-review',0,{id:p.id,...body}));
  assert.equal((await decision({action:'HOLD',version:0,note:'식당 확인 중'})).status,200);
  assert.equal((await db.query('SELECT * FROM notifications')).rowCount,0);
  assert.equal((await decision({action:'APPROVE',version:0,venueId:venue})).status,409);
  // Revalidation must reject changed consent and leave every side effect rolled back.
  await db.query('UPDATE profiles SET consent_privacy=false WHERE user_id=$1',[users[0]]);
  assert.equal((await decision({action:'APPROVE',version:1,venueId:venue})).status,409);
  assert.equal((await db.query('SELECT * FROM dining_tables')).rowCount,0);
  await db.query('UPDATE profiles SET consent_privacy=true WHERE user_id=$1',[users[0]]);
  const approved=await decision({action:'APPROVE',version:1,venueId:venue});assert.equal(approved.status,200,JSON.stringify(await approved.clone().json()));const tableId=(await approved.json()).tableId;
  assert.equal((await decision({action:'APPROVE',version:1,venueId:venue})).status,200);
  assert.equal((await db.query('SELECT * FROM dining_tables')).rowCount,1);assert.equal((await db.query('SELECT * FROM journey_rooms')).rowCount,1);assert.equal((await db.query('SELECT * FROM notifications')).rowCount,4);assert.equal((await db.query('SELECT * FROM table_members')).rowCount,4);
  assert.ok((await db.query<any>('SELECT action_url FROM notifications')).rows.every(n=>n.action_url===`/tables/${tableId}`));
  const chat=await import('../app/api/tables/[id]/messages/route');
  for(let i=1;i<=4;i++)assert.equal((await chat.GET(request(`/api/tables/${tableId}/messages`,i),{params:Promise.resolve({id:tableId})})).status,200);
  assert.equal((await chat.GET(request(`/api/tables/${tableId}/messages`,5),{params:Promise.resolve({id:tableId})})).status,404);
  const after=await(await review.GET(request('/api/admin/matching-review',0))).json();
  assert.ok(after.upcoming.length>=1);
  assert.equal(after.past.length,0);
  for(let i=4;i<8;i++)assert.equal((await availability.POST(request('/api/availability',i+1,{dates:[choices.days[9]],areas,pass:'SINGLE',requestKey:randomUUID()}))).status,201);
  const event=(await db.query<any>('SELECT event_id FROM availability_slots WHERE day=$1',[choices.days[9]])).rows[0].event_id;
  const {runMatching}=await import('../lib/lifecycle-service');await runMatching(event);
  const second=(await db.query<any>("SELECT * FROM matching_proposals WHERE status='PENDING'")).rows[0];
  assert.equal((await review.POST(request('/api/admin/matching-review',0,{id:second.id,action:'REJECT',version:0,note:'다른 구성으로 검토'}))).status,200);
  assert.equal((await db.query('SELECT * FROM notifications')).rowCount,4);assert.equal((await db.query('SELECT * FROM journey_rooms')).rowCount,1);
  assert.equal((await db.query("SELECT * FROM applications WHERE matching_status='WAITING'")).rowCount,4);
  // Registration is atomic even when the wallet cannot fund it: no orphan slot or job.
  const oldSlots=(await db.query('SELECT * FROM availability_slots')).rowCount;
  assert.equal((await availability.POST(request('/api/availability',9,{dates:[choices.days[10]],areas:['잠실'],pass:'EXISTING_PASS',requestKey:randomUUID()}))).status,400);
  assert.equal((await db.query('SELECT * FROM availability_slots')).rowCount,oldSlots);
  // Cancellation repair must pass the same approval gate, even before the date's cutoff.
  assert.equal((await availability.POST(request('/api/availability',9,{dates,areas,pass:'SINGLE',requestKey:randomUUID()}))).status,201);
  const removedApp=(await db.query<any>('SELECT application_id FROM table_members WHERE table_id=$1 AND user_id=$2',[tableId,users[0]])).rows[0].application_id;
  const cancel=await import('../app/api/applications/[id]/cancel/route');
  const cancelled=await cancel.POST(request(`/api/applications/${removedApp}/cancel`,1,{reason:'가능한 일정 변경'}),{params:Promise.resolve({id:removedApp})});assert.equal(cancelled.status,200);
  const {repairTable}=await import('../lib/lifecycle-service');const repair=await repairTable(tableId);assert.equal(repair.status,'REVIEW');assert.ok(repair.proposalId);
  assert.equal((await db.query('SELECT * FROM notifications')).rowCount,4);assert.equal((await db.query('SELECT * FROM journey_rooms')).rowCount,1);
  assert.equal((await db.query<any>('SELECT status FROM dining_tables WHERE id=$1',[tableId])).rows[0].status,'EXCEPTION');
  const repaired=await review.POST(request('/api/admin/matching-review',0,{id:repair.proposalId,action:'APPROVE',version:0,venueId:venue}));assert.equal(repaired.status,200,JSON.stringify(await repaired.clone().json()));
  assert.equal((await db.query('SELECT * FROM notifications')).rowCount,8);assert.equal((await db.query('SELECT * FROM journey_rooms')).rowCount,1);
  assert.equal((await db.query<any>('SELECT status FROM dining_tables WHERE id=$1',[tableId])).rows[0].status,'CONFIRMED');
 }finally{await db.end();await rm(dir,{recursive:true,force:true});}
});
