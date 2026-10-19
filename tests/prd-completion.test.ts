import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
let db:typeof import('../lib/db').db,dir:string,admin:string,user:string,event:any,venue:string,schema='';
const pgUrl=process.env.COMPLETION_TEST_POSTGRES;
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'todaytable-completion-'));
 process.env.SESSION_SECRET='completion-test-private-secret-123456';process.env.APP_URL='http://localhost';
 if(pgUrl){const u=new URL(pgUrl);assert.ok(['localhost','127.0.0.1'].includes(u.hostname)&&u.pathname.endsWith('_test'));schema=`completion_${randomUUID().replaceAll('-','')}`;const c=new pg.Client({connectionString:pgUrl});await c.connect();await c.query(`CREATE SCHEMA "${schema}"`);await c.end();process.env.DATABASE_PROVIDER='postgres';process.env.DATABASE_URL=pgUrl;process.env.PGOPTIONS=`-c search_path=${schema},public`;}
 else{process.env.DATABASE_PROVIDER='sqlite';process.env.SQLITE_PATH=join(dir,'test.sqlite');}
 ({db}=await import('../lib/db'));
 for(const file of(await readdir(pgUrl?'db/migrations':'db/sqlite')).filter(n=>n.endsWith('.sql')).sort())await db.execScript(await readFile(join(pgUrl?'db/migrations':'db/sqlite',file),'utf8'));
 admin=(await db.query<any>("INSERT INTO users(email,password_hash,role) VALUES('admin@completion','x','ADMIN') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO operator_profiles(user_id,display_name,team_role) VALUES($1,'대표','OWNER')",[admin]);
 user=(await db.query<any>("INSERT INTO users(email,password_hash) VALUES('user@completion','x') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,mbti,interests,traits,desired_traits,food_budgets,consent_privacy,consent_operations,dietary_notes) VALUES($1,'참가자','01012345678',1995,'WOMAN','ENFP',$2,$3,$3,$4,true,true,'견과류 알레르기')",[user,['음악'],[],['ANY']]);
 event=(await db.query<any>("INSERT INTO events(title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by) VALUES('공개 모집',$1,$2,$3,'홍대/합정',24,8000,$4) RETURNING *",[new Date(Date.now()+5*86400000),new Date(Date.now()+5*86400000+7200000),new Date(Date.now()+4*86400000),admin])).rows[0];
 venue=(await db.query<any>("INSERT INTO venues(name,area,address,capacity,schedule_required) VALUES('슬롯 식당','홍대/합정','마포구',24,true) RETURNING id")).rows[0].id;
});
after(async()=>{await db.end();if(pgUrl){const c=new pg.Client({connectionString:pgUrl});await c.connect();await c.query(`DROP SCHEMA "${schema}" CASCADE`);await c.end();}await rm(dir,{recursive:true,force:true});});
test('only published recruitment accepts checkout; failures resume and success is idempotent',async()=>{
 const {recruitingEvents,registerAvailability,availabilityDays}=await import('../lib/availability');const {openCheckout,resumeCheckout}=await import('../lib/checkout');
 const open=await recruitingEvents(),day=open[0].day;assert.equal(open.length,1);
 const invalid=availabilityDays().find(d=>d!==day)!;
 await assert.rejects(registerAvailability(user,{dates:[invalid],areas:['홍대/합정'],pass:'SINGLE',requestKey:randomUUID()}),/모집 중인 회차/);
 assert.equal((await db.query('SELECT 1 FROM payments')).rowCount,0);
 const selection={dates:[day],areas:['홍대/합정'],pass:'SINGLE'},checkout=await openCheckout(user,selection);
 const failed=await registerAvailability(user,{...selection,checkoutId:checkout.id,checkoutOutcome:'FAILED',requestKey:randomUUID()});assert.equal(failed.payment,'FAILED');assert.equal((await resumeCheckout(user))?.status,'FAILED');
 const key=randomUUID(),body={...selection,checkoutId:checkout.id,requestKey:key};const saved=await registerAvailability(user,body);assert.ok(saved.applicationId);assert.equal((await registerAvailability(user,body)).created,false);assert.equal(await resumeCheckout(user),null);await assert.rejects(registerAvailability(user,{...body,requestKey:randomUUID()}),/이미 완료된 결제/);
 assert.equal((await db.query('SELECT 1 FROM events')).rowCount,1);
 // Registered recruitment, including more distant dates, is the single source of truth.
 const far=(await db.query<any>("INSERT INTO events(title,starts_at,ends_at,application_deadline,area,capacity,price_cents,created_by) VALUES('장기 모집',$1,$2,$3,'홍대/합정',24,8000,$4) RETURNING id",[new Date(Date.now()+90*86400000),new Date(Date.now()+90*86400000+7200000),new Date(Date.now()+89*86400000),admin])).rows[0];
 const farDay=(await recruitingEvents()).find(e=>e.id===far.id)!.day;
 assert.ok((await registerAvailability(user,{dates:[farDay],areas:['홍대/합정'],pass:'SINGLE',requestKey:randomUUID()})).applicationId);

});
test('venue requires an open covering slot and an exact unexpired dietary confirmation',async()=>{
 const {recommendVenues}=await import('../lib/venues');const members=[{userId:user,interests:['음악']}];
 assert.equal((await recommendVenues(db,event,members))[0].eligible,false);
 const slot=randomUUID();await db.query('INSERT INTO venue_slots(id,venue_id,starts_at,ends_at,seats,table_limit,closed,created_by) VALUES($1,$2,$3,$4,24,4,false,$5)',[slot,venue,event.starts_at,event.ends_at,admin]);
 let result=(await recommendVenues(db,event,members))[0];assert.equal(result.eligible,true);assert.equal(result.requiresDietaryConfirmation,true);
 await db.query('INSERT INTO venue_dietary_checks(id,venue_id,user_id,notes,valid_until,confirmed_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),venue,user,'견과류 알레르기',new Date(+new Date(event.ends_at)+3600000),admin]);
 assert.equal((await recommendVenues(db,event,members))[0].requiresDietaryConfirmation,false);
 await db.query('UPDATE venue_slots SET closed=true WHERE id=$1',[slot]);assert.equal((await recommendVenues(db,event,members))[0].eligible,false);
});
test('business outbox preserves published template and delivers once on worker retries',async()=>{
 const {queueBusinessEvent,deliverBusinessEvent,renderMessage}=await import('../lib/business-events');
 assert.throws(()=>renderMessage('REFUND_COMPLETED','{{unexpected}}',{}),/허용 변수/);
 const template=randomUUID();await db.query("INSERT INTO notification_templates(id,kind,version,body,created_by) VALUES($1,'REFUND_COMPLETED',1,'환불 {{amount}}원 완료',$2)",[template,admin]);
 const c=await db.connect();try{await c.query('BEGIN');const args={key:'refund:test',kind:'REFUND_COMPLETED' as const,userId:user,variables:{amount:'8000'}};const id=await queueBusinessEvent(c,args);await queueBusinessEvent(c,args);await c.query('UPDATE notification_templates SET body=$2 WHERE id=$1',[template,'변경 {{amount}}']);await deliverBusinessEvent(c,id);await deliverBusinessEvent(c,id);await c.query('COMMIT');
 assert.equal((await db.query("SELECT 1 FROM business_events WHERE event_key='refund:test'")).rowCount,1);assert.equal((await db.query("SELECT 1 FROM notifications WHERE message='환불 8000원 완료'")).rowCount,1);
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
});
test('deletion holds active participation, resumes after settlement, revokes sessions and is retry safe',async()=>{
 const {registerDeletion,processDeletion}=await import('../lib/account-deletion');const ticket=randomUUID();
 await db.query("INSERT INTO support_tickets(id,number,user_id,contact_name,contact_email,category,subject) VALUES($1,'DELETE-TEST',$2,'참가자','user@completion','OTHER','삭제 요청')",[ticket,user]);
 const request=await registerDeletion(user,ticket);assert.ok(request);
 assert.equal((await processDeletion(admin,request.id,0,'EXECUTE')).status,'HELD');
 await db.query("UPDATE applications SET status='CANCELED' WHERE user_id=$1",[user]);
 await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[user,randomUUID(),new Date(Date.now()+3600000)]);
 assert.equal((await processDeletion(admin,request.id,1,'EXECUTE')).status,'COMPLETED');assert.equal((await processDeletion(admin,request.id,1,'EXECUTE')).status,'COMPLETED');
 assert.equal((await db.query('SELECT 1 FROM profiles WHERE user_id=$1',[user])).rowCount,0);assert.equal((await db.query('SELECT 1 FROM sessions WHERE user_id=$1',[user])).rowCount,0);assert.equal((await db.query<any>('SELECT restricted_status FROM users WHERE id=$1',[user])).rows[0].restricted_status,'PERMANENT');
});
