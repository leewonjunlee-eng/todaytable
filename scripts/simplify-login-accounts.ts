import {db,databaseProvider} from '../lib/db';
import {hashPassword} from '../lib/security';

export const LOGIN_ACCOUNTS = [
 {previous:'operator@todaytable.local',email:'ceo@todaytable',name:'대표',role:'ADMIN',teamRole:'OWNER'},
 {previous:'operator2@todaytable.local',email:'pd@todaytable',name:'PD',role:'ADMIN',teamRole:'OPERATOR'},
 {previous:'operator3@todaytable.local',email:'cto@todaytable',name:'CTO',role:'ADMIN',teamRole:'OPERATOR'},
 {previous:'user@todaytable.local',email:'user@todaytable',name:'사용자',role:'PARTICIPANT',teamRole:null},
] as const;

export async function simplifyLoginAccounts(password:string){
 if(typeof password!=='string'||password.length<4||password.length>200)throw new Error('계정 비밀번호를 확인해 주세요.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
  const planned=[];
  for(const account of LOGIN_ACCOUNTS){
   const rows=(await c.query<any>('SELECT id,email,role,restricted_status FROM users WHERE email IN ($1,$2) FOR UPDATE',[account.previous,account.email])).rows;
   if(rows.length!==1||rows[0].role!==account.role||rows[0].restricted_status!=='ACTIVE')throw new Error(`계정 연결을 확인해 주세요: ${account.email}`);
   if(account.teamRole&&!(await c.query('SELECT 1 FROM operator_profiles WHERE user_id=$1',[rows[0].id])).rowCount)throw new Error(`운영자 프로필이 없습니다: ${account.email}`);
   planned.push({...account,id:rows[0].id});
  }
  let revokedSessions=0;
  for(const account of planned){
   await c.query('UPDATE users SET email=$2,password_hash=$3 WHERE id=$1',[account.id,account.email,await hashPassword(password)]);
   if(account.teamRole)await c.query('UPDATE operator_profiles SET display_name=$2,team_role=$3,active=true WHERE user_id=$1',[account.id,account.name,account.teamRole]);
   revokedSessions+=(await c.query('DELETE FROM sessions WHERE user_id=$1',[account.id])).rowCount;
   await c.query('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,$4,$5)',[planned[0].id,'LOGIN_ACCOUNT_UPDATED','user',account.id,JSON.stringify({email:account.email,name:account.name,credentialsRotated:true})]);
  }
  const total=(await c.query<any>('SELECT count(*) total FROM users')).rows[0];
  await c.query('COMMIT');return {accounts:planned.map(({previous,...a})=>a),totalAccounts:Number(total.total),revokedSessions};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
if(process.argv[1]?.endsWith('simplify-login-accounts.ts'))simplifyLoginAccounts(process.env.TODAYTABLE_LOGIN_PASSWORD??'').then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());
