import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {aggregatePasses,sharedInterestKeywords,conversationQuestions} from '../lib/table-experience';
import {MBTI_TYPES,profileInput} from '../lib/profile-validation';

test('wallet groups valid credits and curation uses shared interests and concrete questions',()=>{
 const wallet=aggregatePasses([{id:'a',remaining_uses:2,expires_at:null},{id:'b',remaining_uses:1,expires_at:'2099-01-01'},{id:'c',remaining_uses:2,expires_at:'2000-01-01'}]);assert.equal(wallet?.remainingUses,3);assert.equal(wallet?.batches.length,2);
 const people=[{interests:['운동','독서']},{interests:['운동','영화']},{interests:['독서','영화']}];
 const keywords=sharedInterestKeywords(people);assert.equal(keywords.length,3);assert.ok(keywords.every(k=>k.count===2));assert.ok(conversationQuestions(people).some(q=>q.includes('최근에 관심이 생긴 운동')));assert.ok(conversationQuestions(people).some(q=>q.includes('최근에 본 영화')));assert.deepEqual(sharedInterestKeywords([{interests:['음악']},{interests:['여행']}]),[]);
 assert.equal(MBTI_TYPES.length,16);assert.equal(profileInput({}).fields.privacy,'개인정보 수집 및 이용에 동의해 주세요.');
});

test('profile saves minimal visible requirements and support separates account, guest and operator scopes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'todaytable-revision-'));process.env.DATABASE_PROVIDER='sqlite';process.env.SQLITE_PATH=join(dir,'revision.sqlite');process.env.APP_URL='http://localhost';process.env.SESSION_SECRET='revision-'+randomUUID();
 const {db}=await import('../lib/db'),{tokenHash}=await import('../lib/security');
 try{
  for(const f of(await readdir('db/sqlite')).filter(f=>f.endsWith('.sql')).sort())await db.execScript(await readFile(join('db/sqlite',f),'utf8'));
  const ids:string[]=[],cookies:string[]=[];
  for(let i=0;i<3;i++){const id=(await db.query<any>("INSERT INTO users(email,password_hash,role) VALUES($1,'x',$2) RETURNING id",[`p${i}@todaytable`,i===2?'ADMIN':'PARTICIPANT'])).rows[0].id;ids.push(id);const token=randomUUID();await db.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[id,tokenHash(token),new Date(Date.now()+3600000)]);cookies.push(`todaytable_session=${token}`);}
  await db.query("INSERT INTO operator_profiles(user_id,display_name,team_role) VALUES($1,'CTO','OWNER')",[ids[2]]);
  const req=(url:string,i:number,body?:any,extra='')=>new Request('http://localhost'+url,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{origin:'http://localhost','content-type':'application/json',cookie:cookies[i]+(extra?'; '+extra:'')}});
  const profile=await import('../app/api/profile/route');const valid={name:'김지안',phone:'010 1234 5678',birthYear:1995,gender:'WOMAN',occupation:'',mbti:'ENFP',interests:['영화·드라마'],traits:[],desiredTraits:[],foodBudgets:['ANY'],dietaryNotes:'',privacy:true,operations:true};
  const save=(b:any)=>profile.PUT(new Request('http://localhost/api/profile',{method:'PUT',headers:{origin:'http://localhost','content-type':'application/json',cookie:cookies[0]},body:JSON.stringify(b)}));
  assert.equal((await save(valid)).status,200);assert.equal((await(await profile.GET(req('/api/profile',0))).json()).mbti,'ENFP');assert.equal((await save({...valid,gender:'NON_BINARY'})).status,400);const missing=await save({...valid,interests:[]});assert.equal(missing.status,400);assert.ok((await missing.json()).fields.interests);
  const collection=await import('../app/api/support/route'),detail=await import('../app/api/support/[id]/route');
  const body={subject:'가능한 날 문의',category:'OTHER',body:'지역을 어떻게 선택하나요?',requestKey:randomUUID()};const created=await collection.POST(req('/api/support',0,body));assert.equal(created.status,201);const id=(await created.json()).id;
  assert.equal((await detail.GET(req(`/api/support/${id}`,1),{params:Promise.resolve({id})})).status,404);
  assert.equal((await detail.GET(req(`/api/support/${id}`,2),{params:Promise.resolve({id})})).status,404);
  assert.equal((await detail.GET(req(`/api/support/${id}?view=operator`,2),{params:Promise.resolve({id})})).status,200);
  assert.equal((await(await collection.GET(req('/api/support',1))).json()).tickets.length,0);assert.equal((await(await collection.GET(req('/api/support?view=operator',2))).json()).tickets.length,1);
  const guest=await collection.POST(new Request('http://localhost/api/support',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({...body,name:'방문자',email:'visitor@example.com',requestKey:randomUUID()})}));const guestCookie=guest.headers.get('set-cookie')!.split(';')[0],guestId=(await guest.json()).id;
  assert.equal((await detail.GET(req(`/api/support/${guestId}`,1,undefined,guestCookie),{params:Promise.resolve({id:guestId})})).status,404);assert.equal((await(await collection.GET(req('/api/support',1,undefined,guestCookie))).json()).tickets.length,0);
  const replied=await detail.POST(req(`/api/support/${id}?view=operator`,2,{action:'MESSAGE',kind:'PUBLIC',version:0,body:'가능한 지역에서 함께할 식탁을 준비할게요.',requestKey:randomUUID()}),{params:Promise.resolve({id})});assert.equal(replied.status,200);
  const visible=await(await detail.GET(req(`/api/support/${id}`,0),{params:Promise.resolve({id})})).json();assert.equal(visible.messages[1].author_name,'운영자');assert.equal(visible.messages[1].author_role,'OPERATOR');assert.equal(visible.messages[1].author_user_id,null);assert.ok(!JSON.stringify(visible).includes('CTO'));
 }finally{await db.end();await rm(dir,{recursive:true,force:true});}
});
