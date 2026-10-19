"""Native Playwright acceptance for the fictional dinner experience.
Run against a seeded server: python3 tests/showcase-browser.py --base http://localhost:3101
Production uses --credentials <private JSON array> and never sends a test message.
"""
import argparse,json,time,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://localhost:3101');parser.add_argument('--credentials');parser.add_argument('--out',default='.data/showcase-browser');args=parser.parse_args()
base=args.base.rstrip('/');out=Path(args.out);out.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
accounts=json.loads(Path(args.credentials).read_text()) if args.credentials else [{'email':'guest@todaytable.local','password':'GuestDemo!2026','role':'PARTICIPANT'},{'email':'admin@todaytable.local','password':'AdminDemo!2026','role':'ADMIN'}]
participant=next(a for a in accounts if a['role']!='ADMIN');admins=[a for a in accounts if a['role']=='ADMIN']
def check(value,name):
 assert value,name
 checks.append(name)
def ready(page):
 page.wait_for_load_state('networkidle');expect(page.get_by_text('불러오는 중이에요…',exact=True)).to_have_count(0,timeout=30000)
def visit(page,path,width,name):
 page.set_viewport_size({'width':width,'height':900});r=page.goto(base+path,wait_until='networkidle');check(r.status==200,path+' HTTP');ready(page);expect(page.locator('h1').first).to_be_visible()
 check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),path+' fits '+str(width));page.screenshot(path=str(out/(name+'-'+str(width)+'.png')),full_page=True)
def login(ctx,account):
 r=ctx.request.post(base+'/api/auth/login',headers={'origin':base},data={'email':account['email'],'password':account['password']});check(r.status==200,'login '+account['email'])
def ctx_new(b):
 c=b.new_context(viewport={'width':390,'height':900},is_mobile=True);c.add_init_script("sessionStorage.setItem('todaytable-review-intro-v1','seen')")
 c.route('https://fonts.googleapis.com/**',lambda r:r.abort());c.route('https://fonts.gstatic.com/**',lambda r:r.abort());return c
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 try:
  c=ctx_new(b);page=c.new_page();page.set_default_navigation_timeout(120000);page.on('pageerror',lambda e:errors.append(str(e)))
  check(c.request.get(base+'/api/journey').status==401,'anonymous journey denied');discover=c.request.get(base+'/api/discover').json();check(discover['sourceRows']==294,'public discovery uses all source rows');check(len(discover['events'])>0,'open dinners exist')
  for width in [390,1440]:visit(page,'/',width,'public')
  login(c,participant);journey=c.request.get(base+'/api/journey').json();check(len(journey['upcoming'])>=1 and len(journey['history'])>=1 and journey['waitingCount']>=1,'review account has all three states');check(c.request.get(base+'/api/admin/events').status==403,'participant admin denied');check(c.request.get(base+'/api/push/config').json()['configured']==False,'external push disabled')
  future=journey['upcoming'][0]['table_id'];past=journey['history'][0]['table_id']
  for width in [360,390,430,1440]:
   for path,name in [('/','home'),('/applications','upcoming'),('/applications?view=pending','pending'),('/applications?view=past','past'),('/chats','chats'),('/profile','my'),('/apply','apply'),('/tables/'+future,'guide'),('/tables/'+future+'/chat','chat')]:visit(page,path,width,name)
  visit(page,'/applications',390,'tabs-start');page.get_by_role('navigation',name='만남 상태').get_by_role('link',name='신청 중').click();page.wait_for_url('**/applications?view=pending');ready(page);check('view=pending' in page.url,'pending tab URL');expect(page.locator('.pending-meeting-card').first).to_be_visible();page.reload(wait_until='networkidle');ready(page);expect(page.locator('.pending-meeting-card').first).to_be_visible();page.go_back(wait_until='networkidle');ready(page);expect(page.locator('.meet-card').first).to_be_visible();checks.append('tab reload and browser back')
  visit(page,'/tables/'+future+'/chat',390,'chat-functional');expect(page.get_by_role('textbox',name='메시지',exact=True)).to_be_visible()
  if not args.credentials:
   text='곧 식탁에서 뵐게요. 반갑습니다!';page.get_by_role('textbox',name='메시지',exact=True).fill(text);page.get_by_role('button',name='메시지 보내기',exact=True).click();expect(page.locator('.chat-message.own').get_by_text(text,exact=True)).to_be_visible();checks.append('send message renders own bubble')
  visit(page,'/tables/'+past+'/chat',390,'archived-chat');expect(page.get_by_role('textbox',name='메시지',exact=True)).to_have_count(0);check(c.request.get(base+'/api/tables/'+past+'/messages').json()['can_post']==False,'past chat archived')
  c.request.post(base+'/api/auth/logout',headers={'origin':base},max_redirects=0);c.close()
  for n,account in enumerate(admins):
   c=ctx_new(b);login(c,account);analytics=c.request.get(base+'/api/admin/analytics');check(analytics.status==200,'admin analytics '+str(n));data=analytics.json();check(data['dataMode']=='demo' and data['showcase']['sourceRows']==294,'admin active fictional cohort '+str(n))
   source=c.request.get(base+'/api/admin/source-data?pageSize=50').json();check(source['total']==294,'source count '+str(n));rows=source['rows']
   for number in range(2,7):rows+=c.request.get(base+'/api/admin/source-data?pageSize=50&page='+str(number)).json()['rows']
   check(len(rows)==294 and all(row.get('conversion',{}).get('showcase') for row in rows),'all source links '+str(n))
   if n==0:
    page=c.new_page();page.set_default_navigation_timeout(120000);page.on('pageerror',lambda e:errors.append(str(e)))
    for width in [360,1440]:
     for path,name in [('/admin','admin-overview'),('/admin/applications','admin-pending'),('/admin/matching/review','admin-upcoming'),('/admin/matches/past','admin-past'),('/admin/bookings','admin-bookings'),('/admin/inbox','admin-inbox'),('/admin/source-data','admin-source')]:visit(page,path,width,name)
    workspace=c.request.get(base+'/api/admin/workspace?view=matched').json();tables=workspace.get('tables',[]);unrelated=next((t['id'] for t in tables if t['id'] not in [future,past]),None)
    if unrelated:
     stranger=ctx_new(b);login(stranger,participant);check(stranger.request.get(base+'/api/tables/'+unrelated+'/messages').status==404,'other room membership denied');stranger.request.post(base+'/api/auth/logout',headers={'origin':base},max_redirects=0);stranger.close()
   c.request.post(base+'/api/auth/logout',headers={'origin':base},max_redirects=0);c.close()
  check(not errors,'no browser runtime errors');result={'passed':True,'checks':checks,'errors':errors,'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())};(out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({'passed':True,'checks':len(checks),'screenshots':len(list(out.glob('*.png')))},ensure_ascii=False))
 finally:b.close()
