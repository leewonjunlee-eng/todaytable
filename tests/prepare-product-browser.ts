import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

async function main(){
 const env:NodeJS.ProcessEnv={...process.env,DATABASE_PROVIDER:'sqlite',SQLITE_PATH:resolve('.data/goal-browser.sqlite'),NODE_ENV:'development',APP_URL:'http://127.0.0.1:3210',SEED_ADMIN_EMAIL:'admin@todaytable.local',SEED_ADMIN_PASSWORD:'AdminDemo!2026',SEED_PARTICIPANT_EMAIL:'guest@todaytable.local',SEED_PARTICIPANT_PASSWORD:'GuestDemo!2026'};
 await mkdir('.data',{recursive:true,mode:0o700});
 for(const script of ['scripts/migrate.ts','scripts/seed.ts','scripts/seed-operations.ts'])execFileSync(process.execPath,['--import','tsx',script],{env,stdio:'inherit'});
 Object.assign(process.env,env);
 const {provisionOperators}=await import('../scripts/provision-operators'),{db}=await import('../lib/db');
 try{
  const result=await provisionOperators(),path='.data/goal-browser-credentials.json';
  const previous=JSON.parse(await readFile(path,'utf8').catch(()=>'{}'));
  const credentials=new Map<string,any>((previous.credentials??[]).map((c:any)=>[c.email,c]));for(const c of result.credentials)credentials.set(c.email,c);
  if(result.operators.some((o:any)=>o.role==='OPERATOR'&&!credentials.has(o.email)))throw new Error('The isolated browser DB already has operators but its saved fixture credentials are missing. Use a fresh isolated browser DB.');
  await writeFile(path,JSON.stringify({...result,credentials:[...credentials.values()]},null,2),{mode:0o600});await chmod(path,0o600);
  const secret=`isolated-browser-${randomUUID()}-secret`;
  await writeFile('.data/product-browser.env',`DATABASE_PROVIDER=sqlite\nSQLITE_PATH=${env.SQLITE_PATH}\nAPP_URL=${env.APP_URL}\nSESSION_SECRET=${secret}\nHOSTNAME=127.0.0.1\nPORT=3210\n`,{mode:0o600});await chmod('.data/product-browser.env',0o600);
  console.log('Isolated browser fixtures and .data/product-browser.env are ready.');
 }finally{await db.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
