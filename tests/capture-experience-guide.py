"""Capture synthetic local screens only; run prepare-experience-guide.ts first."""
import json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse
from urllib.parse import urlparse
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:3340');parser.add_argument('--only');a=parser.parse_args()
assert urlparse(a.base).hostname in ['localhost','127.0.0.1'],'Local fixture required'
base=a.base.rstrip('/')
s=json.loads(Path('.data/final-guide/screenshots.json').read_text())
out=Path('public/guide');out.mkdir(parents=True,exist_ok=True)
raw=Path('.data/guide-quality/raw');raw.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    for role,person,route in [
      ('participant-profile','upcoming','/profile/test'),
      ('participant-apply','upcoming','/apply'),
      ('participant-table','upcoming','/tables/'+s['upcoming']['table_id']),
      ('participant-feedback','past','/tables/'+s['past']['table_id']+'/feedback'),
      ('operator-applications','operator','/admin/applications'),
      ('operator-matching','operator','/admin/matching/review'),
      ('operator-bookings','operator','/admin/bookings'),
      ('operator-exceptions','operator','/admin/exceptions')]:
        if a.only and role!=a.only:continue
        for width,height,scale,suffix in [(1240,880,2,'@2x'),(360,740,3,'-mobile-360@3x'),(390,740,3,'-mobile-390@3x'),(430,740,3,'-mobile-430@3x')]:
            ctx=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=scale)
            ctx.add_init_script("sessionStorage.setItem('todaytable-review-intro-v1','seen')")
            ctx.add_cookies([{'name':'todaytable_session','value':s[person]['token'],'url':base}])
            page=ctx.new_page();page.goto(base+route);page.wait_for_load_state('networkidle')
            page.locator('main').wait_for()
            assert '/login' not in page.url,page.url
            if role=='participant-profile':
                page.get_by_role('button',name='다음',exact=False).click()
                page.get_by_role('button',name='다음',exact=False).click()
                page.get_by_role('heading',name='처음 만난 식탁에서 나는?').wait_for()
            if role=='operator-bookings':
                page.get_by_role('button',name='예약 정보 관리').first.click()
                page.locator('.booking-card').first.scroll_into_view_if_needed()
                page.evaluate("window.scrollTo(0,document.querySelector('.booking-card').getBoundingClientRect().top+window.scrollY-85)")
            page.evaluate('document.fonts.ready')
            page.evaluate('document.activeElement.blur()')
            original=raw/(role+suffix+'.png')
            page.screenshot(path=str(original),type='png',animations='disabled',caret='hide',scale='device')
            # Lossless encoding: preserve the rendered UI pixels rather than JPEG-compressing text.
            subprocess.run(['node','--input-type=module','-e',"import sharp from 'sharp'; await sharp(process.argv[1]).webp({lossless:true,effort:6}).toFile(process.argv[2]); const a=await sharp(process.argv[1]).ensureAlpha().raw().toBuffer(); const b=await sharp(process.argv[2]).ensureAlpha().raw().toBuffer(); if(!a.equals(b))throw Error('Screenshot pixels changed during encoding');",str(original),str(out/(role+suffix+'.webp'))],check=True)
            print(role, page.locator('h1').all_text_contents(),flush=True)
            ctx.close()
    browser.close()
