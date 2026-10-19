import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
let db:typeof import('../lib/db').db,dir:string,pgSchema='',admin:string;
const pgUrl=process.env.AUTO_TEST_POSTGRES;
before(async()=>{dir=await mkdtemp(join(tmpdir(),'todaytable-auto-'));process.env.SESSION_SECRET='automatic-private-test-secret-123456';process.env.APP_URL='http://localhost';
 if(pgUrl){pgSchema=`auto_${randomUUID().replaceAll('-','')}`;const c=new pg.Client({connectionString:pgUrl});await c.connect();await c.query(`CREATE SCHEMA "${pgSchema}"`);await c.end();process.env.DATABASE_PROVIDER='postgres';process.env.DATABASE_URL=pgUrl;process.env.PGOPTIONS=`-c search_path=${pgSchema},public`;}else{process.env.DATABASE_PROVIDER='sqlite';process.env.SQLITE_PATH=join(dir,'auto.sqlite');}
 ({db}=await import('../lib/db'));const folder=pgUrl?'db/migrations':'db/sqlite';for(const name of(await readdir(folder)).filter(n=>n.endsWith('.sql')).sort())await db.execScript(await readFile(join(folder,name),'utf8'));
 admin=(await db.query<any>("INSERT INTO users(email,password_hash,role) VALUES('admin@auto','x','ADMIN') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO operator_profiles(user_id,display_name,team_role) VALUES($1,'대표','OWNER')",[admin]);
});
after(async()=>{await db.end();if(pgUrl){const c=new pg.Client({connectionString:pgUrl});await c.connect();await c.query(`DROP SCHEMA "${pgSchema}" CASCADE`);await c.end();}await rm(dir,{recursive:true,force:true});});
async function userApp(event:string,index:number){const id=(await db.query<any>("INSERT INTO users(email,password_hash) VALUES($1,'x') RETURNING id",[`${randomUUID()}@auto`])).rows[0].id;
 await db.query("INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,traits,desired_traits,food_budgets,consent_privacy,consent_operations) VALUES($1,$2,'01012345678',1995,$7,'ENFP',$3,$4,$5,$6,true,true)",[id,`참가자${index}`,['음악','여행'],[],[],['ANY'],index%2?'WOMAN':'MAN']);
 const {submitApplication}=await import('../lib/application-service');const app=await submitApplication(id,{eventIds:[event],pass:'SINGLE',requestKey:randomUUID()});return {id,app:app.id};}
async function fixture(count=4){
 // Keep venue availability isolated between cases while preserving earlier participant records.
 await db.query('UPDATE venues SET active=false');
 const venue=(await db.query<any>("INSERT INTO venues(name,area,address,capacity) VALUES('자동 식당','홍대/합정','마포구 식탁로 1',100) RETURNING id")).rows[0].id;await db.query("INSERT INTO venue_profiles(venue_id) VALUES($1)",[venue]);
 const event=(await db.query<any>("INSERT INTO events(title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by) VALUES('자동 만남',$1,$2,$3,'홍대/합정',60,8000,$4) RETURNING id",[new Date(Date.now()+5*86400000),new Date(Date.now()+5*86400000+7200000),new Date(Date.now()+3600000),admin])).rows[0].id;
 const people=[];for(let i=0;i<count;i++)people.push(await userApp(event,i));return {event,venue,people};}
async function close(event:string){await db.query('UPDATE events SET application_deadline=$2 WHERE id=$1',[event,new Date(Date.now()-60000)]);}
async function open(event:string){await db.query('UPDATE events SET application_deadline=$2 WHERE id=$1',[event,new Date(Date.now()+3600000)]);}
test('deadline worker automatically confirms, provisions all guidance, and retries without duplicate seats or messages',async()=>{
 const f=await fixture(),{runMatching}=await import('../lib/lifecycle-service'),worker=await import('../worker/index');
 assert.equal((await runMatching(f.event)).matchedCount,0);assert.equal((await db.query('SELECT 1 FROM dining_tables WHERE event_id=$1',[f.event])).rowCount,0);
 await close(f.event);await worker.scheduleDueMatchJobs();const queued=(await db.query<any>("SELECT id FROM scheduled_jobs WHERE job_type='MATCH_EVENT' AND job_key=$1",[`match-event:automatic-v3:${f.event}`])).rows[0];assert.ok(queued);
 for(let i=0;i<30;i++){const job=await worker.claimJob('auto-test');if(!job)break;await worker.processJob(job,'auto-test');}
 const tables=(await db.query<any>('SELECT * FROM dining_tables WHERE event_id=$1',[f.event])).rows;assert.equal(tables.length,1);assert.equal(tables[0].confirmation_source,'AUTO');assert.equal(tables[0].provision_status,'PROVISIONED');
 assert.equal((await db.query("SELECT 1 FROM matching_decisions")).rowCount,0);
 assert.equal((await db.query('SELECT 1 FROM table_members WHERE table_id=$1',[tables[0].id])).rowCount,4);
 const notifications=(await db.query<any>('SELECT message FROM notifications WHERE event_id=$1',[f.event])).rows;assert.equal(notifications.length,4);assert.match(notifications[0].message,/예약명/);assert.match(notifications[0].message,/마포구 식탁로 1/);assert.match(notifications[0].message,/48시간/);
 assert.equal((await db.query('SELECT 1 FROM venue_booking_tasks WHERE table_id=$1',[tables[0].id])).rowCount,1);
 const before=(await db.query('SELECT 1 FROM journey_messages')).rowCount;await runMatching(f.event);assert.equal((await db.query('SELECT 1 FROM journey_messages')).rowCount,before);assert.equal((await db.query('SELECT 1 FROM notifications WHERE event_id=$1',[f.event])).rowCount,4);
});
test('a changed consent retires the stale proposal and offers alternatives without confirming invalid members',async()=>{
 const f=await fixture(),{generateMatchingProposals}=await import('../lib/matching-review'),{runMatching}=await import('../lib/lifecycle-service');
 await generateMatchingProposals(f.event);await db.query('UPDATE profiles SET consent_privacy=false WHERE user_id=$1',[f.people[0].id]);await close(f.event);const result=await runMatching(f.event);assert.equal(result.matchedCount,0);
 assert.equal((await db.query<any>('SELECT status FROM matching_proposals WHERE event_id=$1',[f.event])).rows[0].status,'STALE');assert.equal(result.unmatched.length,3);
 assert.equal((await db.query("SELECT 1 FROM applications WHERE matching_status='ALTERNATIVE_OFFERED' AND id IN (SELECT application_id FROM application_options WHERE event_id=$1)",[f.event])).rowCount,3);
});
test('venue shortage waits safely, and adding an eligible venue unblocks automatic confirmation on retry',async()=>{
 const f=await fixture(),{runMatching}=await import('../lib/lifecycle-service');await db.query('UPDATE venues SET active=false');await close(f.event);
 const first=await runMatching(f.event);assert.equal(first.matchedCount,0);assert.equal(first.needsBooking,1);assert.equal((await db.query<any>('SELECT status FROM matching_proposals WHERE event_id=$1',[f.event])).rows[0].status,'HELD');
 await db.query('UPDATE venues SET active=true WHERE id=$1',[f.venue]);const second=await runMatching(f.event);assert.equal(second.matchedCount,4);assert.equal((await db.query('SELECT 1 FROM dining_tables WHERE event_id=$1',[f.event])).rowCount,1);
});
test('timed vacancy offers require an owned consent response and revalidate capacity before joining',async()=>{
 const f=await fixture(),{runMatching}=await import('../lib/lifecycle-service');await close(f.event);await runMatching(f.event);await open(f.event);const fifth=await userApp(f.event,5),sixth=await userApp(f.event,6);await close(f.event);await runMatching(f.event);
 const {offerVacantSeats,participantOffers,respondToOffer}=await import('../lib/waitlist');const c=await db.connect();await c.query('BEGIN');await offerVacantSeats(c);await c.query('COMMIT');c.release();
 const offers=[...await participantOffers(fifth.id),...await participantOffers(sixth.id)];assert.equal(offers.length,1);const offer=offers[0];const owner=(await db.query<any>('SELECT a.user_id FROM waitlist_offers w JOIN applications a ON a.id=w.application_id WHERE w.id=$1',[offer.id])).rows[0].user_id;
 await assert.rejects(respondToOffer(f.people[0].id,offer.id,true),/찾을 수/);
 const first=await respondToOffer(owner,offer.id,false);assert.equal(first.status,'DECLINED');assert.equal((await respondToOffer(owner,offer.id,false)).replayed,true);
 const next=[...await participantOffers(fifth.id),...await participantOffers(sixth.id)];assert.equal(next.length,1);assert.notEqual(next[0].id,offer.id);
 const nextOwner=owner===fifth.id?sixth.id:fifth.id;const joined=await respondToOffer(nextOwner,next[0].id,true);assert.equal(joined.status,'ACCEPTED');assert.equal((await respondToOffer(nextOwner,next[0].id,true)).replayed,true);
 const members=(await db.query<any>("SELECT tm.user_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=$1 AND tm.status='ACTIVE'",[f.event])).rows;assert.equal(members.length,5);assert.ok(members.some(m=>m.user_id===nextOwner));assert.ok(!members.some(m=>m.user_id===owner));
});
test('a cancellation invites a replacement and acceptance repairs the table and closes obsolete alternatives',async()=>{
 const f=await fixture(),{runMatching,resolveApplication}=await import('../lib/lifecycle-service');await close(f.event);await runMatching(f.event);await open(f.event);const extra=await userApp(f.event,6);await close(f.event);await runMatching(f.event);
 assert.equal((await db.query<any>('SELECT status FROM resolution_cases WHERE application_id=$1',[extra.app])).rows[0].status,'OFFERED');
 const {tokenHash}=await import('../lib/security');const token=randomUUID();await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[f.people[0].id,tokenHash(token),new Date(Date.now()+3600000)]);
 const {POST:cancel}=await import('../app/api/applications/[id]/cancel/route');const r=await cancel(new Request(`http://localhost/api/applications/${f.people[0].app}/cancel`,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',cookie:`todaytable_session=${token}`},body:JSON.stringify({reason:'일정 변경'})}),{params:Promise.resolve({id:f.people[0].app})});assert.equal(r.status,200);
 const worker=await import('../worker/index');for(let i=0;i<100;i++){const j=await worker.claimJob('repair-auto');if(!j)break;await worker.processJob(j,'repair-auto');}
 const {participantOffers,respondToOffer}=await import('../lib/waitlist');const offers=await participantOffers(extra.id);assert.equal(offers.length,1);assert.equal((await respondToOffer(extra.id,offers[0].id,true)).status,'ACCEPTED');
 const table=(await db.query<any>('SELECT id,status FROM dining_tables WHERE event_id=$1',[f.event])).rows[0];assert.equal(table.status,'CONFIRMED');assert.equal((await db.query("SELECT 1 FROM table_members WHERE table_id=$1 AND status='ACTIVE'",[table.id])).rowCount,4);
 assert.equal((await db.query<any>('SELECT matching_status FROM applications WHERE id=$1',[extra.app])).rows[0].matching_status,'CONFIRMED');assert.equal((await db.query<any>('SELECT status FROM resolution_cases WHERE application_id=$1',[extra.app])).rows[0].status,'TRANSFERRED');
 await assert.rejects(resolveApplication(extra.id,extra.app,'HOLD',1),/확정된 식탁|이미 처리/);
});
test('two underfilled tables merge after invitations settle without losing survivors or duplicating seats',async()=>{
 const f=await fixture(8),{runMatching,repairTable}=await import('../lib/lifecycle-service');await close(f.event);await runMatching(f.event);
 const tables=(await db.query<any>('SELECT id FROM dining_tables WHERE event_id=$1 ORDER BY id',[f.event])).rows;assert.equal(tables.length,2);
 for(const t of tables){const m=(await db.query<any>("SELECT application_id FROM table_members WHERE table_id=$1 AND status='ACTIVE' ORDER BY application_id LIMIT 1",[t.id])).rows[0];await db.query("UPDATE table_members SET status='REMOVED' WHERE table_id=$1 AND application_id=$2",[t.id,m.application_id]);await db.query("UPDATE applications SET status='CANCELED' WHERE id=$1",[m.application_id]);await db.query("UPDATE dining_tables SET status='EXCEPTION' WHERE id=$1",[t.id]);}
 assert.equal((await repairTable(tables[0].id)).status,'REPAIRED');
 const active=(await db.query<any>("SELECT tm.application_id,tm.table_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id WHERE t.event_id=$1 AND t.status='CONFIRMED' AND tm.status='ACTIVE'",[f.event])).rows;assert.equal(active.length,6);assert.equal(new Set(active.map(m=>m.application_id)).size,6);assert.equal(new Set(active.map(m=>m.table_id)).size,1);
});
test('private exports exclude other accounts and deletion requests remain reviewable in the inquiry inbox',async()=>{
 const f=await fixture(1),{tokenHash}=await import('../lib/security');const token=randomUUID();await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[f.people[0].id,tokenHash(token),new Date(Date.now()+3600000)]);const headers={origin:'http://localhost','content-type':'application/json',cookie:`todaytable_session=${token}`};
 const {GET}=await import('../app/api/account/export/route'),{POST}=await import('../app/api/account/deletion/route');const exported=await GET(new Request('http://localhost/api/account/export',{headers}));assert.equal(exported.status,200);const data=await exported.json();assert.equal(data.applications.length,1);assert.equal(data.applications[0].id,f.people[0].app);assert.ok(!JSON.stringify(data).includes('password_hash'));
 const key=randomUUID(),request=()=>new Request('http://localhost/api/account/deletion',{method:'POST',headers,body:JSON.stringify({confirmed:true,requestKey:key})});const response=await POST(request());assert.equal(response.status,201);const ticket=(await response.json()).id;assert.equal((await POST(request())).status,200);assert.equal((await db.query('SELECT 1 FROM support_tickets WHERE id=$1 AND user_id=$2',[ticket,f.people[0].id])).rowCount,1);assert.equal((await db.query('SELECT 1 FROM users WHERE id=$1',[f.people[0].id])).rowCount,1);
});
test('stale proposals reject a profile change that breaks the gender composition',async()=>{
 const f=await fixture();await close(f.event);const {generateMatchingProposals,automaticallyConfirmProposal}=await import('../lib/matching-review');const proposed=await generateMatchingProposals(f.event,'gender-stale');assert.equal(proposed.proposalIds.length,1);await db.query("UPDATE profiles SET gender='WOMAN' WHERE user_id=$1",[f.people[0].id]);await assert.rejects(automaticallyConfirmProposal(db as any,proposed.proposalIds[0]),/성비/);assert.equal((await db.query('SELECT id FROM dining_tables WHERE event_id=$1',[f.event])).rowCount,0);
});
test('a cancellation that leaves four people with a 3:1 ratio requires repair',async()=>{
 const f=await fixture(5);await close(f.event);const {runMatching}=await import('../lib/lifecycle-service');await runMatching(f.event);const {tokenHash}=await import('../lib/security'),token=randomUUID();await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[f.people[1].id,tokenHash(token),new Date(Date.now()+3600000)]);const {POST}=await import('../app/api/applications/[id]/cancel/route');const response=await POST(new Request('http://localhost/api/applications/'+f.people[1].app+'/cancel',{method:'POST',headers:{origin:'http://localhost',cookie:`todaytable_session=${token}`,'content-type':'application/json'},body:JSON.stringify({reason:'일정 변경'})}),{params:Promise.resolve({id:f.people[1].app})});assert.equal(response.status,200);assert.equal((await db.query<any>('SELECT status FROM dining_tables WHERE event_id=$1',[f.event])).rows[0].status,'EXCEPTION');
});
test('editing a confirmed profile cannot silently invalidate the table ratio',async()=>{
 const f=await fixture();await close(f.event);const {runMatching}=await import('../lib/lifecycle-service');await runMatching(f.event);const {tokenHash}=await import('../lib/security'),token=randomUUID();await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[f.people[0].id,tokenHash(token),new Date(Date.now()+3600000)]);const {PUT}=await import('../app/api/profile/route');const response=await PUT(new Request('http://localhost/api/profile',{method:'PUT',headers:{origin:'http://localhost','content-type':'application/json',cookie:`todaytable_session=${token}`},body:JSON.stringify({name:'참가자0',phone:'01012345678',birthYear:1995,gender:'WOMAN',occupation:'',mbti:'ENFP',interests:['음악','여행'],traits:[],desiredTraits:[],foodBudgets:['ANY'],dietaryNotes:'',privacy:true,operations:true})}));assert.equal(response.status,409);assert.ok((await response.json()).fields.gender);assert.equal((await db.query<any>('SELECT gender FROM profiles WHERE user_id=$1',[f.people[0].id])).rows[0].gender,'MAN');
});
