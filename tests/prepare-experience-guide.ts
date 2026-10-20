/** Dedicated local fixture for guide screenshots and browser checks; never production. */
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {newSessionToken,tokenHash,hashPassword} from '../lib/security';
async function main(){
  if(process.env.DATABASE_PROVIDER!=='sqlite'||resolve(process.env.SQLITE_PATH??'')!==resolve('.data/operator-browser.sqlite'))throw new Error('Use only the dedicated operator-browser SQLite fixture.');
  await mkdir('.data/final-guide',{recursive:true,mode:0o700});
  const {db}=await import('../lib/db');
  try{
const profiles=(await db.query<any>('SELECT user_id FROM profiles ORDER BY user_id')).rows;
for(const [i,row] of profiles.entries())await db.query('UPDATE profiles SET display_name=$2,contact_phone=$3 WHERE user_id=$1',[row.user_id,`체험 참가자 ${i+1}`,'01000000000']);
await db.query("UPDATE venue_booking_tasks SET reservation_name='우연한 식탁',confirmation_code=CASE WHEN status='CONFIRMED' THEN '체험예약-102' ELSE '' END,note='조용한 좌석으로 예약 요청, 식사 예산은 방문 전 다시 확인해 주세요.'");
await db.query("UPDATE table_reservations SET reservation_name='우연한 식탁'");
await db.query("UPDATE attendance_records SET status='SCHEDULED',checked_in_at=NULL WHERE event_id IN (SELECT id FROM events WHERE starts_at>now())");
const upcoming=(await db.query<any>("SELECT tm.user_id,tm.table_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id JOIN profiles p ON p.user_id=tm.user_id WHERE tm.status='ACTIVE' AND t.status='CONFIRMED' AND e.starts_at>now() AND p.gender IN ('MAN','WOMAN') LIMIT 1")).rows[0];
const past=(await db.query<any>("SELECT tm.user_id,tm.table_id FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id JOIN attendance_records ar ON ar.application_id=tm.application_id WHERE tm.status='ACTIVE' AND ar.status='ATTENDED' AND e.starts_at<now() LIMIT 1")).rows[0];
const operator=(await db.query<any>('SELECT user_id FROM operator_profiles WHERE active=true LIMIT 1')).rows[0];
const result:any={};
for(const [key,row] of Object.entries({upcoming,past,operator})){if(!row)continue;const token=newSessionToken();await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,datetime('now','+1 day'))",[(row as any).user_id,tokenHash(token)]);const email=(await db.query<any>('SELECT email FROM users WHERE id=$1',[(row as any).user_id])).rows[0].email;const password=newSessionToken();await db.query('UPDATE users SET password_hash=$2 WHERE id=$1',[(row as any).user_id,await hashPassword(password)]);result[key]={...(row as any),token,email,password};}
await writeFile('.data/final-guide/screenshots.json',JSON.stringify(result),{mode:0o600});
console.log('Isolated screenshot sessions ready:',Object.keys(result).join(', '));

  }finally{await db.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
