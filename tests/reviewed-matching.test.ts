import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

test('availability waits for cutoff, worker confirms automatically, and explicit operator decisions remain versioned and revalidated',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'todaytable-reviewed-'));
 process.env.DATABASE_PROVIDER=process.env.REVIEW_TEST_POSTGRES?'postgres':'sqlite';process.env.SQLITE_PATH=join(dir,'review.sqlite');process.env.SESSION_SECRET='review-'+randomUUID();process.env.APP_URL='http://localhost';
 const {db}=await import('../lib/db'),{tokenHash}=await import('../lib/security');
 try{
  const directory=process.env.REVIEW_TEST_POSTGRES?'db/migrations':'db/sqlite';
  for(const file of(await readdir(directory)).filter(n=>n.endsWith('.sql')).sort())await db.execScript(await readFile(join(directory,file),'utf8'));
  const admin=(await db.query<any>("INSERT INTO users(email,password_hash,role) VALUES('ceo@todaytable','x','ADMIN') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO operator_profiles(user_id,display_name,team_role) VALUES($1,'대표','OWNER')",[admin]);
  const venue=(await db.query<any>("INSERT INTO venues(name,area,address,capacity) VALUES('조용한 식당','홍대/합정','서울 마포구',40) RETURNING id")).rows[0].id;
  await db.query('INSERT INTO venue_profiles(venue_id,interest_tags) VALUES($1,$2)',[venue,JSON.stringify(['음악'])]);
  const users:string[]=[],tokens:string[]=[];
  for(let i=0;i<13;i++){
   const id=(await db.query<any>("INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id",[`member${i}@todaytable`])).rows[0].id;users.push(id);
   await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,food_budgets,consent_privacy,consent_operations) VALUES($1,$2,'01012345678',1995,'${i%2?'WOMAN':'MAN'}','ENFP',$3,$4,true,true)`,[id,`멤버${i}`,['음악','영화·드라마'],['ANY']]);
  }
  for(const id of [admin,...users]){const token=randomUUID();tokens.push(token);await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[id,tokenHash(token),new Date(Date.now()+3600000)]);}
  const request=(path:string,index:number,body?:any)=>new Request('http://localhost'+path,{headers:{origin:'http://localhost','content-type':'application/json',cookie:`todaytable_session=${tokens[index]}`},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const {availabilityDays}=await import('../lib/availability');
  for(const day of availabilityDays().slice(0,13))await db.query("INSERT INTO events(title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by) VALUES('공개 회차',$1,$2,$3,'홍대/합정',120,8000,$4)",[new Date(`${day}T19:30:00+09:00`),new Date(`${day}T21:30:00+09:00`),new Date(`${day}T17:30:00+09:00`),admin]);
  const availability=await import('../app/api/availability/route'),review=await import('../app/api/admin/matching-review/route');
  const choices=await(await availability.GET(request('/api/availability',1))).json(),dates=[choices.days[7]],areas=['홍대/합정'];
  let firstKey='',firstId='';
  for(let i=0;i<4;i++){
   const key=randomUUID(),r=await availability.POST(request('/api/availability',i+1,{dates,areas,pass:'SINGLE',requestKey:key}));assert.equal(r.status,201,JSON.stringify(await r.clone().json()));if(i===0){firstKey=key;firstId=(await r.json()).id;}
  }
  const replay=await availability.POST(request('/api/availability',1,{dates,areas,pass:'SINGLE',requestKey:firstKey}));assert.equal(replay.status,200);assert.equal((await replay.json()).id,firstId);
  assert.equal((await availability.POST(request('/api/availability',1,{dates,areas:['잠실'],pass:'SINGLE',requestKey:firstKey}))).status,409);
  assert.equal((await db.query('SELECT * FROM applications')).rowCount,4);
  assert.equal((await db.query('SELECT * FROM availability_slots')).rowCount,0);
  const {claimJob,processJob,tick}=await import('../worker/index');
  const drain=async()=>{for(let i=0;i<100;i++){const job=await claimJob('cutoff-test');if(!job)return;await processJob(job,'cutoff-test');}throw Error('queue failed to drain');};
  await drain();
  for(const table of ['matching_proposals','dining_tables','table_members','journey_rooms'])assert.equal((await db.query(`SELECT * FROM ${table}`)).rowCount,0,`before cutoff: ${table}`);
  const event=(await db.query<any>('SELECT id event_id FROM events WHERE starts_at=$1',[new Date(`${dates[0]}T19:30:00+09:00`)])).rows[0].event_id;
  await db.query('UPDATE events SET application_deadline=$2 WHERE id=$1',[event,new Date(Date.now()-60000)]);
  await db.query("UPDATE scheduled_jobs SET run_at=now(),next_attempt_at=now() WHERE job_type='MATCH_EVENT' AND payload->>'eventId'=$1",[event],"UPDATE scheduled_jobs SET run_at=CURRENT_TIMESTAMP,next_attempt_at=CURRENT_TIMESTAMP WHERE job_type='MATCH_EVENT' AND json_extract(payload,'$.eventId')=$1");
  await tick('cutoff-test');await drain();
  const table=(await db.query<any>('SELECT * FROM dining_tables WHERE event_id=$1',[event])).rows[0];assert.ok(table);assert.equal(table.confirmation_source,'AUTO');
  assert.equal((await db.query('SELECT * FROM matching_decisions')).rowCount,0,'normal flow requires no operator decision');
  for(const [name,count]of [['dining_tables',1],['table_members',4],['journey_rooms',1],['notifications',4],['venue_booking_tasks',1]]as const)assert.equal((await db.query(`SELECT * FROM ${name}${name==='notifications'?" WHERE action_url LIKE '/tables/%'":""}`)).rowCount,count,name);
  assert.ok((await db.query<any>("SELECT action_url FROM notifications WHERE action_url LIKE '/tables/%'")).rows.every(n=>n.action_url===`/tables/${table.id}`));
  const {runMatching}=await import('../lib/lifecycle-service');await runMatching(event,'retry-after-cutoff');assert.equal((await db.query('SELECT * FROM dining_tables')).rowCount,1);assert.equal((await db.query("SELECT * FROM notifications WHERE action_url LIKE '/tables/%'")).rowCount,4);
  const chat=await import('../app/api/tables/[id]/messages/route');
  for(let i=1;i<=4;i++)assert.equal((await chat.GET(request(`/api/tables/${table.id}/messages`,i),{params:Promise.resolve({id:table.id})})).status,200);
  assert.equal((await chat.GET(request(`/api/tables/${table.id}/messages`,5),{params:Promise.resolve({id:table.id})})).status,404);
  const room=(await db.query<any>('SELECT id FROM journey_rooms WHERE table_id=$1',[table.id])).rows[0].id;
  const messageStart=Date.now()+1000;
  for(let i=1;i<=205;i++)await db.query("INSERT INTO journey_messages(id,room_id,author_user_id,body,kind,created_at,request_key) VALUES($1,$2,$3,$4,'USER',$5,$6)",[randomUUID(),room,users[0],`최근 대화 ${i}`,new Date(messageStart+i*1000),randomUUID()]);
  const recent=await(await chat.GET(request(`/api/tables/${table.id}/messages`,1),{params:Promise.resolve({id:table.id})})).json();
  assert.equal(recent.messages.length,200);assert.equal(recent.messages[0].body,'최근 대화 6');assert.equal(recent.messages[199].body,'최근 대화 205');
  const after=new Date(messageStart+203000).toISOString();
  const incremental=await(await chat.GET(request(`/api/tables/${table.id}/messages?after=${encodeURIComponent(after)}`,1),{params:Promise.resolve({id:table.id})})).json();
  assert.deepEqual(incremental.messages.map((m:any)=>m.body),['최근 대화 204','최근 대화 205']);
  assert.equal((await review.GET(request('/api/admin/matching-review',1))).status,403);
  const queue=await(await review.GET(request('/api/admin/matching-review',0))).json();assert.equal(queue.upcoming.length,1);assert.equal(queue.past.length,0);

  // Explicit preview/decision APIs remain guarded for exceptional operator use.
  for(let i=4;i<8;i++)assert.equal((await availability.POST(request('/api/availability',i+1,{dates:[choices.days[9]],areas,pass:'SINGLE',requestKey:randomUUID()}))).status,201);
  const manualEvent=(await db.query<any>('SELECT id event_id FROM events WHERE starts_at=$1',[new Date(`${choices.days[9]}T19:30:00+09:00`)])).rows[0].event_id;
  const {generateMatchingProposals}=await import('../lib/matching-review');await generateMatchingProposals(manualEvent,'explicit-preview');
  const proposal=(await db.query<any>("SELECT * FROM matching_proposals WHERE event_id=$1 AND status='PENDING'",[manualEvent])).rows[0];assert.ok(proposal);
  const decision=(body:any)=>review.POST(request('/api/admin/matching-review',0,{id:proposal.id,...body}));
  assert.equal((await decision({action:'APPROVE',version:0,venueId:venue})).status,409,'operator cannot bypass cutoff');
  assert.equal((await decision({action:'HOLD',version:0,note:'식당 확인 중'})).status,200);assert.equal((await db.query("SELECT * FROM notifications WHERE action_url LIKE '/tables/%'")).rowCount,4);
  assert.equal((await decision({action:'APPROVE',version:0,venueId:venue})).status,409);
  const {recommendVenues}=await import('../lib/venues');const eventRow=(await db.query<any>('SELECT * FROM events WHERE id=$1',[manualEvent])).rows[0],members=JSON.parse(proposal.candidates);
  await db.query('UPDATE venues SET capacity=4 WHERE id=$1',[venue]);const recommendations=await recommendVenues(db,eventRow,members,{sourceTableId:null as any});assert.equal(recommendations[0].eligible,false);assert.equal(recommendations[0].availableSeats,0);const own=await recommendVenues(db,eventRow,members,{proposalId:proposal.id});assert.equal(own[0].eligible,true);assert.equal(own[0].availableSeats,4);await db.query('UPDATE venues SET capacity=40 WHERE id=$1',[venue]);
  await db.query('UPDATE events SET application_deadline=$2 WHERE id=$1',[manualEvent,new Date(Date.now()-60000)]);await db.query('UPDATE profiles SET consent_privacy=false WHERE user_id=$1',[users[4]]);
  assert.equal((await decision({action:'APPROVE',version:1,venueId:venue})).status,409);assert.equal((await db.query('SELECT * FROM dining_tables')).rowCount,1);
  await db.query('UPDATE profiles SET consent_privacy=true WHERE user_id=$1',[users[4]]);const approved=await decision({action:'APPROVE',version:1,venueId:venue});assert.equal(approved.status,200,JSON.stringify(await approved.clone().json()));assert.equal((await decision({action:'APPROVE',version:1,venueId:venue})).status,200);assert.equal((await db.query("SELECT * FROM notifications WHERE action_url LIKE '/tables/%'")).rowCount,8);

  for(let i=8;i<12;i++)assert.equal((await availability.POST(request('/api/availability',i+1,{dates:[choices.days[11]],areas,pass:'SINGLE',requestKey:randomUUID()}))).status,201);
  const rejectedEvent=(await db.query<any>('SELECT id event_id FROM events WHERE starts_at=$1',[new Date(`${choices.days[11]}T19:30:00+09:00`)])).rows[0].event_id;await generateMatchingProposals(rejectedEvent,'reject-preview');const rejected=(await db.query<any>("SELECT * FROM matching_proposals WHERE event_id=$1 AND status='PENDING'",[rejectedEvent])).rows[0];
  assert.equal((await review.POST(request('/api/admin/matching-review',0,{id:rejected.id,action:'REJECT',version:0,note:'다른 구성으로 검토'}))).status,200);assert.equal((await db.query("SELECT * FROM notifications WHERE action_url LIKE '/tables/%'")).rowCount,8);assert.equal((await db.query("SELECT * FROM applications WHERE matching_status='WAITING'")).rowCount,4);
  const oldSlots=(await db.query('SELECT * FROM availability_slots')).rowCount;assert.equal((await availability.POST(request('/api/availability',13,{dates:[choices.days[12]],areas:['잠실'],pass:'EXISTING_PASS',requestKey:randomUUID()}))).status,409);assert.equal((await db.query('SELECT * FROM availability_slots')).rowCount,oldSlots);
 }finally{await db.end();await rm(dir,{recursive:true,force:true});}
});
