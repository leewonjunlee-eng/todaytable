"""Check the final signup grouping, price layout, and skip navigation without payment."""
import argparse,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
expect.set_options(timeout=30000)
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://localhost:3101');parser.add_argument('--credentials');parser.add_argument('--preview-css');parser.add_argument('--out',default='.data/showcase-reviewed-browser');a=parser.parse_args();base=a.base.rstrip('/');out=Path(a.out);out.mkdir(parents=True,exist_ok=True);checks=[]
accounts=json.loads(Path(a.credentials).read_text()) if a.credentials else [{'email':'guest@todaytable.local','password':'GuestDemo!2026','role':'PARTICIPANT'}];user=next(u for u in accounts if u['role']!='ADMIN')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'),args=['--no-sandbox']);ctx=b.new_context(viewport={'width':390,'height':844},is_mobile=True);ctx.add_init_script("sessionStorage.setItem('todaytable-review-intro-v1','seen')");ctx.route('https://fonts.googleapis.com/**',lambda r:r.abort());ctx.route('https://fonts.gstatic.com/**',lambda r:r.abort())
 try:
  page=ctx.new_page();page.set_default_navigation_timeout(120000)
  for path in ['/login','/signup','/privacy']:
   page.goto(base+path,wait_until='networkidle');assert page.locator('#main-content').count()==1;checks.append('skip target '+path)
  assert ctx.request.post(base+'/api/auth/login',headers={'origin':base},data={'email':user['email'],'password':user['password']}).status==200
  evening=next(e for e in ctx.request.get(base+'/api/discover').json()['events'] if e['area']=='홍대/합정');page.goto(base+'/apply?day='+evening['day']+'&area='+evening['area'],wait_until='networkidle');button=page.get_by_role('button',name='다음 · 참가권 확인',exact=True);expect(button).to_be_enabled();expect(page.locator('form.form-stack > div.form-stack .notice')).to_have_count(1);checks.append('same date and area shown once');page.screenshot(path=str(out/'apply-grouped-390.png'),full_page=True);button.click();expect(page.get_by_role('heading',name='참가권 확인',exact=True)).to_be_visible()
  if a.preview_css:page.add_style_tag(content=Path(a.preview_css).read_text())
  for width in [360,390,430,1440]:
   page.set_viewport_size({'width':width,'height':900})
   for option in page.locator('.pass-option').all():
    radio=option.locator('input').bounding_box();price=option.locator('strong').bounding_box();page.screenshot(path=str(out/('price-diagnostic-'+str(width)+'.png')),full_page=True);assert radio and price and radio['x']+radio['width']+8<=price['x'],json.dumps({'width':width,'radio':radio,'price':price});checks.append('price clear '+str(width))
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.screenshot(path=str(out/('pass-prices-'+str(width)+'.png')),full_page=True)
  page.get_by_text('결제 처리 결과 선택',exact=True).click();expect(page.get_by_label('처리 결과',exact=True)).to_be_visible();checks.append('checkout outcome has accessible label');page.get_by_label('처리 결과',exact=True).select_option('FAILED');checks.append('outcome selectable without submitting')
  page.set_viewport_size({'width':390,'height':844});page.goto(base+'/applications?view=pending',wait_until='networkidle');expect(page.locator('.pending-meeting-card').first).to_be_visible();page.keyboard.press('Tab');assert page.evaluate("document.activeElement.classList.contains('skip-link')");checks.append('keyboard skip link');page.keyboard.press('Enter');assert page.locator('#main-content').count()==1;checks.append('skip target in journey')
  ctx.request.post(base+'/api/auth/logout',headers={'origin':base},max_redirects=0);(out/'results.json').write_text(json.dumps({'passed':True,'checks':checks},ensure_ascii=False,indent=2));print(json.dumps({'passed':True,'checks':len(checks)}))
 finally:
  try:ctx.request.post(base+'/api/auth/logout',headers={'origin':base},max_redirects=0)
  finally:b.close()
