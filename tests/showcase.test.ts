import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
let dir:string,db:typeof import('../lib/db').db,payload:any,populate:typeof import('../scripts/populate-lifecycle-showcase').populateLifecycleShowcase,summary:any;
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'todaytable-showcase-'));process.env.DATABASE_PROVIDER='sqlite';process.env.SQLITE_PATH=join(dir,'isolated.sqlite');
 execFileSync(process.execPath,['--import','tsx','scripts/migrate.ts'],{env:process.env,stdio:'pipe'});
 execFileSync(process.execPath,['--import','tsx','scripts/seed.ts'],{env:process.env,stdio:'pipe'});
 execFileSync('python3',['scripts/prepare_source_data.py','--output',join(dir,'source.json')],{stdio:'pipe'});
 payload=JSON.parse(await readFile(join(dir,'source.json'),'utf8'));({db}=await import('../lib/db'));
 const admin=(await db.query<any>("SELECT id FROM users WHERE role='ADMIN' LIMIT 1")).rows[0];
 await db.query("INSERT INTO operator_profiles(user_id,display_name,team_role) VALUES($1,'운영팀','OWNER')",[admin.id]);
 ({populateLifecycleShowcase:populate}=await import('../scripts/populate-lifecycle-showcase'));summary=await populate(payload,new Date('2026-10-19T06:00:00Z'));
});
after(async()=>{if(db)await db.end();if(dir)await rm(dir,{recursive:true,force:true});});
test('all 294 supplied source rows remain distinct and linked to paid MOCK applications',async()=>{
 assert.equal(payload.records.length,294);assert.equal(summary.sourceRows,294);assert.equal(summary.past+summary.upcoming+summary.recruiting,294);
 const rows=(await db.query<any>('SELECT m.sheet_row,m.cohort,p.status,p.provider,a.is_demo,u.email FROM showcase_members m JOIN applications a ON a.id=m.application_id JOIN payments p ON p.id=m.payment_id JOIN users u ON u.id=m.user_id')).rows;
 assert.equal(new Set(rows.map(r=>r.sheet_row)).size,294);for(const r of rows){assert.equal(r.status,'PAID');assert.equal(r.provider,'MOCK');assert.equal(r.is_demo,true);assert.ok(r.email.endsWith('@showcase.todaytable.invalid'));}
 const timeline=(await db.query<any>('SELECT m.cohort,e.starts_at,e.ends_at,e.application_deadline,a.created_at FROM showcase_members m JOIN events e ON e.id=m.event_id JOIN applications a ON a.id=m.application_id')).rows;
 const now=+new Date('2026-10-19T06:00:00Z');for(const r of timeline){assert.ok(+new Date(r.created_at)<=+new Date(r.application_deadline));if(r.cohort==='PAST')assert.ok(+new Date(r.ends_at)<now);if(r.cohort==='UPCOMING'){assert.ok(+new Date(r.starts_at)>now);assert.ok(+new Date(r.application_deadline)<now);}if(r.cohort==='RECRUITING')assert.ok(+new Date(r.application_deadline)>now);}
});
test('confirmed groups have 4–6 participants, an eight year age span, and sufficient venue capacity',async()=>{
 const groups=(await db.query<any>('SELECT t.id,t.venue_id,t.starts_at,v.capacity,COUNT(*) n,MAX(p.birth_year)-MIN(p.birth_year) span FROM dining_tables t JOIN table_members m ON m.table_id=t.id JOIN profiles p ON p.user_id=m.user_id JOIN venues v ON v.id=t.venue_id GROUP BY t.id,t.venue_id,t.starts_at,v.capacity')).rows;
 assert.equal(groups.length,37);for(const g of groups){assert.ok(g.n>=4&&g.n<=6);assert.ok(g.span<=8);const seats=groups.filter(x=>x.venue_id===g.venue_id&&x.starts_at===g.starts_at).reduce((n,x)=>n+Number(x.n),0);assert.ok(seats<=g.capacity,`capacity ${seats}/${g.capacity}`);}
 assert.equal((await db.query<any>('SELECT COUNT(*) n FROM journey_feedback')).rows[0].n,83);assert.equal((await db.query<any>('SELECT COUNT(*) n FROM support_tickets')).rows[0].n,12);const {showcaseTickets}=await import('../lib/showcase');const visible=await showcaseTickets([{application_id:'legacy',created_at:'2020-01-01'},{application_id:'new',created_at:'2099-01-01'},...(await db.query<any>('SELECT application_id,created_at FROM support_tickets')).rows]);assert.equal(visible.length,13);
});
test('replaying the same source batch preserves counts and the existing review account',async()=>{
 const before=(await db.query<any>('SELECT COUNT(*) n FROM applications')).rows[0].n;assert.equal((await populate(payload,new Date('2026-10-19T06:00:00Z'))).created,false);assert.equal((await db.query<any>('SELECT COUNT(*) n FROM applications')).rows[0].n,before);
 const viewer=(await db.query<any>('SELECT u.email FROM showcase_viewers v JOIN users u ON u.id=v.user_id')).rows[0];assert.equal(viewer.email,'guest@todaytable.local');assert.equal((await db.query<any>('SELECT COUNT(*) n FROM showcase_batches WHERE active=true')).rows[0].n,1);
});
test('active fictional operations suppress external push transport even for an existing account',async()=>{
 const worker=await import('../worker/index'),user=(await db.query<any>("SELECT id FROM users WHERE email='guest@todaytable.local'")).rows[0];let sent=0;const restore=worker.setPushTransportForTests(async()=>{sent++;return {statusCode:201};});
 try{await db.query("INSERT INTO push_subscriptions(user_id,endpoint,subscription) VALUES($1,$2,$3)",[user.id,'https://push.invalid/showcase',JSON.stringify({endpoint:'https://push.invalid/showcase'})]);const key=randomUUID();await db.query("INSERT INTO scheduled_jobs(job_key,job_type,payload) VALUES($1,'PUSH_NOTIFICATION',$2)",[key,JSON.stringify({recipientUserId:user.id,message:'가상 안내'})]);const job=await worker.claimJob('showcase-test');assert.ok(job);await worker.processJob(job,'showcase-test');assert.equal(sent,0);assert.equal((await db.query<any>('SELECT status FROM scheduled_jobs WHERE job_key=$1',[key])).rows[0].status,'DONE');}finally{restore();}
});
