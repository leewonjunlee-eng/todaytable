import {readFile,cp} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
const fixture=parseEnv(await readFile('.data/product-browser.env','utf8'));
if(fixture.DATABASE_PROVIDER!=='sqlite'||fixture.SQLITE_PATH!==resolve('.data/goal-browser.sqlite')||fixture.APP_URL!=='http://127.0.0.1:3210')throw new Error('Prepare the isolated product browser fixtures first.');
const dev=process.argv.includes('--dev'),env={...process.env,...fixture,NODE_ENV:dev?'development':'production'};
// Exported production variables must never redirect this test server to production.
delete env.DATABASE_URL;delete env.PGOPTIONS;delete env.DATABASE_SSL;delete env.DATABASE_SSL_CA;
if(!dev){await cp('.next/static','.next/standalone/.next/static',{recursive:true,force:true});await cp('public','.next/standalone/public',{recursive:true,force:true});}
const args=dev?['node_modules/next/dist/bin/next','dev','--port','3210','--hostname','127.0.0.1']:['.next/standalone/server.js'];
const child=spawn(process.execPath,args,{env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??0;});
