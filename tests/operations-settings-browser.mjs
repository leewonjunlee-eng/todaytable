import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const base=process.env.OPERATOR_BROWSER_BASE??'http://127.0.0.1:3326';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Use an isolated local server.');
const session=JSON.parse(await readFile('.data/admin-browser-session.json','utf8')),out='.data/completion-settings-browser',checks=[],errors=[];
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const width of [360,1440]){
  const ctx=await browser.newContext({viewport:{width,height:900}});await ctx.addInitScript(()=>sessionStorage.setItem('todaytable-review-intro-v1','seen'));await ctx.addCookies([{name:'todaytable_session',value:session.token,url:base,httpOnly:true,sameSite:'Lax'}]);const p=await ctx.newPage();p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));
  const audit=async name=>{assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');await p.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true});checks.push(`${name} ${width}`);};
  await p.goto(base+'/admin/settings');await p.getByRole('heading',{name:'회차 등록',exact:true}).waitFor();
  const form=p.locator('form').last(),day=new Date(Date.now()+(25+Number(width===1440))*86400000).toISOString().slice(0,10);
  await form.getByLabel('이름',{exact:true}).fill(`검증 모집 ${width}`);await form.getByLabel('시작 (한국 시간)',{exact:true}).fill(day+'T19:30');await form.getByLabel('종료 (한국 시간)',{exact:true}).fill(day+'T21:30');await form.getByLabel('신청·매칭 마감',{exact:true}).fill(day+'T12:00');
  await form.getByRole('button',{name:'저장',exact:true}).click();await p.getByText('회차를 저장했어요.',{exact:true}).waitFor();await audit('recruitment-created');
  const events=await(await ctx.request.get(base+'/api/admin/events')).json(),event=events.find(e=>e.title===`검증 모집 ${width}`);assert.ok(event);
  const edit={id:event.id,version:event.version,title:event.title,startsAt:event.starts_at,endsAt:event.ends_at,deadline:event.application_deadline,area:event.area,capacity:event.capacity,price:8000,status:'CLOSED'};
  const headers={origin:base};assert.equal((await ctx.request.patch(base+'/api/admin/events',{headers,data:{...edit,preview:true}})).status(),200);assert.equal((await ctx.request.patch(base+'/api/admin/events',{headers,data:edit})).status(),200);assert.equal((await ctx.request.patch(base+'/api/admin/events',{headers,data:edit})).status(),409);checks.push(`event preview close and stale version ${width}`);
  await p.getByRole('button',{name:'식당 영업·음식 확인',exact:true}).click();await p.getByRole('heading',{name:'영업·휴무 등록',exact:true}).waitFor();await audit('venue-slots');
  await p.getByRole('button',{name:'자동 안내',exact:true}).click();await p.getByRole('heading',{name:'자동 안내 문구',exact:true}).waitFor();await p.getByLabel('안내 종류').selectOption('REFUND_COMPLETED');await p.getByRole('button',{name:'미리보기',exact:true}).click();await p.getByText(/\[amount 예시\]원/).waitFor();await p.getByRole('button',{name:'새 버전 발행',exact:true}).click();await p.getByRole('button',{name:/버전 .* 불러오기/}).first().waitFor();await audit('template-preview-publish');
  await p.getByRole('button',{name:'개인정보 삭제',exact:true}).click();await p.getByText(/진행 중인 참가·환불·문의·안전 신고/).waitFor();await audit('deletion-workspace');
  await ctx.close();
 }
 assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{await browser.close();}
