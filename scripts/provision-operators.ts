import {randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {db} from '../lib/db';
import {hashPassword} from '../lib/security';
export async function provisionOperators(){
 const client=await db.connect();const credentials:Array<{email:string;password:string;role:string}>=[];
 try{await client.query('BEGIN');
 const existing=await client.query<any>("SELECT id,email FROM users WHERE role='ADMIN' AND restricted_status='ACTIVE' ORDER BY CASE WHEN email IN ('ceo@todaytable','operator@todaytable.local') THEN 0 ELSE 1 END,created_at");
 if(existing.rowCount>3)throw new Error('More than three active admins exist; map their roles explicitly before provisioning.');
 const members=existing.rows;
 for(let n=members.length;n<3;n++){
  const email=['ceo@todaytable','pd@todaytable','cto@todaytable'][n],password=`Tt!${randomUUID().replaceAll('-','').slice(0,20)}`;
  const conflict=await client.query('SELECT 1 FROM users WHERE email=$1',[email]);if(conflict.rowCount)throw new Error(`Account ${email} already exists with another role.`);
  const user=(await client.query<any>("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'ADMIN') RETURNING id",[email,await hashPassword(password)])).rows[0];members.push({...user,email});credentials.push({email,password,role:n===0?'OWNER':'OPERATOR'});
 }
 for(const [n,m] of members.entries())await client.query(`INSERT INTO operator_profiles(user_id,display_name,team_role,avatar_color) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING`,[m.id,['대표','PD','CTO'][n],n===0?'OWNER':'OPERATOR',['#73563e','#72836d','#bc795d'][n]]);
 const templates=[['welcome','처음 참가하는 분께','APPLICATION','{{name}}님, 문의해 주셔서 감사합니다. 가능한 일정과 취향을 등록한 뒤 참가권을 선택하면 신청이 완료됩니다. 마감 후 어울리는 식탁과 장소를 안내해 드려요.'],['payment','결제 상태 확인','PAYMENT','{{name}}님, 현재 연결된 신청의 상태는 {{payment_status}}입니다. 추가 확인이 필요한 부분은 이 문의에서 이어서 안내해 드릴게요.'],['matching','매칭 안내','MATCHING','{{name}}님, 현재 연결된 신청은 {{matching_status}}입니다. 내 식탁에서 일정·장소·안내를 확인하실 수 있으며 추가 확인이 필요한 내용은 이 대화에서 이어서 안내하겠습니다.'],['receipt','확인 후 답변 안내','OTHER','문의 {{ticket_number}} 내용을 확인하고 있습니다. 확인이 끝나는 대로 이 대화에서 이어서 안내하겠습니다.']];
 for(const [id,title,category,body]of templates)await client.query('INSERT INTO support_templates(id,title,category,body) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[id,title,category,body]);
 const profiles=await client.query('SELECT u.email,o.display_name name,o.team_role role FROM operator_profiles o JOIN users u ON u.id=o.user_id ORDER BY o.created_at,o.user_id');
 await client.query('COMMIT');return {operators:profiles.rows,credentials};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
if(process.argv[1]?.endsWith('provision-operators.ts'))provisionOperators().then(async result=>{if(result.credentials.length){await mkdir('.data',{recursive:true});await writeFile('.data/new-operator-credentials.json',JSON.stringify(result.credentials,null,2),{mode:0o600});}console.log(JSON.stringify({operators:result.operators,created:result.credentials.length,credentialsFile:result.credentials.length?'.data/new-operator-credentials.json':null}));}).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.end());
