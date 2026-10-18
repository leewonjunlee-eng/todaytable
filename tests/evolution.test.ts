import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import pg from 'pg';

test('three-operator support preserves ownership, private notes, ordering, version conflicts and audit history',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'todaytable-evolution-'));let schema:string|undefined,pgClient:pg.Client|undefined;
 const url=process.env.TEST_PRODUCT_DATABASE_URL;
 if(url){const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.ok(target.pathname.endsWith('_test'));schema=`tt_evolution_${randomUUID().replaceAll('-','')}`;pgClient=new pg.Client({connectionString:url});await pgClient.connect();await pgClient.query(`CREATE SCHEMA "${schema}"`);process.env.DATABASE_PROVIDER='postgres';process.env.DATABASE_URL=url;process.env.PGOPTIONS=`-c search_path=${schema},public`;}
 else {process.env.DATABASE_PROVIDER='sqlite';process.env.SQLITE_PATH=join(dir,'evolution.sqlite');}
 process.env.SESSION_SECRET=`evolution-${randomUUID()}-secret`;process.env.APP_URL='http://localhost';
 const {db}=await import('../lib/db');
 try{
  const migrationPath=`db/${url?'migrations':'sqlite'}`;
  for(const name of (await readdir(migrationPath)).filter(n=>n.endsWith('.sql')).sort())await db.execScript(await readFile(join(migrationPath,name),'utf8'));
  for(let n=0;n<3;n++)await db.query("INSERT INTO users(email,password_hash,role) VALUES($1,'x','ADMIN')",[`op${n}@test.invalid`]);
  const user=(await db.query<any>("INSERT INTO users(email,password_hash) VALUES('person@test.invalid','x') RETURNING id")).rows[0].id;
  const other=(await db.query<any>("INSERT INTO users(email,password_hash) VALUES('other@test.invalid','x') RETURNING id")).rows[0].id;
  const {provisionOperators}=await import('../scripts/provision-operators');await provisionOperators();await provisionOperators();assert.equal((await db.query('SELECT 1 FROM operator_profiles')).rowCount,3);
  const operators=(await db.query<any>('SELECT * FROM operator_profiles ORDER BY created_at,user_id')).rows;
  const owner=operators.find(o=>o.team_role==='OWNER'),staff=operators.find(o=>o.team_role==='OPERATOR'),third=operators.find(o=>o.user_id!==owner.user_id&&o.user_id!==staff.user_id);
  const {tokenHash}=await import('../lib/security');const sessions=new Map<string,string>();
  for(const id of [owner.user_id,staff.user_id,third.user_id,user,other]){const token=randomUUID();sessions.set(id,token);await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[id,tokenHash(token),new Date(Date.now()+3600000)]);}
  const headers=(id?:string,cookie?:string)=>({origin:'http://localhost','content-type':'application/json',...(id?{cookie:`todaytable_session=${sessions.get(id)}`} :cookie?{cookie}: {})});
  const collection=await import('../app/api/support/route');const detail=await import('../app/api/support/[id]/route');const team=await import('../app/api/admin/team/route');
  const post=(body:any,id?:string,cookie?:string)=>collection.POST(new Request('http://localhost/api/support',{method:'POST',headers:headers(id,cookie),body:JSON.stringify(body)}));
  const get=(ticket:string,id?:string,cookie?:string)=>detail.GET(new Request(`http://localhost/api/support/${ticket}${operators.some(o=>o.user_id===id)?'?view=operator':''}`,{headers:headers(id,cookie)}),{params:Promise.resolve({id:ticket})});
  const mutate=(ticket:string,body:any,id?:string,cookie?:string)=>detail.POST(new Request(`http://localhost/api/support/${ticket}${operators.some(o=>o.user_id===id)?'?view=operator':''}`,{method:'POST',headers:headers(id,cookie),body:JSON.stringify(body)}),{params:Promise.resolve({id:ticket})});
  let ticket='';
  await t.test('authenticated and guest requests are repeat-safe and isolated',async()=>{
   const b={subject:'매칭 안내를 알고 싶어요',category:'MATCHING',body:'언제 식탁이 확정되나요?',requestKey:randomUUID()};
   const created=await post(b,user);assert.equal(created.status,201,JSON.stringify(await created.clone().json()));ticket=(await created.json()).id;
   assert.equal((await post(b,user)).status,200);assert.equal((await post(b,other)).status,409);
   assert.equal((await get(ticket,other)).status,404);assert.equal((await get(ticket)).status,404);
   const guest=await post({...b,requestKey:randomUUID(),name:'방문자',email:'guest@test.invalid'});assert.equal(guest.status,201);
   const cookie=guest.headers.get('set-cookie')!.split(';')[0];assert.match(cookie,/todaytable_support=/);const guestId=(await guest.json()).id;
   assert.equal((await get(guestId,undefined,cookie)).status,200);assert.equal((await get(guestId,user)).status,404);
   const forged=await mutate(guestId,{action:'MESSAGE',kind:'INTERNAL',body:'private',requestKey:randomUUID(),version:0},undefined,cookie);assert.equal(forged.status,403);
  });
  await t.test('A assigns, B adds a private note, C replies without duplicate or stale writes',async()=>{
   const assigned=await mutate(ticket,{action:'UPDATE',version:0,assigneeId:staff.user_id,status:'IN_PROGRESS',tags:['첫 참가'],priority:'HIGH'},owner.user_id);assert.equal(assigned.status,200,JSON.stringify(await assigned.clone().json()));
   assert.equal((await mutate(ticket,{action:'PRESENCE',composing:true},staff.user_id)).status,200);
   assert.equal((await mutate(ticket,{action:'MESSAGE',version:1,kind:'INTERNAL',body:'내부 전용: 마감 시각 확인 필요',requestKey:randomUUID()},staff.user_id)).status,200);
   const body={action:'MESSAGE',version:2,kind:'PUBLIC',body:'신청 마감 후 순서대로 안내됩니다.',requestKey:randomUUID()};
   assert.equal((await mutate(ticket,body,third.user_id)).status,200);assert.equal((await mutate(ticket,body,third.user_id)).status,200);
   const conflict=await mutate(ticket,{...body,requestKey:randomUUID()},owner.user_id);assert.equal(conflict.status,409);
   const participant=await (await get(ticket,user)).json();assert.equal(participant.messages.length,2);assert.equal(participant.messages[0].body,'언제 식탁이 확정되나요?');assert.equal(participant.messages[1].body,body.body);assert.equal(participant.timeline.length,0);assert.equal(participant.context,null);assert.ok(!JSON.stringify(participant).includes('내부 전용'));
   const admin=await(await get(ticket,owner.user_id)).json();assert.equal(admin.messages.length,3);assert.equal(admin.presence[0].composing,true);assert.ok(admin.timeline.some((a:any)=>a.actor_name===staff.display_name));assert.equal(admin.ticket.version,3);
   assert.equal((await db.query('SELECT 1 FROM notifications WHERE recipient_user_id=$1',[user])).rowCount,1);
   assert.equal((await db.query<any>('SELECT action_url FROM notifications WHERE recipient_user_id=$1',[user])).rows[0].action_url,`/support?id=${ticket}`);
   assert.equal((await db.query<any>('SELECT t.id FROM support_tickets t JOIN support_reads r ON r.ticket_id=t.id WHERE t.id=$1 AND r.actor_key=$2 AND r.read_at>=t.last_public_at',[ticket,`user:${third.user_id}`])).rowCount,1);
  });
  await t.test('resolution, helpfulness, reopening and improvement linkage are recorded',async()=>{
   assert.equal((await mutate(ticket,{action:'UPDATE',version:3,status:'RESOLVED',category:'MATCHING'},owner.user_id)).status,200);
   assert.equal((await mutate(ticket,{action:'HELPFUL',helpful:true},user)).status,200);
   assert.equal((await mutate(ticket,{action:'IMPROVEMENT',title:'마감 안내를 더 명확하게'},staff.user_id)).status,200);
   assert.equal((await db.query('SELECT 1 FROM improvement_tickets WHERE ticket_id=$1',[ticket])).rowCount,1);
   assert.equal((await mutate(ticket,{action:'MESSAGE',kind:'PUBLIC',body:'추가 질문이 있어요.',version:4,requestKey:randomUUID()},user)).status,200);
   const state=await(await get(ticket,user)).json();assert.equal(state.ticket.status,'OPEN');
  });
  await t.test('owner-only settings enforce server permissions',async()=>{
   const request=(data:any,id:string)=>new Request('http://localhost/api/admin/team',{method:'POST',headers:headers(id),body:JSON.stringify(data)});
   const body={action:'TEMPLATE',id:'test-macro',title:'안내',category:'OTHER',body:'{{name}}님, 확인하겠습니다.'};
   assert.equal((await team.POST(request(body,staff.user_id))).status,403);assert.equal((await team.POST(request(body,owner.user_id))).status,200);
   assert.equal((await team.POST(request({action:'OPERATOR',id:owner.user_id,displayName:'운영 총괄',avatarColor:'#73563e',active:false},owner.user_id))).status,400);
  });
  await t.test('matching previews compare policies without effects, reject stale inputs and feed the actual automatic run',async()=>{
   const studio=await import('../app/api/admin/matching-studio/route');
   const request=(body:any,id=owner.user_id)=>new Request('http://localhost/api/admin/matching-studio',{method:'POST',headers:headers(id),body:JSON.stringify(body)});
   const event=(await db.query<any>("INSERT INTO events(title,starts_at,application_deadline,area,capacity,price_cents,created_by) VALUES('Policy comparison',$1,$2,'홍대/합정',24,8000,$3) RETURNING id",[new Date(Date.now()+5*86400000),new Date(Date.now()+86400000),owner.user_id])).rows[0].id;
   const people:string[]=[];
   const {submitApplication}=await import('../lib/application-service');
   for(let n=0;n<8;n++){
    const person=(await db.query<any>("INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id",[`match-${n}@test.invalid`])).rows[0].id;people.push(person);
    const interest=n<4?'음악':'여행';
    await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,traits,desired_traits,consent_privacy,consent_operations) VALUES($1,$2,'010',1994,$3,'INFP',$4,$5,$6,true,true)`,[person,`참가자 ${n}`,n%2?'MAN':'WOMAN',url?[interest]:JSON.stringify([interest]),url?['경청을 잘 함']:JSON.stringify(['경청을 잘 함']),url?['경청을 잘 함']:JSON.stringify(['경청을 잘 함'])]);
    await submitApplication(person,{eventIds:[event],pass:'SINGLE',requestKey:randomUUID()});
   }
   const oldEvent=(await db.query<any>("INSERT INTO events(title,starts_at,application_deadline,area,capacity,price_cents,created_by) VALUES('Prior gathering',$1,$2,'홍대/합정',24,8000,$3) RETURNING id",[new Date(Date.now()-10*86400000),new Date(Date.now()-12*86400000),owner.user_id])).rows[0].id;
   const runId=randomUUID(),oldTable=randomUUID();
   await db.query("INSERT INTO match_runs(id,event_id,rule_version,seed) VALUES($1,$2,'test','test')",[runId,oldEvent]);
   await db.query("INSERT INTO dining_tables(id,event_id,match_run_id,table_number) VALUES($1,$2,$3,1)",[oldTable,oldEvent,runId]);
   for(const cohort of [people.slice(0,4),people.slice(4,8)])for(const a of cohort)for(const b of cohort)if(a!==b)await db.query('INSERT INTO match_history(id,table_id,user_id,other_user_id) VALUES($1,$2,$3,$4)',[randomUUID(),oldTable,a,b]);
   const before=(await db.query<any>('SELECT (SELECT count(*) FROM dining_tables) tables,(SELECT count(*) FROM scheduled_jobs) jobs,(SELECT count(*) FROM notifications) notifications')).rows[0];
   const firstResponse=await studio.POST(request({action:'PREVIEW',eventId:event}));assert.equal(firstResponse.status,200,JSON.stringify(await firstResponse.clone().json()));const first=await firstResponse.json();
   assert.equal(first.results.length,4);assert.ok(first.results.every((r:any)=>r.matchedCount===8));
   const stable=await(await studio.POST(request({action:'PREVIEW',eventId:event}))).json();assert.equal(stable.snapshotHash,first.snapshotHash);assert.deepEqual(stable.results,first.results);
   assert.deepEqual((await db.query<any>('SELECT (SELECT count(*) FROM dining_tables) tables,(SELECT count(*) FROM scheduled_jobs) jobs,(SELECT count(*) FROM notifications) notifications')).rows[0],before);
   const affinity=first.results.find((r:any)=>r.policyId==='affinity-v1'),discovery=first.results.find((r:any)=>r.policyId==='discovery-v1');assert.notDeepEqual(affinity.groups.map((g:any)=>g.members.map((m:any)=>m.userId).sort()).sort(),discovery.groups.map((g:any)=>g.members.map((m:any)=>m.userId).sort()).sort());
   await db.query("UPDATE profiles SET mbti='ENFP' WHERE user_id=$1",[people[0]]);
   assert.equal((await studio.POST(request({action:'APPLY',previewId:first.id,policyId:'affinity-v1'}))).status,409);
   const fresh=await(await studio.POST(request({action:'PREVIEW',eventId:event}))).json();
   assert.equal((await studio.POST(request({action:'APPLY',previewId:fresh.id,policyId:'affinity-v1'},staff.user_id))).status,200);
   const def=(await db.query<any>('SELECT version FROM matching_defaults WHERE id=1')).rows[0];
   assert.equal((await studio.POST(request({action:'DEFAULT',policyId:'discovery-v1',version:def.version},staff.user_id))).status,403);
   assert.equal((await studio.POST(request({action:'DEFAULT',policyId:'discovery-v1',version:def.version}))).status,200);
   assert.equal((await studio.POST(request({action:'DEFAULT',policyId:'balanced-v1',version:def.version}))).status,409);
   assert.equal((await studio.POST(request({action:'DEFAULT',policyId:'balanced-v1',version:Number(def.version)+1}))).status,200);
   await db.query('UPDATE events SET application_deadline=$2 WHERE id=$1',[event,new Date(Date.now()-1000)]);
   const {seedConfirmedMatching:runMatching}=await import('../lib/lifecycle-service');const result=await runMatching(event);assert.equal(result.matchedCount,8);
   assert.equal((await db.query<any>('SELECT rule_version FROM match_runs WHERE id=$1',[result.runId])).rows[0].rule_version,'affinity-v1');
   const actual=(await db.query<any>("SELECT tm.table_id,tm.user_id FROM table_members tm JOIN dining_tables dt ON dt.id=tm.table_id WHERE dt.event_id=$1 AND tm.status='ACTIVE' ORDER BY tm.table_id,tm.user_id",[event])).rows;
   const actualGroups=[...new Set(actual.map(r=>r.table_id))].map(id=>actual.filter(r=>r.table_id===id).map(r=>r.user_id).sort()).sort();
   assert.deepEqual(actualGroups,fresh.results.find((r:any)=>r.policyId==='affinity-v1').groups.map((g:any)=>g.members.map((m:any)=>m.userId).sort()).sort());
   assert.equal((await studio.POST(request({action:'APPLY',previewId:fresh.id,policyId:'discovery-v1'}))).status,409);
  });
  await t.test('connected events keep distinct policies, capacity limits and deterministic automatic output',async()=>{
   const a=randomUUID(),b=randomUUID();
   const start=new Date(Date.now()+5*86400000),end=new Date(start.getTime()+7200000);
   for(const [id,deadline] of [[a,Date.now()-120000],[b,Date.now()-60000]] as const)await db.query("INSERT INTO events(id,title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by) VALUES($1,'Connected',$2,$3,$4,'강남',6,8000,$5)",[id,start,end,new Date(deadline),owner.user_id]);
   await db.query('INSERT INTO event_policies(event_id,policy_id,preview_hash,applied_by) VALUES($1,$2,$3,$4)',[a,'balanced-v1','fixture',owner.user_id]);
   await db.query('INSERT INTO event_policies(event_id,policy_id,preview_hash,applied_by) VALUES($1,$2,$3,$4)',[b,'conversation-v1','fixture',owner.user_id]);
   for(let n=0;n<12;n++){
    const u=randomUUID(),app=randomUUID();
    await db.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'x')",[u,`connected-${u}@test.invalid`]);
    await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,consent_privacy,consent_operations) VALUES($1,'연결 참가자','',1995,'PREFER_NOT_TO_SAY','INTJ',$2::text[],true,true)`,[u,['여행']],`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,consent_privacy,consent_operations) VALUES($1,'연결 참가자','',1995,'PREFER_NOT_TO_SAY','INTJ',$2,true,true)`);
    await db.query("INSERT INTO applications(id,user_id,request_key,pass_choice,pass_uses,amount_cents) VALUES($1,$2,$3,'SINGLE',1,8000)",[app,u,randomUUID()]);
    await db.query("INSERT INTO payments(application_id,idempotency_key,amount_cents,status) VALUES($1,$2,8000,'PAID')",[app,randomUUID()]);
    for(const id of n<8?[a,b]:[b])await db.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',[app,id]);
   }
   const future=randomUUID();await db.query("INSERT INTO events(id,title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by,status) VALUES($1,'Closed but not due',$2,$3,$4,'강남',6,8000,$5,'CLOSED')",[future,start,end,new Date(Date.now()+86400000),owner.user_id]);
   const shared=(await db.query<any>('SELECT application_id FROM application_options WHERE event_id=$1 LIMIT 1',[a])).rows[0].application_id;
   await db.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',[shared,future]);
   const {matchingInput,effectivePolicy,evaluatePolicy}=await import('../lib/matching-policy');
   const input=await matchingInput(db,a),p=await effectivePolicy(db,a),preview=evaluatePolicy(input,p);
   assert.equal(preview.matchedCount,12);assert.deepEqual(evaluatePolicy(input,p),preview);
   const {seedConfirmedMatching:runMatching}=await import('../lib/lifecycle-service');const actual=await runMatching(a);assert.equal(actual.matchedCount,12);assert.deepEqual(await runMatching(a),actual);
   const rows=(await db.query<any>('SELECT t.event_id,t.id,r.rule_version,count(tm.user_id) seats FROM dining_tables t JOIN match_runs r ON r.id=t.match_run_id JOIN table_members tm ON tm.table_id=t.id WHERE t.event_id IN ($1,$2) GROUP BY t.event_id,t.id,r.rule_version',[a,b])).rows;
   assert.equal((await db.query('SELECT 1 FROM dining_tables WHERE event_id=$1',[future])).rowCount,0);
   assert.equal(rows.length,2);for(const row of rows){assert.equal(Number(row.seats),6);assert.equal(row.rule_version,row.event_id===a?'balanced-v1':'conversation-v1');}
   const actualMembers=(await db.query<any>('SELECT tm.user_id,tm.table_id,t.event_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id IN ($1,$2)',[a,b])).rows;
   assert.equal(new Set(actualMembers.map(r=>r.user_id)).size,12);
   for(const group of preview.groups){const ids=actualMembers.filter(r=>r.event_id===group.eventId).map(r=>r.user_id).sort();assert.deepEqual(ids,group.members.map(m=>m.userId).sort());}
  });
  await t.test('owners create immutable custom policies with personalization disabled',async()=>{
   const studio=await import('../app/api/admin/matching-studio/route');
   const req=(body:any,id=owner.user_id)=>new Request('http://localhost/api/admin/matching-studio',{method:'POST',headers:headers(id),body:JSON.stringify(body)});
   const body={action:'CUSTOM_POLICY',name:'후기 제외 검증 기조',description:'명시 선호와 후기 반영을 끈 새 불변 버전',weights:{gender:.35,mbti:.1,interests:.3,traits:.15,novelty:.1},minScore:0,learningEnabled:false};
   assert.equal((await studio.POST(req(body,staff.user_id))).status,403);const created=await studio.POST(req(body));assert.equal(created.status,200);const id=(await created.json()).id;
   const row=(await db.query<any>('SELECT * FROM matching_policies WHERE id=$1',[id])).rows[0];assert.equal(row.learning_enabled,false);
   const before=(await db.query<any>('SELECT version FROM matching_defaults WHERE id=1')).rows[0].version;
   assert.equal((await studio.POST(req({action:'DEFAULT',policyId:id,version:before}))).status,200);
   const {effectivePolicy}=await import('../lib/matching-policy');const effective=await effectivePolicy(db,randomUUID());assert.equal(effective.id,id);assert.equal(effective.learningEnabled,false);
   assert.equal((await studio.POST(req({action:'DEFAULT',policyId:'balanced-v1',version:Number(before)+1}))).status,200);
  });
  await t.test('existing seats consume capacity and overlapping seated users cannot receive a second seat',async()=>{
   const main=randomUUID(),otherEvent=randomUUID(),starts=new Date(Date.now()+9*86400000),ends=new Date(starts.getTime()+7200000);
   for(const id of [main,otherEvent])await db.query("INSERT INTO events(id,title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by) VALUES($1,'Existing seats',$2,$3,$4,'강남',10,8000,$5)",[id,starts,ends,new Date(Date.now()-60000),owner.user_id]);
   async function table(event:string){const run=randomUUID(),id=randomUUID();await db.query("INSERT INTO match_runs(id,event_id,rule_version,seed) VALUES($1,$2,'balanced-v1','existing')",[run,event]);await db.query('INSERT INTO dining_tables(id,event_id,match_run_id,table_number) VALUES($1,$2,$3,1)',[id,event,run]);return id;}
   const seated=await table(main),overlap=await table(otherEvent);
   async function person(event:string,seat?:string,existing?:string){const id=existing??randomUUID(),app=randomUUID();if(!existing){await db.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'x')",[id,`seats-${id}@test.invalid`]);await db.query(`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,consent_privacy,consent_operations) VALUES($1,'참가자','',1995,'PREFER_NOT_TO_SAY','INTJ',$2::text[],true,true)`,[id,['음악']],`INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,consent_privacy,consent_operations) VALUES($1,'참가자','',1995,'PREFER_NOT_TO_SAY','INTJ',$2,true,true)`);}
    await db.query("INSERT INTO applications(id,user_id,request_key,pass_choice,pass_uses,amount_cents,matching_status) VALUES($1,$2,$3,'SINGLE',1,8000,$4)",[app,id,randomUUID(),seat?'CONFIRMED':'WAITING']);await db.query("INSERT INTO payments(application_id,idempotency_key,amount_cents,status) VALUES($1,$2,8000,'PAID')",[app,randomUUID()]);await db.query('INSERT INTO application_options(application_id,event_id) VALUES($1,$2)',[app,event]);if(seat)await db.query('INSERT INTO table_members(table_id,application_id,user_id) VALUES($1,$2,$3)',[seat,app,id]);return id;
   }
   for(let n=0;n<4;n++)await person(main,seated);
   const occupiedUser=await person(otherEvent,overlap);for(let n=0;n<3;n++)await person(otherEvent,overlap);
   for(let n=0;n<6;n++)await person(main);await person(main,undefined,occupiedUser);
   const {matchingInput,effectivePolicy,evaluatePolicy}=await import('../lib/matching-policy');const input=await matchingInput(db,main);assert.ok(!input.candidates.some(c=>c.userId===occupiedUser));const preview=evaluatePolicy(input,await effectivePolicy(db,main));assert.equal(preview.matchedCount,6);assert.equal((await db.query('SELECT 1 FROM table_members WHERE table_id=$1',[seated])).rowCount,4);assert.ok(preview.groups.every(g=>g.members.every(m=>m.userId!==occupiedUser)));
  });
  await t.test('new reply templates without client IDs preserve audit references on PostgreSQL',async()=>{
   for(const payload of [null,{action:'OPERATOR',id:'invalid',displayName:'이름',avatarColor:'#73563e',active:true}])assert.equal((await team.POST(new Request('http://localhost/api/admin/team',{method:'POST',headers:headers(owner.user_id),body:JSON.stringify(payload)}))).status,400);
   const insights=await import('../app/api/admin/insights/route');assert.equal((await insights.GET(new Request('http://localhost/api/admin/insights?from=2026-02-31',{headers:headers(owner.user_id)}))).status,400);
   const title=`새 템플릿 ${randomUUID()}`,body={action:'TEMPLATE',title,category:'MATCHING',body:'현재 신청은 {{matching_status}}입니다.'};
   const create=await team.POST(new Request('http://localhost/api/admin/team',{method:'POST',headers:headers(owner.user_id),body:JSON.stringify(body)}));assert.equal(create.status,200,JSON.stringify(await create.json()));
   const template=(await db.query<any>('SELECT id FROM support_templates WHERE title=$1',[title])).rows[0];assert.ok(template.id);
   assert.equal((await db.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='TEMPLATE'",[template.id])).rowCount,1);
   const removed=await team.POST(new Request('http://localhost/api/admin/team',{method:'POST',headers:headers(owner.user_id),body:JSON.stringify({action:'DELETE_TEMPLATE',id:template.id})}));assert.equal(removed.status,200);
  });
  await t.test('compatibility rule changes publish the effective default and owner handoff stays singular',async()=>{
   const rules=await import('../app/api/admin/matching-rules/route');
   const body={version:'compat-verified-v1',minScore:0,weights:{gender:.2,mbti:.05,interests:.5,traits:.2,novelty:.05},learningEnabled:false};
   const put=(id:string)=>rules.PUT(new Request('http://localhost/api/admin/matching-rules',{method:'PUT',headers:headers(id),body:JSON.stringify(body)}));
   assert.equal((await put(staff.user_id)).status,403);assert.equal((await put(owner.user_id)).status,200);assert.equal((await put(owner.user_id)).status,409);
   const effective=await(await rules.GET(new Request('http://localhost/api/admin/matching-rules',{headers:headers(owner.user_id)}))).json();assert.equal(effective.version,body.version);
   const transfer=(id:string)=>team.POST(new Request('http://localhost/api/admin/team',{method:'POST',headers:headers(owner.user_id),body:JSON.stringify({action:'TRANSFER_OWNER',id})}));
   const outcomes=await Promise.all([transfer(staff.user_id),transfer(third.user_id)]);assert.equal(outcomes.filter(r=>r.status===200).length,1);assert.ok(outcomes.some(r=>[403,409].includes(r.status)));
   assert.equal((await db.query("SELECT 1 FROM operator_profiles WHERE team_role='OWNER' AND active=true")).rowCount,1);
  });
 }finally{await db.end();if(pgClient&&schema){await pgClient.query(`DROP SCHEMA "${schema}" CASCADE`);await pgClient.end();}await rm(dir,{recursive:true,force:true});}
});
