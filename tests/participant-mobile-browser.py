"""Participant phone design and usable controls, against a synthetic local fixture."""
import argparse,json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:3342');parser.add_argument('--section',choices=['screens','controls','scope'],default='screens');parser.add_argument('--widths',nargs='+',type=int,default=[360,390,430]);a=parser.parse_args()
assert urlparse(a.base).hostname in ['127.0.0.1','localhost'],'Use the local synthetic fixture'
base=a.base.rstrip('/');sessions=json.loads(Path('.data/final-guide/screenshots.json').read_text());out=Path('.data/mobile-design/browser');out.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox'])
 def context(person='upcoming',width=390):
  ctx=b.new_context(viewport={'width':width,'height':844},device_scale_factor=2,is_mobile=width<=700,has_touch=width<=700,reduced_motion='reduce');ctx.add_init_script("if(location.protocol==='http:'||location.protocol==='https:')sessionStorage.setItem('todaytable-review-intro-v1','seen')")
  if person:ctx.add_cookies([{'name':'todaytable_session','value':sessions[person]['token'],'url':base}])
  ctx.on('page',lambda pg:pg.on('pageerror',lambda err:errors.append(str(err))));return ctx
 def visit(pg,path):
  response=pg.goto(base+path);pg.wait_for_load_state('networkidle');assert response.status<400,(path,response.status);expect(pg.locator('.error-state')).to_have_count(0)
 def fits(pg):
  assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth'),pg.url
  assert pg.locator('main').bounding_box()['x']>=0
 def shot(pg,name):
  pg.evaluate('document.activeElement.blur();window.scrollTo(0,0)');pg.screenshot(path=str(out/(name+'.png')),full_page=True)
 if a.section=='screens':
  for width in a.widths:
   ctx=context(width=width);pg=ctx.new_page()
   for name,path in [('home','/'),('meetings','/applications'),('pending','/applications?view=pending'),('apply','/apply'),('profile','/profile'),('chats','/chats'),('chat','/tables/'+sessions['upcoming']['table_id']+'/chat'),('table','/tables/'+sessions['upcoming']['table_id']),('payments','/payments'),('notifications','/notifications')]:
    visit(pg,path);fits(pg);expect(pg.locator('main h1')).to_have_count(1)
    if width==390:shot(pg,name)
    checks.append(f'{width}px {name}')
   ctx.close()
   ctx=context(None,width);pg=ctx.new_page();visit(pg,'/');fits(pg);assert len(pg.locator('.evening-date:visible').all())>0;assert pg.locator('.evening-grid').evaluate('(el)=>getComputedStyle(el).gridTemplateColumns.split(" ").length')==1
   assert pg.locator('.discovery-hero-photo').bounding_box()['height']>=180
   if width==390:shot(pg,'home-public')
   ctx.close();checks.append(f'{width}px public date invitations');print(f'PASS {width}px: participant screens and public home',flush=True)
 if a.section=='controls':
  for width in a.widths:
   ctx=context(width=width);pg=ctx.new_page();visit(pg,'/');expect(pg.locator('.discovery-hero-returning .button')).to_have_attribute('href','/apply')
   assert pg.locator('.discovery-hero-returning .discovery-hero-photo').evaluate('(el)=>getComputedStyle(el).display')=='none'
   for link in pg.locator('.mobile-dock a').all():assert link.bounding_box()['height']>=44
   visit(pg,'/applications');pg.get_by_role('navigation',name='만남 상태').get_by_role('link',name='신청 중').click();pg.wait_for_url('**/applications?view=pending');pg.reload(wait_until='networkidle');fits(pg)
   visit(pg,'/apply');data=ctx.request.get(base+'/api/availability').json();event=data['events'][0];pg.locator('.availability-day').nth(data['days'].index(event['day'])).get_by_role('checkbox').check();pg.get_by_label(event['area'],exact=True).check();pg.get_by_role('button',name='다음 · 참가권 확인').click();expect(pg.get_by_role('heading',name='참가권 확인',exact=True)).to_be_visible();fits(pg)
   for option in pg.locator('.pass-option').all():
    radio=option.locator('input').bounding_box();label=option.locator('span').bounding_box();price=option.locator('strong').bounding_box()
    assert label['width']>0 and label['height']>0
    assert radio['x']+radio['width']<=label['x']+1,'Radio overlaps pass label'
    assert label['x']+label['width']<=price['x']+1 or label['y']+label['height']<=price['y']+1,'Pass label overlaps price'
   if width==390:shot(pg,'apply-payment')
   pg.get_by_label('3회 참가권',exact=False).check();expect(pg.get_by_role('button',name='15,000원 결제하고 신청하기')).to_be_visible()
   # Selection only. Never submit the payment or refund.
   visit(pg,'/tables/'+sessions['upcoming']['table_id']+'/chat');fits(pg);expect(pg.get_by_role('link',name='신고·차단')).to_be_visible();expect(pg.get_by_role('link',name='모임 안내')).to_be_visible();input=pg.get_by_label('메시지',exact=True);input.fill('모바일 화면 확인 중');expect(input).to_have_value('모바일 화면 확인 중');assert float(input.evaluate('(el)=>getComputedStyle(el).fontSize').replace('px',''))>=16
   pg.set_viewport_size({'width':width,'height':480});input.focus();input.scroll_into_view_if_needed();assert input.bounding_box()['y']+input.bounding_box()['height']<=480;fits(pg)
   ctx.close();checks.append(f'{width}px tabs, date/pass selection, touch targets, chat input');print(f'PASS {width}px: actual controls and short viewport',flush=True)
 if a.section=='scope':
  for width in [700,701,1120,1440]:
   ctx=context(None,width);pg=ctx.new_page();visit(pg,'/');fits(pg);columns=pg.locator('.evening-grid').evaluate('(el)=>getComputedStyle(el).gridTemplateColumns.split(" ").length');assert columns==(1 if width<=700 else 2 if width<=900 else 3),(width,columns);ctx.close();checks.append(f'{width}px responsive boundary')
  ctx=context('operator',390);pg=ctx.new_page()
  for path in ['/admin','/admin/matching/review','/admin/bookings','/admin/settings']:
   visit(pg,path);fits(pg);expect(pg.get_by_role('navigation',name='모바일 운영 메뉴')).to_be_visible();assert len(pg.locator('.participant-page').all())==0;checks.append(path+' operator layout')
  ctx.close();print('PASS tablet/desktop boundaries and operator isolation',flush=True)
 b.close()
assert not errors,errors
(out/(a.section+'-'+ '-'.join(map(str,a.widths))+'.json')).write_text(json.dumps({'checks':checks,'javascriptErrors':errors},ensure_ascii=False,indent=2));print(f'{len(checks)} checks passed; JavaScript errors 0',flush=True)
