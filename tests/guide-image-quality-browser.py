"""Verify crisp guide sources and original-image links at real phone pixel density."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:3340');parser.add_argument('--out',default='.data/guide-quality/browser');a=parser.parse_args()
base=a.base.rstrip('/');out=Path(a.out);out.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox'])
 for width,variant,scale in [(360,'-mobile-360@3x',3),(390,'-mobile-390@3x',3),(430,'-mobile-430@3x',3),(1440,'@2x',2)]:
  ctx=b.new_context(viewport={'width':width,'height':900},device_scale_factor=scale);pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(str(e)))
  for role in ['participant','operator']:
   for step in range(1,5):
    pg.goto(base+f'/guide?role={role}&step={step}');pg.wait_for_load_state('networkidle');img=pg.locator('.guide-screen img');img.scroll_into_view_if_needed()
    assert img.evaluate('(el)=>el.complete&&el.naturalWidth>0')
    source=img.evaluate('(el)=>el.currentSrc');assert source.endswith(variant+'.webp'),source
    assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
    if width<=700:
     assert abs(img.bounding_box()['width']-width)<1,'Phone capture must render at actual screen width'
    links=pg.locator('.guide-screen figcaption a:visible');expect(links).to_have_count(1);assert links.evaluate('(el)=>el.href')==source,'Original must match the displayed capture'
    response=ctx.request.get(source);assert response.status==200;assert response.headers['content-type'].startswith('image/webp')
    checks.append(f'{width}px DPR{scale} {role} step {step}')
    if step==1 and role=='participant':
     pg.evaluate('document.activeElement.blur()');img.screenshot(path=str(out/f'crisp-{width}-dpr{scale}.png'))
     with pg.expect_popup() as popup:links.click()
     original=popup.value;original.wait_for_load_state('load');assert original.url==source;original.close()
  ctx.close();print(f'PASS {width}px DPR{scale}: eight source selections, actual size, originals and no overflow',flush=True)
 b.close()
assert not errors,errors
(out/'results.json').write_text(json.dumps({'checks':checks,'javascriptErrors':errors},ensure_ascii=False,indent=2));print(f'{len(checks)} high-density cases passed; JavaScript errors 0',flush=True)
