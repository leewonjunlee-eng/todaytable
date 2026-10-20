import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

test('short login accounts retain identity and permissions, rotate sessions, and roll back collisions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'todaytable-logins-'));
 process.env.DATABASE_PROVIDER='sqlite';process.env.SQLITE_PATH=join(dir,'accounts.sqlite');process.env.SESSION_SECRET='account-test-'+randomUUID();process.env.APP_URL='http://localhost';
 const {db}=await import('../lib/db'),{hashPassword,verifyPassword}=await import('../lib/security');
 try{
  for(const file of(await readdir('db/sqlite')).filter(n=>n.endsWith('.sql')).sort())await db.execScript(await readFile(join('db/sqlite',file),'utf8'));
  const {LOGIN_ACCOUNTS,simplifyLoginAccounts}=await import('../scripts/simplify-login-accounts');
  const original=new Map<string,string>();
  for(const a of LOGIN_ACCOUNTS){
   const id=(await db.query<any>('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id',[a.previous,await hashPassword('original-password'),a.role])).rows[0].id;original.set(a.email,id);
   if(a.teamRole)await db.query('INSERT INTO operator_profiles(user_id,display_name,team_role) VALUES($1,$2,$3)',[id,'운영자',a.teamRole]);
   await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,datetime('now','+1 day'))",[id,randomUUID()]);
  }
  const result=await simplifyLoginAccounts('simple1234');assert.equal(result.totalAccounts,4);assert.equal(result.revokedSessions,4);
  const {POST}=await import('../app/api/auth/login/route');
  for(const a of LOGIN_ACCOUNTS){
   const row=(await db.query<any>('SELECT * FROM users WHERE email=$1',[a.email])).rows[0];assert.equal(row.id,original.get(a.email));assert.equal(row.role,a.role);assert.ok(await verifyPassword('simple1234',row.password_hash));
   const response=await POST(new Request('http://localhost/api/auth/login',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({email:a.email,password:'simple1234'})}));assert.equal(response.status,200);assert.equal((await response.json()).role,a.role);
   if(a.role==='PARTICIPANT'){
    const {POST:createInquiry}=await import('../app/api/support/route');
    const inquiry=await createInquiry(new Request('http://localhost/api/support',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',cookie:response.headers.get('set-cookie')!.split(';')[0]},body:JSON.stringify({category:'OTHER',subject:'다음 식탁 일정 문의',body:'다음에 신청할 수 있는 날짜를 알고 싶어요.',requestKey:randomUUID()})}));assert.equal(inquiry.status,201);
   }
   if(a.teamRole){const o=(await db.query<any>('SELECT display_name,team_role FROM operator_profiles WHERE user_id=$1',[row.id])).rows[0];assert.equal(o.display_name,a.name);assert.equal(o.team_role,a.teamRole);}
  }
  const operatorLogin=async(email:string)=>POST(new Request('http://localhost/api/auth/login',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({email,password:'simple1234',audience:'operator'})}));
  const participant=LOGIN_ACCOUNTS.find(a=>a.role==='PARTICIPANT')!;
  const operator=LOGIN_ACCOUNTS.find(a=>a.teamRole)!;
  const sessionsBefore=(await db.query('SELECT * FROM sessions')).rowCount;
  assert.equal((await operatorLogin(participant.email)).status,403);
  assert.equal((await db.query('SELECT * FROM sessions')).rowCount,sessionsBefore);
  const operatorResponse=await operatorLogin(operator.email);
  assert.equal(operatorResponse.status,200);assert.equal((await operatorResponse.json()).next,'/admin');
  await db.query('UPDATE operator_profiles SET active=false WHERE user_id=$1',[original.get(operator.email)]);
  assert.equal((await operatorLogin(operator.email)).status,403);
  await db.query('UPDATE operator_profiles SET active=true WHERE user_id=$1',[original.get(operator.email)]);
  await db.query("INSERT INTO users(email,password_hash,role) VALUES('operator2@todaytable.local','unchanged','ADMIN')");
  const before=(await db.query('SELECT id,email,password_hash FROM users ORDER BY email')).rows;
  await assert.rejects(simplifyLoginAccounts('different-password'),/계정 연결/);
  assert.deepEqual((await db.query('SELECT id,email,password_hash FROM users ORDER BY email')).rows,before);
 }finally{await db.end();await rm(dir,{recursive:true,force:true});}
});
