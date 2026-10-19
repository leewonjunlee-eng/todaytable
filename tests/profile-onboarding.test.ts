import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PROFILE_QUESTIONS,profileTestResult,validProfileTestAnswers} from '../lib/profile-test';
let db:typeof import('../lib/db').db,dir:string,pgClient:import('pg').Client|undefined,pgSchema='';
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'todaytable-profile-'));
 const postgres=Boolean(process.env.PROFILE_TEST_POSTGRES);
 if(postgres){
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test'))throw Error('Use a dedicated local *_test PostgreSQL database.');
  const {Client}=await import('pg');pgClient=new Client({connectionString:url});await pgClient.connect();
  pgSchema='tt_profile_'+randomUUID().replaceAll('-','');await pgClient.query(`CREATE SCHEMA ${pgSchema}`);
  process.env.DATABASE_URL=url;process.env.PGOPTIONS=`-c search_path=${pgSchema},public`;
 }
 process.env.DATABASE_PROVIDER=postgres?'postgres':'sqlite';process.env.SQLITE_PATH=join(dir,'profile.sqlite');process.env.SESSION_SECRET='profile-onboarding-private-test-secret-123456';process.env.APP_URL='http://localhost';
 ({db}=await import('../lib/db'));const directory=postgres?'db/migrations':'db/sqlite';
 for(const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort()){
  let sql=await readFile(join(directory,name),'utf8');
  if(postgres&&name==='004_attendance.sql')sql=sql.replace(/^CREATE TYPE attendance_status[^;]+;\s*/m,'');
  await db.execScript(sql);
 }
});
after(async()=>{await db?.end();if(pgClient){if(pgSchema)await pgClient.query(`DROP SCHEMA ${pgSchema} CASCADE`);await pgClient.end();}if(dir)await rm(dir,{recursive:true,force:true});});
function request(path:string,body:any,cookie='',origin='http://localhost'){return new Request(`http://localhost${path}`,{method:path==='/api/profile'?'PUT':'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify(body)});}
test('original situational choices map to existing matching traits and reject incomplete or invented answers',()=>{const answers={arrival:'calm',conversation:'deep',role:'listen'};assert.equal(validProfileTestAnswers(answers),true);assert.equal(validProfileTestAnswers({...answers,role:'administrator'}),false);assert.equal(validProfileTestAnswers({...answers,extra:'secret'}),false);assert.equal(validProfileTestAnswers({arrival:'calm'}),false);assert.deepEqual(profileTestResult(answers).traits,['잔잔하고 조용한 편','깊은 대화를 좋아함','경청을 잘 함']);assert.equal(PROFILE_QUESTIONS.length,3);});
test('signup, own profile and quiz save are atomic, role safe, private and reusable',async()=>{
 const {POST:register}=await import('../app/api/auth/register/route');const {GET,PUT}=await import('../app/api/profile/route');const {POST:login}=await import('../app/api/auth/login/route');
 assert.equal((await register(request('/api/auth/register',{email:'new@todaytable',password:'today1234'},'','https://wrong.invalid'))).status,403);
 assert.equal((await register(request('/api/auth/register',{email:'bad',password:'x'}))).status,400);
 const response=await register(request('/api/auth/register',{email:'NEW@todaytable',password:'today1234',role:'ADMIN'}));assert.equal(response.status,201);const cookie=response.headers.get('set-cookie')!.split(';')[0];assert.equal((await response.json()).next,'/profile/test');
 const user=(await db.query("SELECT id,role,password_hash FROM users WHERE email='new@todaytable'")).rows[0];assert.equal(user.role,'PARTICIPANT');assert.match(user.password_hash,/^scrypt\$/);assert.equal(await (await GET(new Request('http://localhost/api/profile',{headers:{cookie}}))).json(),null);
 assert.equal((await register(request('/api/auth/register',{email:'new@todaytable',password:'today1234'}))).status,409);
 const answers={arrival:'calm',conversation:'deep',role:'listen'};const body={name:'새 참가자',phone:'010-1234-5678',birthYear:1995,gender:'PREFER_NOT_TO_SAY',occupation:'기획자',mbti:'INFP',interests:['음악'],traits:['경청을 잘 함'],desiredTraits:['나와 비슷한 사람'],foodBudgets:['ANY'],dietaryNotes:'',privacy:true,operations:true,testAnswers:answers};
 assert.equal((await PUT(request('/api/profile',{...body,testAnswers:{arrival:'calm'}},cookie))).status,400);assert.equal((await db.query('SELECT 1 FROM profiles')).rowCount,0);
 assert.equal((await PUT(request('/api/profile',body,cookie))).status,200);
 const own=await (await GET(new Request('http://localhost/api/profile',{headers:{cookie}}))).json();assert.equal(own.display_name,'새 참가자');assert.deepEqual(own.traits,['경청을 잘 함']);assert.deepEqual(own.profile_test.answers,answers);assert.equal(own.profile_test.test_version,'dinner-style-v1');
 const other=await register(request('/api/auth/register',{email:'other@todaytable',password:'today1234'}));assert.equal(await (await GET(new Request('http://localhost/api/profile',{headers:{cookie:other.headers.get('set-cookie')!.split(';')[0]}}))).json(),null);
 assert.equal((await PUT(request('/api/profile',{...body,name:'바꾼 이름',testAnswers:undefined},cookie))).status,200);assert.equal((await db.query('SELECT 1 FROM profile_tests WHERE user_id=$1',[user.id])).rowCount,1);assert.equal(Number((await db.query("SELECT count(*) count FROM audit_logs WHERE action='PROFILE_UPDATED'")).rows[0].count),2);
 const signedIn=await login(request('/api/auth/login',{email:'new@todaytable',password:'today1234'}));assert.equal(signedIn.status,200);assert.equal((await signedIn.json()).next,'/');
 await db.query("UPDATE users SET restricted_status='SUSPENDED' WHERE id=$1",[user.id]);assert.equal((await login(request('/api/auth/login',{email:'new@todaytable',password:'today1234'}))).status,401);assert.equal((await GET(new Request('http://localhost/api/profile',{headers:{cookie}}))).status,401);
});
