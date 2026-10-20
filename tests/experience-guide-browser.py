"""Local synthetic fixture only. No production mutations or published credentials."""
import argparse,json
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser()
parser.add_argument('--base',default='http://127.0.0.1:3340')
parser.add_argument('--sessions',default='.data/final-guide/screenshots.json')
parser.add_argument('--section',choices=['all','guide','journeys','participant','operator'],default='all')
parser.add_argument('--widths',nargs='+',type=int,default=[360,390,430,1440])
parser.add_argument('--out',default='.data/final-guide/browser')
a=parser.parse_args()
assert urlparse(a.base).hostname in ['127.0.0.1','localhost'],'Local isolated fixture required'
base=a.base.rstrip('/');out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
sessions=json.loads(Path(a.sessions).read_text());checks=[];errors=[]
def checked(label):checks.append(label);print('PASS',label,flush=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    def context(role=None,width=390):
        ctx=browser.new_context(viewport={'width':width,'height':900},reduced_motion='reduce')
        ctx.on('page',lambda page:page.on('pageerror',lambda e:errors.append(str(e))))
        if role:ctx.add_cookies([{'name':'todaytable_session','value':sessions[role]['token'],'url':base}])
        return ctx
    def visit(page,path):
        response=page.goto(base+path);page.wait_for_load_state('networkidle');return response
    def no_overflow(page):assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),page.url
    if a.section in ['all','guide']:
        ctx=context();page=ctx.new_page();visit(page,'/')
        dialog=page.get_by_role('dialog');expect(dialog).to_be_visible();no_overflow(page)
        focused=set()
        for _ in range(6):
            page.keyboard.press('Tab');focused.add(page.evaluate('document.activeElement.textContent.trim()'))
        assert any('참가자로' in item for item in focused) and any('운영자로' in item for item in focused),focused
        page.screenshot(path=str(out/'first-visit-390.png'),full_page=True)
        dialog.get_by_role('link',name='참가자로 둘러보기').click();expect(page).to_have_url(base+'/guide?role=participant');expect(page.get_by_role('dialog')).to_have_count(0)
        checked('first visit role choice, keyboard choices, close before navigation')
        another=ctx.new_page();visit(another,'/');expect(another.get_by_role('dialog')).to_have_count(0);another.close()
        checked('dismissal persists in another tab')
        for width in a.widths:
            page.set_viewport_size({'width':width,'height':900})
            for role in ['participant','operator']:
                for step in range(1,5):
                    visit(page,f'/guide?role={role}&step={step}')
                    expect(page.locator('.guide-step-list button[aria-current="step"]')).to_have_count(1)
                    expect(page.locator('.guide-stage h2')).not_to_be_empty()
                    image=page.locator('.guide-screen img');image.scroll_into_view_if_needed()
                    assert image.evaluate('(img)=>img.complete&&img.naturalWidth>0')
                    no_overflow(page)
                    if step==1 and width in [360,1440]:
                        page.evaluate('document.activeElement.blur()');page.screenshot(path=str(out/f'guide-{role}-{width}.png'),full_page=True)
            checked(f'{width}px: both guides, all eight screenshots, query state and no overflow')
        visit(page,'/guide?role=operator&step=1');page.get_by_role('button',name='다음 단계').click();expect(page).to_have_url(base+'/guide?role=operator&step=2')
        page.get_by_role('button',name='이전 단계').click();expect(page).to_have_url(base+'/guide?role=operator&step=1')
        visit(page,'/guide?role=invalid&step=99');expect(page.get_by_role('button',name='참가자로 둘러보기')).to_have_attribute('aria-pressed','true');expect(page.locator('.guide-step-count')).to_contain_text('1 / 4')
        checked('next/previous buttons and invalid guide parameters')
        for path in ['/login','/admin/login','/privacy']:
            visit(page,path);expect(page.get_by_role('dialog')).to_have_count(0)
        response=visit(page,'/this-page-does-not-exist');assert response.status==404;expect(page.get_by_role('heading',name='잠시, 길이 달라졌네요.')).to_be_visible()
        checked('deep links have no modal and missing page offers recovery')
        ctx.close()
        fresh=context();freshpage=fresh.new_page();visit(freshpage,'/');freshpage.keyboard.press('Escape');expect(freshpage.get_by_role('dialog')).to_have_count(0);freshpage.reload();expect(freshpage.get_by_role('dialog')).to_have_count(0);fresh.close()
        checked('Escape closes and remembers first visit')
    if a.section in ['all','journeys','participant']:
        login=context();page=login.new_page();destination='/apply?day=2026-11-05&area=%EA%B0%95%EB%82%A8%2F%EC%8B%A0%EB%85%BC%ED%98%84'
        visit(page,destination);assert parse_qs(urlparse(page.url).query)['next'][0]==destination
        page.get_by_label('아이디',exact=True).fill(sessions['upcoming']['email']);page.get_by_label('비밀번호',exact=True).fill(sessions['upcoming']['password']);page.get_by_role('button',name='로그인',exact=False).click()
        page.wait_for_url(base+destination);page.wait_for_load_state('networkidle');expect(page.get_by_role('heading',name='가능한 날과 지역')).to_be_visible();login.close()
        checked('login preserves chosen date/area and returns to application')
        user=context('upcoming');page=user.new_page();visit(page,'/tables/'+sessions['upcoming']['table_id']+'#safety-request');expect(page.locator('#safety-request')).to_have_attribute('open','');expect(page.locator('#check-in-help')).not_to_be_empty()
        def before_checkin(route):
            data=route.fetch().json();data['attendance']={'status':'EXPECTED','can_check_in':False};data['event_ended']=False;route.fulfill(json=data)
        user.route('**/api/tables/'+sessions['upcoming']['table_id'],before_checkin);visit(page,'/tables/'+sessions['upcoming']['table_id']);expect(page.locator('#check-in-help')).to_contain_text('30분 전');user.unroute('**/api/tables/'+sessions['upcoming']['table_id'])
        checked('safety link opens form and disabled check-in explains timing')
        def no_upcoming(route):
            data=route.fetch().json();data['upcoming']=[];data['waitingCount']=1;route.fulfill(json=data)
        user.route('**/api/journey',no_upcoming);visit(page,'/applications?view=upcoming');expect(page.get_by_role('link',name='신청 현황 확인')).to_have_attribute('href','/applications?view=pending');user.unroute('**/api/journey')
        checked('waiting empty state points to application status')
        user.route('**/api/journey',lambda r:r.fulfill(status=401,json={'error':'로그인이 필요합니다.'}));visit(page,'/applications');expect(page.get_by_role('link',name='로그인하고 계속하기')).to_be_visible();user.unroute('**/api/journey')
        user.route('**/api/tables/*',lambda r:r.fulfill(status=404,json={'error':'식탁을 찾을 수 없어요.'}));visit(page,'/tables/missing');expect(page.get_by_role('link',name='내 만남으로',exact=True)).to_be_visible();user.unroute('**/api/tables/*')
        checked('401 and 404 provide useful navigation')
        for path in ['/','/applications?view=pending','/applications?view=past','/chats','/profile','/payments','/notifications','/support','/account/data','/restaurants']:
            response=visit(page,path);assert response.status<400,(path,response.status);expect(page.locator('main h1')).not_to_be_empty();expect(page.locator('.error-state')).to_have_count(0);no_overflow(page)
        checked('participant pages mobile walkthrough')
        user.close()
    if a.section in ['all','journeys','operator']:
        op=context('operator');page=op.new_page();visit(page,'/admin/inbox#participant-reports');expect(page.locator('#participant-reports')).to_have_attribute('open','')
        visit(page,'/admin');page.get_by_role('navigation',name='모바일 운영 메뉴').get_by_text('운영 메뉴 · 운영 현황',exact=True).click()
        menu=page.get_by_role('navigation',name='모바일 운영 메뉴');expect(menu.get_by_role('link',name='이용 가이드')).to_be_visible();expect(menu.get_by_role('link',name='참가자 화면 보기')).to_be_visible();expect(menu.get_by_role('button',name='로그아웃')).to_be_visible()
        checked('mobile operator guide/persona switch/logout and report anchor')
        for path in ['/admin','/admin/applications','/admin/matching/review','/admin/matches/past','/admin/bookings','/admin/inbox','/admin/exceptions','/admin/events','/admin/team','/admin/settings']:
            response=visit(page,path);assert response.status<400,(path,response.status);expect(page.locator('main h1')).not_to_be_empty();expect(page.locator('.error-state')).to_have_count(0);no_overflow(page)
        checked('operator pages mobile walkthrough')
        page.set_viewport_size({'width':1440,'height':1000})
        for path in ['/admin','/admin/bookings','/admin/exceptions']:
            visit(page,path);no_overflow(page);expect(page.get_by_role('navigation',name='운영 메뉴',exact=True)).to_be_visible()
        checked('operator desktop navigation includes exception screen')
        op.close()
    browser.close()
assert not errors,errors
(out/('results.json' if a.section=='all' else f'results-{a.section}-{"-".join(map(str,a.widths))}.json')).write_text(json.dumps({'checks':checks,'javascriptErrors':errors},ensure_ascii=False,indent=2))
print(f'{len(checks)} groups passed; JavaScript errors 0',flush=True)
