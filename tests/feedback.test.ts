import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import pg from 'pg';

test('feedback is attendance-gated, private, editable and retractable on SQLite and PostgreSQL',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'todaytable-feedback-'));const url=process.env.TEST_PRODUCT_DATABASE_URL;
 let control:pg.Client|undefined;const schema=`tt_feedback_${randomUUID().replaceAll('-','')}`;
 if(url){const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.ok(target.pathname.endsWith('_test'));control=new pg.Client({connectionString:url});await control.connect();await control.query(`CREATE SCHEMA "${schema}"`);process.env.DATABASE_PROVIDER='postgres';process.env.DATABASE_URL=url;process.env.PGOPTIONS=`-c search_path=${schema},public`;}
 else{process.env.DATABASE_PROVIDER='sqlite';process.env.SQLITE_PATH=join(dir,'feedback.sqlite');}
 process.env.SESSION_SECRET=`feedback-${randomUUID()}-secret`;process.env.APP_URL='http://localhost';
 const {db}=await import('../lib/db');
 try{
  const path=`db/${url?'migrations':'sqlite'}`;for(const n of(await readdir(path)).filter(x=>x.endsWith('.sql')).sort())await db.execScript(await readFile(join(path,n),'utf8'));
  const {tokenHash}=await import('../lib/security'),{updatePreferenceSignals}=await import('../lib/feedback-service');
  const route=await import('../app/api/tables/[id]/feedback/route'),preferences=await import('../app/api/preferences/route');
  const user=(await db.query<any>("INSERT INTO users(email,password_hash) VALUES('reviewer@test.invalid','x') RETURNING id")).rows[0].id;
  const peer=(await db.query<any>("INSERT INTO users(email,password_hash) VALUES('peer@test.invalid','x') RETURNING id")).rows[0].id;
  const token=randomUUID();await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[user,tokenHash(token),new Date(Date.now()+3600000)]);
  const headers={origin:'http://localhost','content-type':'application/json',cookie:`todaytable_session=${token}`};
  const payload={tableScore:5,conversationScore:5,venueScore:1,returnIntent:true,recommendIntent:true,comment:'장소와 대화 평가는 따로',positives:['COMMON_INTERESTS','CONVERSATION'],improvements:['FOOD'],goodText:'편안한 대화',improveText:'소음',nextAtmosphere:'CALM',nextInterests:['독서','영화'],preferenceConfirmed:true,likedUserIds:[peer],dislikedUserIds:[]};
  const tables:string[]=[];
  async function fixture({future=false,demo=false,status='ATTENDED'}={}){
   const event=randomUUID(),run=randomUUID(),table=randomUUID(),app=randomUUID();
   const starts=new Date(Date.now()+(future?86400000:-86400000));
   await db.query("INSERT INTO events(id,title,starts_at,ends_at,area,application_deadline,capacity,status,is_demo,price_cents,created_by) VALUES($1,'Review',$2,$3,'강남',$4,20,'CLOSED',$5,8000,$6)",[event,starts,new Date(starts.getTime()+7200000),new Date(starts.getTime()-86400000),demo,user]);
   await db.query("INSERT INTO applications(id,user_id,status,matching_status,pass_choice,pass_uses,amount_cents,request_key,is_demo) VALUES($1,$2,'SUBMITTED','CONFIRMED','SINGLE',1,8000,$3,$4)",[app,user,randomUUID(),demo]);
   await db.query("INSERT INTO match_runs(id,event_id,rule_version,seed,input_snapshot,status) VALUES($1,$2,'balanced-v1','test',$3,'COMPLETED')",[run,event,JSON.stringify({policy:{id:'balanced-v1'},isDemo:demo})]);
   await db.query("INSERT INTO dining_tables(id,event_id,match_run_id,table_number,status) VALUES($1,$2,$3,1,'CONFIRMED')",[table,event,run]);
   await db.query("INSERT INTO table_members(table_id,application_id,user_id,status) VALUES($1,$2,$3,'ACTIVE')",[table,app,user]);
   const peerApp=randomUUID();await db.query("INSERT INTO applications(id,user_id,status,matching_status,pass_choice,pass_uses,amount_cents,request_key,is_demo) VALUES($1,$2,'SUBMITTED','CONFIRMED','SINGLE',1,8000,$3,$4)",[peerApp,peer,randomUUID(),demo]);
   await db.query("INSERT INTO table_members(table_id,application_id,user_id,status) VALUES($1,$2,$3,'ACTIVE')",[table,peerApp,peer]);
   await db.query('INSERT INTO attendance_records(application_id,event_id,status) VALUES($1,$2,$3)',[app,event,status]);tables.push(table);return {table,app,event};
  }
  const mutate=(table:string,b:any,method='POST')=>route[method==='DELETE'?'DELETE':'POST'](new Request(`http://localhost/api/tables/${table}/feedback`,{method,headers,body:JSON.stringify(b)}),{params:Promise.resolve({id:table})});
  const get=(table:string)=>route.GET(new Request(`http://localhost/api/tables/${table}/feedback`,{headers:{cookie:headers.cookie}}),{params:Promise.resolve({id:table})});
  const signals=async()=> (await db.query<any>('SELECT * FROM preference_signals WHERE user_id=$1',[user])).rows[0];
  const save=async(table:string,b=payload)=>{const r=await mutate(table,b);assert.equal(r.status,200,JSON.stringify(await r.json()));};
  await t.test('future events, no-shows, malformed selections and outsiders are rejected',async()=>{
   const future=await fixture({future:true}),noShow=await fixture({status:'NO_SHOW'}),past=await fixture();
   assert.equal((await mutate(future.table,payload)).status,400);assert.equal((await mutate(noShow.table,payload)).status,403);
   assert.equal((await mutate(past.table,{...payload,preferenceConfirmed:'yes'})).status,400);
   assert.equal((await mutate(past.table,{...payload,likedUserIds:[user]})).status,400);
   assert.equal((await mutate(past.table,{...payload,positives:['not a tag']})).status,400);assert.equal((await mutate(past.table,{...payload,nextAtmosphere:'constructor'})).status,400);
   assert.equal((await mutate(randomUUID(),payload)).status,404);
  });
  const real:Awaited<ReturnType<typeof fixture>>[]=[];
  await t.test('repeated saves count one review, three actual reviews unlock bounded signals, demo does not',async()=>{
   for(let n=0;n<3;n++){const f=await fixture();real.push(f);await save(f.table);await save(f.table);assert.equal(Number((await signals()).evidence_count),n+1);
    if(n===1){await db.query('UPDATE participant_preferences SET confirmed=false WHERE user_id=$1',[user]);const {enrichCandidates}=await import('../lib/matching-policy');assert.equal((await enrichCandidates(db,[{userId:user} as any],true))[0].atmosphere,undefined);}
   }
   const demo=await fixture({demo:true});await save(demo.table);assert.equal(Number((await signals()).evidence_count),3);
   const loaded=await(await get(real[0].table)).json();assert.deepEqual(loaded.feedback.nextInterests,['독서·글쓰기','영화·드라마']);assert.deepEqual(loaded.feedback.likedUserIds,[peer]);assert.equal(loaded.feedback.improveText,'소음');
   const {enrichCandidates}=await import('../lib/matching-policy');const c={userId:user} as any;
   assert.equal((await enrichCandidates(db,[c],true))[0].signalConfidence,1);
   await db.query('UPDATE participant_preferences SET confirmed=false WHERE user_id=$1',[user]);
   assert.equal((await enrichCandidates(db,[c],true))[0].signalConfidence,.75);
  });
  await t.test('venue-only feedback adds no personal compatibility evidence and recomputation is stable',async()=>{
   const before=await signals(),f=await fixture();await save(f.table,{...payload,positives:['FOOD'],nextInterests:[],preferenceConfirmed:false});assert.equal(Number((await signals()).evidence_count),Number(before.evidence_count));
   const client=await db.connect();try{await client.query('BEGIN');await updatePreferenceSignals(client,user);const first=(await client.query<any>('SELECT * FROM preference_signals WHERE user_id=$1',[user])).rows[0];await updatePreferenceSignals(client,user);const second=(await client.query<any>('SELECT * FROM preference_signals WHERE user_id=$1',[user])).rows[0];for(const key of ['atmosphere','interests','evidence_count','confidence'])assert.deepEqual(first[key],second[key]);await client.query('COMMIT');}finally{client.release();}
   assert.equal((await mutate(f.table,{},'DELETE')).status,200);
  });
  await t.test('insights keep demo data separate and distinguish intent from actual reapplication',async()=>{
   const {feedbackInsights}=await import('../lib/insights');
   const from=new Date(Date.now()-10*86400000).toISOString(),to=new Date(Date.now()+86400000).toISOString();
   const real=await feedbackInsights(db,'real',from,to),demo=await feedbackInsights(db,'demo',from,to);
   assert.equal(real.metrics.reduce((n,m)=>n+m.feedbackCount,0),3);assert.equal(demo.metrics.reduce((n,m)=>n+m.feedbackCount,0),1);
   assert.equal(real.metrics[0].actualReapplications,0);assert.equal(real.metrics[0].returnIntent,3);assert.equal(real.insufficientData,true);
   const direct=(await db.query<any>(`SELECT count(DISTINCT f.id) count FROM journey_feedback f JOIN dining_tables dt ON dt.id=f.table_id JOIN events e ON e.id=dt.event_id JOIN table_members tm ON tm.table_id=dt.id AND tm.user_id=f.author_user_id JOIN attendance_records ar ON ar.application_id=tm.application_id AND ar.event_id=e.id WHERE e.is_demo=false AND f.is_demo=false AND ar.status='ATTENDED'`)).rows[0];
   assert.equal(real.metrics[0].feedbackCount,Number(direct.count));assert.ok(!JSON.stringify(real.latest).includes(peer));
   const route=await import('../app/api/admin/insights/route');assert.equal((await route.GET(new Request('http://localhost/api/admin/insights',{headers}))).status,403);
  });
  await t.test('only an explicit separate restaurant review is published, and edits or deletion retract it',async()=>{
   const f=await fixture(),venue=(await db.query<any>("INSERT INTO venues(name,area,address,capacity) VALUES('후기 식당','홍대/합정','마포구',20) RETURNING id")).rows[0].id;
   await db.query('UPDATE dining_tables SET venue_id=$2 WHERE id=$1',[f.table,venue]);
   const {venueCatalog}=await import('../lib/venues');
   await save(f.table);
   assert.equal((await venueCatalog()).find(v=>v.id===venue)?.reviewCount,0);
   const body={...payload,publishVenueReview:true,venueReview:'음식이 맛있고 대화하기 좋은 조용한 자리였어요.'};
   assert.equal((await mutate(f.table,{...body,venueReview:''})).status,400);
   assert.equal((await mutate(f.table,body)).status,200);
   const visible=(await venueCatalog()).find(v=>v.id===venue)!;assert.equal(visible.reviewCount,1);assert.equal(visible.reviews[0].body,body.venueReview);assert.equal(visible.reviews[0].author_name,'식탁 멤버');assert.ok(!JSON.stringify(visible).includes(payload.comment));
   assert.equal((await(await get(f.table)).json()).feedback.publishVenueReview,true);
   assert.equal((await mutate(f.table,{...body,publishVenueReview:false})).status,200);
   assert.equal((await venueCatalog()).find(v=>v.id===venue)?.reviewCount,0);
   assert.equal((await mutate(f.table,body)).status,200);assert.equal((await mutate(f.table,{},'DELETE')).status,200);
   assert.equal((await venueCatalog()).find(v=>v.id===venue)?.reviewCount,0);
  });
  await t.test('confirmed preferences feed the next real automatic matching run',async()=>{
   const r=await preferences.PUT(new Request('http://localhost/api/preferences',{method:'PUT',headers,body:JSON.stringify({learningEnabled:true,confirmed:true,atmosphere:'CALM',interests:['독서']})}));assert.equal(r.status,200);
   const event=randomUUID(),start=new Date(Date.now()+7*86400000);
   await db.query("INSERT INTO events(id,title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by) VALUES($1,'Next real table',$2,$3,$4,'강남',6,8000,$5)",[event,start,new Date(start.getTime()+7200000),new Date(Date.now()-60000),user]);
   for(let n=0;n<4;n++){
    const id=n===0?user:randomUUID();if(n)await db.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'x')",[id,`next-${id}@test.invalid`]);
    await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,consent_privacy,consent_operations) VALUES($1,'참가자','',1995,'PREFER_NOT_TO_SAY','INTJ',$2::text[],true,true)`,[id,['독서']],`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,consent_privacy,consent_operations) VALUES($1,'참가자','',1995,'PREFER_NOT_TO_SAY','INTJ',$2,true,true)`);
    const app=randomUUID();await db.query("INSERT INTO applications(id,user_id,request_key,pass_choice,pass_uses,amount_cents) VALUES($1,$2,$3,'SINGLE',1,8000)",[app,id,randomUUID()]);
    await db.query("INSERT INTO payments(application_id,idempotency_key,amount_cents,status) VALUES($1,$2,8000,'PAID')",[app,randomUUID()]);
    await db.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',[app,event]);
   }
   const {seedConfirmedMatching:runMatching}=await import('../lib/lifecycle-service');const run=await runMatching(event);assert.equal(run.matchedCount,4);
   const raw=(await db.query<any>('SELECT input_snapshot FROM match_runs WHERE id=$1',[run.runId])).rows[0].input_snapshot;const snapshot=typeof raw==='string'?JSON.parse(raw):raw;
   const matched=snapshot.candidates.find((c:any)=>c.userId===user);assert.equal(matched.atmosphere,'CALM');assert.deepEqual(matched.preferredInterests,['독서·글쓰기']);assert.ok(snapshot.policy.learningEnabled);const {feedbackInsights}=await import('../lib/insights');const cohort=await feedbackInsights(db,'real',new Date(Date.now()-10*86400000).toISOString(),new Date(Date.now()+86400000).toISOString());assert.ok(cohort.metrics.reduce((n,m)=>n+m.actualReapplications,0)>0);
  });
  await t.test('editing, deleting, attendance correction and opting out remove stale evidence',async()=>{
   await save(real[0].table,{...payload,conversationScore:2});assert.equal(Number((await signals()).evidence_count),2);
   await save(real[0].table);assert.equal(Number((await signals()).evidence_count),3);
   assert.equal((await mutate(real[0].table,{},'DELETE')).status,200);assert.equal(Number((await signals()).evidence_count),2);
   await db.query("UPDATE attendance_records SET status='NO_SHOW' WHERE application_id=$1",[real[1].app]);
   const client=await db.connect();try{await client.query('BEGIN');await updatePreferenceSignals(client);await client.query('COMMIT');}finally{client.release();}
   assert.equal(Number((await signals()).evidence_count),1);
   const r=await preferences.PUT(new Request('http://localhost/api/preferences',{method:'PUT',headers,body:JSON.stringify({learningEnabled:false,confirmed:false,atmosphere:'CALM',interests:[]})}));assert.equal(r.status,200);assert.equal(await signals(),undefined);
   const {enrichCandidates}=await import('../lib/matching-policy');assert.equal((await enrichCandidates(db,[{userId:user} as any],true))[0].atmosphere,undefined);
  });
 }finally{await db.end();if(control){await control.query(`DROP SCHEMA "${schema}" CASCADE`);await control.end();}await rm(dir,{recursive:true,force:true});}
});
