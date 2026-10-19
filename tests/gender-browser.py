"""Validate round rosters, all allowed gender ratios, and the supplied-source mapping."""
import argparse,json,os,datetime,copy
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
expect.set_options(timeout=30000)
a=argparse.ArgumentParser();a.add_argument('--base',default='http://localhost:3102');a.add_argument('--credentials');a.add_argument('--out',default='.data/gender-browser');args=a.parse_args();base=args.base.rstrip('/');out=Path(args.out);out.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
accounts=json.loads(Path(args.credentials).read_text()) if args.credentials else [{'email':'admin@todaytable.local','password':'AdminDemo!2026','role':'ADMIN'},{'email':'guest@todaytable.local','password':'GuestDemo!2026','role':'PARTICIPANT'}]
admin=next(a for a in accounts if a['role']=='ADMIN');participant=next(a for a in accounts if a['role']!='ADMIN')
def check(value,name):
 assert value,name
 checks.append(name)
def ready(page):
 page.wait_for_load_state('networkidle');expect(page.get_by_text('불러오는 중이에요…',exact=True)).to_have_count(0)
def visit(page,path,width,name):
 page.set_viewport_size({'width':width,'height':900});check(page.goto(base+path,wait_until='networkidle').status==200,path+' HTTP');ready(page);check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),path+' fits '+str(width));page.screenshot(path=str(out/(name+'-'+str(width)+'.png')),full_page=True)
def login(c,user):check(c.request.post(base+'/api/auth/login',headers={'origin':base},data={'email':user['email'],'password':user['password']}).status==200,'login '+user['role'])
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'),args=['--no-sandbox']);c=b.new_context(viewport={'width':390,'height':900},is_mobile=True);c.add_init_script("sessionStorage.setItem('todaytable-review-intro-v1','seen')");c.route('https://fonts.googleapis.com/**',lambda r:r.abort());c.route('https://fonts.gstatic.com/**',lambda r:r.abort())
 try:
  login(c,admin);pending=c.request.get(base+'/api/admin/workspace?view=applications').json();tables=[]
  for state in ['matched','past']:tables+=c.request.get(base+'/api/admin/workspace?view='+state).json()['tables']
  allowed={(4,2,2),(5,2,3),(5,3,2),(6,2,4),(6,3,3),(6,4,2)};seen=set();profiles={a['user_id']:a['gender'] for a in pending['applications']}
  for table in tables:
   members=table['members'];m=sum(p['gender']=='MAN' for p in members);w=sum(p['gender']=='WOMAN' for p in members);seen.add((len(members),m,w));check((len(members),m,w) in allowed,'valid gender ratio '+table['id']);check(table['ageSpan']<=8,'age span '+table['id']);profiles.update({p['user_id']:p['gender'] for p in members})
  check(seen==allowed,'all six requested compositions represented')
  rows=[]
  for number in range(1,7):rows+=c.request.get(base+'/api/admin/source-data?pageSize=50&page='+str(number)).json()['rows']
  check(len(rows)==294 and len({r['sheet_row'] for r in rows})==294,'all 294 source rows preserved')
  for row in rows:
   expected='MAN' if row['fields']['gender'].startswith('남') else 'WOMAN';check(profiles.get(row['conversion']['user_id'])==expected,'original source gender '+str(row['sheet_row']))
  page=c.new_page();page.set_default_navigation_timeout(120000);page.on('pageerror',lambda e:errors.append(str(e)))
  for width in [360,390,430,1440]:
   visit(page,'/admin/applications',width,'pending')
   cards=page.locator('.deadline-card');check(cards.count()>1,'round cards present '+str(width));card=cards.first;area=card.locator('.tag').inner_text();stamp=card.locator('h3').inner_text()
   selected_ids={e['id'] for e in pending['events'] if e['area']==area and datetime.datetime.fromisoformat(e['starts_at'].replace('Z','+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y. %m. %d. %H:%M')==stamp}
   expected=sum(any(o['id'] in selected_ids for o in app['options']) for app in pending['applications']);page.get_by_label('참가자 검색').fill('존재하지않는참가자');expect(page.locator('tbody tr')).to_have_count(0);card.click();heading=page.locator('#round-participants h2');expect(heading).to_contain_text(area);expect(heading).to_be_in_viewport();expect(page.get_by_label('참가자 검색')).to_have_value('');expect(page.locator('tbody tr')).to_have_count(expected);check(page.evaluate("document.activeElement===document.querySelector('#round-participants h2')"),'roster heading focused '+str(width));check(card.get_attribute('aria-expanded')=='true','selected round expanded '+str(width));expect(page.get_by_role('columnheader',name='성별')).to_be_visible();page.screenshot(path=str(out/('roster-'+str(width)+'.png')),full_page=True);checks.append('correct roster and reset search '+str(width))
  for path,name in [('/admin/matching/review','upcoming'),('/admin/matches/past','past')]:visit(page,path,1440,name)
  # A single application with several internal event options counts as one person.
  bucket={}
  for e in pending['events']:bucket.setdefault((e['starts_at'],e['area']),[]).append(e)
  (stamp,area),same=next((k,v) for k,v in bucket.items() if len(v)>1);ids={e['id'] for e in same};mock=copy.deepcopy(pending);fake=copy.deepcopy(pending['applications'][0]);fake['id']='browser-only-multiple-options';fake['options']=[{'id':e['id'],'area':e['area'],'starts_at':e['starts_at'],'title':e['title']} for e in same];fake['payment_status']='PAID';fake['status']='SUBMITTED';mock['applications'].append(fake)
  for e in mock['events']:
   if e['id'] in ids:e['registrations']+=1;e['paid']+=1
  page.route('**/api/admin/workspace?view=applications',lambda r:r.fulfill(json=mock));visit(page,'/admin/applications',390,'unique-registrations')
  pretty=datetime.datetime.fromisoformat(stamp.replace('Z','+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y. %m. %d. %H:%M');target=next(card for card in page.locator('.deadline-card').all() if card.locator('.tag').inner_text()==area and card.locator('h3').inner_text()==pretty);unique=sum(any(o['id'] in ids for o in app['options']) for app in mock['applications']);check(int(target.locator('.deadline-numbers strong').first.inner_text())==unique,'multi-option application counted once');target.click();expect(page.locator('tbody tr')).to_have_count(unique);checks.append('multi-option roster counted once')
  c.request.post(base+'/api/auth/logout',headers={'origin':base},max_redirects=0);login(c,participant);journey=c.request.get(base+'/api/journey').json();check(len(journey['upcoming'])==1 and len(journey['history'])==1 and journey['waitingCount']>=1,'review account retains three states');check(c.request.get(base+'/api/admin/workspace?view=applications').status==403,'participant cannot read operator roster')
  for width in [390,1440]:
   for path,name in [('/','home'),('/applications','my-upcoming'),('/applications?view=pending','my-pending')]:visit(page,path,width,name)
  check(not errors,'no browser runtime errors');(out/'results.json').write_text(json.dumps({'passed':True,'checks':checks,'tables':len(tables),'compositions':sorted(seen),'errors':errors},ensure_ascii=False,indent=2));print(json.dumps({'passed':True,'checks':len(checks),'tables':len(tables),'compositions':sorted(seen)}))
 finally:
  try:c.request.post(base+'/api/auth/logout',headers={'origin':base},max_redirects=0)
  finally:b.close()
