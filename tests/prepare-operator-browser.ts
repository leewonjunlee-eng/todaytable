import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Keep this fixture independent of the developer's configured database and accounts.
const fixtureEnv:NodeJS.ProcessEnv={...process.env,DATABASE_PROVIDER:'sqlite',SQLITE_PATH:resolve('.data/operator-browser.sqlite'),APP_URL:'http://127.0.0.1:3326',NODE_ENV:'development',SESSION_SECRET:`operator-browser-${randomUUID()}`,SEED_ADMIN_EMAIL:'admin@todaytable.local',SEED_ADMIN_PASSWORD:randomUUID(),SEED_PARTICIPANT_EMAIL:'guest@todaytable.local',SEED_PARTICIPANT_PASSWORD:randomUUID()};
async function main(){
await mkdir('.data',{recursive:true,mode:0o700});
for(const script of ['scripts/migrate.ts','scripts/seed.ts'])execFileSync(process.execPath,['--import','tsx',script],{env:fixtureEnv,stdio:'inherit'});
Object.assign(process.env,fixtureEnv);
const {db}=await import('../lib/db');
try{
 const {provisionOperators}=await import('../scripts/provision-operators');await provisionOperators();
 const {seedOperations}=await import('../scripts/seed-operations');await seedOperations();
 const {populateOperatorInventory}=await import('../scripts/populate-operator-workspace');await populateOperatorInventory();
 const {tokenHash}=await import('../lib/security');
 const operator=(await db.query<any>('SELECT user_id FROM operator_profiles WHERE active=true ORDER BY created_at LIMIT 1')).rows[0];
 const token=randomUUID();await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[operator.user_id,tokenHash(token),new Date(Date.now()+86400000)]);
 const tables=(await db.query<any>("SELECT t.id,t.event_id FROM dining_tables t WHERE status='CONFIRMED' ORDER BY created_at")).rows;
 const past=tables[0],upcoming=tables[1];
 const exceptionId=randomUUID();await db.query("INSERT INTO lifecycle_exceptions(id,source,entity_id,error,status) VALUES($1,'dining_table',$2,'예약 확인을 다시 검토해 주세요.','OPEN')",[exceptionId,upcoming.id]);
 await db.query('UPDATE events SET starts_at=$2,ends_at=$3 WHERE id=$1',[past.event_id,new Date(Date.now()-4*86400000),new Date(Date.now()-4*86400000+7200000)]);
 for(const [i,t] of tables.entries())await db.query("INSERT INTO venue_booking_tasks(table_id,status,reservation_name,confirmation_code,note) VALUES($1,$2,'우연한 식탁',$3,$4) ON CONFLICT(table_id) DO UPDATE SET status=excluded.status",[t.id,['CONFIRMED','TO_BOOK','REQUESTED','CHANGE_NEEDED'][i%4],`TT-UI-${i+1}`,'좌석 배치와 예약명을 확인해 주세요.']);
 const members=(await db.query<any>("SELECT user_id FROM table_members WHERE table_id=$1 AND status='ACTIVE'",[upcoming.id])).rows;
 const reason='대화 중 불편했던 행동에 대해 검토를 요청합니다.';
 if(!(await db.query('SELECT 1 FROM safety_reports WHERE table_id=$1 AND reason=$2',[upcoming.id,reason])).rowCount)await db.query('INSERT INTO safety_reports(id,table_id,reporter_user_id,target_user_id,reason) VALUES($1,$2,$3,$4,$5)',[randomUUID(),upcoming.id,members[0].user_id,members[1].user_id,reason]);
 const application=(await db.query<any>("SELECT a.id,a.user_id,u.email,u.role FROM applications a JOIN users u ON u.id=a.user_id WHERE a.matching_status='WAITING' ORDER BY a.created_at LIMIT 1")).rows[0];
 await db.query("UPDATE applications SET matching_status='ALTERNATIVE_OFFERED' WHERE id=$1",[application.id]);
 await db.query("UPDATE payments SET status='REFUND_FAILED' WHERE application_id=$1",[application.id]);
 const {createTicket}=await import('../lib/support');
 const ticket=await createTicket({user:{id:application.user_id,email:application.email,role:application.role},operator:null,visitorId:null,actorKey:`user:${application.user_id}`},{requestKey:randomUUID(),category:'PAYMENT',subject:'환불 진행 상황을 확인하고 싶어요',body:'다른 일정을 선택하기 전에 환불 상태를 확인해 주세요.',applicationId:application.id});
 await writeFile('.data/admin-browser-session.json',JSON.stringify({token,upcomingTable:upcoming.id,exceptionId,ticket:ticket.id}),{mode:0o600});
 await writeFile('.data/operator-browser.env',`DATABASE_PROVIDER=sqlite\nSQLITE_PATH=${fixtureEnv.SQLITE_PATH}\nAPP_URL=${fixtureEnv.APP_URL}\nSESSION_SECRET=${fixtureEnv.SESSION_SECRET}\n`,{mode:0o600});
 console.log('Isolated operator browser fixture ready: .data/operator-browser.env');
}finally{await db.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
