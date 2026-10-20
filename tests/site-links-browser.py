import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':390,'height':844})
    ctx.add_init_script("sessionStorage.setItem('todaytable-review-intro-v1','seen')")
    errors=[]
    page=ctx.new_page()
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:3337/admin')
    page.wait_for_load_state('networkidle')
    expect(page).to_have_url('http://localhost:3338/admin/login')
    expect(page.get_by_role('heading',name='운영자 로그인')).to_be_visible()
    expect(page.get_by_role('link',name='회원가입하고 취향 알아보기')).to_have_count(0)
    page.get_by_label('아이디').fill('invalid@todaytable')
    page.get_by_label('비밀번호').fill('wrong-password')
    page.get_by_role('button',name='로그인').click()
    expect(page.locator('.form-error')).to_contain_text('아이디 또는 비밀번호')
    page.goto('http://127.0.0.1:3337/login')
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('link',name='회원가입하고 취향 알아보기')).to_be_visible()
    token=json.loads(Path('.data/admin-browser-session.json').read_text())['token']
    ctx.add_cookies([{'name':'todaytable_session','value':token,'url':'http://localhost:3338'}])
    page.goto('http://localhost:3338/')
    page.wait_for_load_state('networkidle')
    expect(page).to_have_url('http://localhost:3338/admin')
    page.set_viewport_size({'width':1440,'height':1000})
    expect(page.get_by_role('link',name='참가자 화면 보기')).to_have_attribute('href','http://127.0.0.1:3337')
    ctx.add_cookies([{'name':'todaytable_session','value':token,'url':'http://127.0.0.1:3337'}])
    page.get_by_role('link',name='참가자 화면 보기').click()
    page.wait_for_load_state('networkidle')
    expect(page).to_have_url('http://127.0.0.1:3337/')
    expect(page.get_by_role('navigation',name='운영 메뉴',exact=True)).to_have_count(0)
    page.goto('http://localhost:3338/admin')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button',name='로그아웃').click()
    expect(page).to_have_url('http://localhost:3338/admin/login')
    assert not errors,errors
    print('PASS: host redirects, separate login forms, failed login, operator home, participant home with admin session, cross-site link, operator logout; JS errors 0')
    browser.close()
