"""PRD usability regressions. Local isolated operator fixture only; fault cases use API interception."""
import argparse, copy, json, os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:3326')
parser.add_argument('--out', default='.data/cross-review/browser')
a=parser.parse_args()
assert urlparse(a.base).hostname in ['127.0.0.1','localhost'], 'Use the isolated local fixture'
base=a.base.rstrip('/'); out=Path(a.out); out.mkdir(parents=True,exist_ok=True)
session=json.loads(Path('.data/admin-browser-session.json').read_text()); checks=[]; errors=[]

def passed(label):
    checks.append(label)
    print(label,flush=True)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'), headless=True,args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':390,'height':844})
    ctx.add_cookies([{'name':'todaytable_session','value':session['token'],'url':base}])
    ctx.route('https://fonts.googleapis.com/**',lambda r:r.abort())
    ctx.route('https://fonts.gstatic.com/**',lambda r:r.abort())
    ctx.add_init_script("sessionStorage.setItem('todaytable-review-intro-v1','seen')")
    page=ctx.new_page();page.set_default_timeout(20000)
    page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGE ERROR:',str(e),flush=True)))
    try:
        # Actual route rejects a partially unsupported selection before creating checkout.
        actual=ctx.request.get(base+'/api/availability').json()
        assert actual['events'], 'fixture requires published recruitment'
        event=actual['events'][0]
        response=ctx.request.post(base+'/api/payments/checkout',headers={'origin':base},data={'dates':[event['day'],'2099-12-31'],'areas':[event['area']],'pass':'SINGLE','requestKey':'11111111-1111-4111-8111-111111111111'})
        assert response.status==400
        passed('real checkout API rejects partially unsupported selection')
        events=[dict(event,id='one',day='2099-11-01',area='홍대/합정'),dict(event,id='two',day='2099-11-02',area='강남/역삼')]
        availability={'events':events,'days':[e['day'] for e in events],'areas':[e['area'] for e in events]}
        page.route('**/api/availability',lambda r:r.fulfill(json=availability) if r.request.method=='GET' else r.fulfill(json={'id':'saved','payment':'SUCCEEDED'}))
        page.route('**/api/payments/checkout',lambda r:r.fulfill(body='null',content_type='application/json'))
        page.goto(base+'/apply',wait_until='networkidle')
        page.locator('.availability-day').first.get_by_role('checkbox').check()
        page.get_by_label('강남/역삼',exact=True).check()
        expect(page.get_by_role('button',name='다음 · 참가권 확인',exact=True)).to_be_disabled()
        expect(page.get_by_role('status').filter(has_text='모집 중인 회차가 없어요')).to_be_visible()
        passed('unsupported date/area is explained before checkout')
        page.get_by_label('강남/역삼',exact=True).uncheck();page.get_by_label('홍대/합정',exact=True).check()
        page.get_by_role('button',name='다음 · 참가권 확인',exact=True).click()
        expect(page.get_by_role('heading',name='참가권 확인',exact=True)).to_be_visible()
        passed('valid selection reaches checkout')
        for width in [360,390,430,1440]:
            page.set_viewport_size({'width':width,'height':900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            page.screenshot(path=str(out/f'checkout-{width}.png'),full_page=True)
        passed('checkout has no overflow at four widths')
        # Expired checkout on a long-open tab must be replaced before registration.
        page.unroute('**/api/payments/checkout');checkout_posts=[]
        def checkout(r):
            if r.request.method=='GET':
                r.fulfill(json={'id':'expired','expiresAt':'2020-01-01T00:00:00Z','dates':['2099-11-01'],'areas':['홍대/합정'],'pass':'SINGLE'})
            else:
                checkout_posts.append(r.request.post_data_json)
                r.fulfill(json={'id':'fresh','expiresAt':'2099-12-01T00:00:00Z','dates':['2099-11-01'],'areas':['홍대/합정'],'pass':'SINGLE'})
        page.route('**/api/payments/checkout',checkout)
        page.goto(base+'/apply',wait_until='networkidle')
        with page.expect_request(lambda r:r.url==base+'/api/availability' and r.method=='POST') as submitted:
            page.get_by_role('button',name='8,000원 결제하고 신청하기',exact=True).click()
        assert submitted.value.post_data_json['checkoutId']=='fresh' and len(checkout_posts)==1
        expect(page.get_by_role('heading',name='결제와 신청이 완료됐어요')).to_be_visible()
        passed('expired checkout replaced before submission (intercepted payment)')
        page.unroute('**/api/availability');page.unroute('**/api/payments/checkout')
        # Render a controlled two-table cancellation case using real detail shape.
        detail=ctx.request.get(base+'/api/admin/tables/'+session['upcomingTable']).json()
        first=copy.deepcopy(detail['table']);first['members']=first['members'][:3];first['member_count']=3
        second=copy.deepcopy(first);second['id']='22222222-2222-4222-8222-222222222222';second['table_number']=99
        for i,m in enumerate(second['members']):
            m['application_id']=f'33333333-3333-4333-8333-{i:012d}';m['user_id']=f'44444444-4444-4444-8444-{i:012d}';m['display_name']=f'병합 멤버 {i}'
        detail['table']=first
        page.route('**/api/admin/tables/'+session['upcomingTable'],lambda r:r.fulfill(json=detail))
        page.route('**/api/admin/workspace?view=matched',lambda r:r.fulfill(json={'tables':[second]}))
        page.route('**/api/admin/reconfigure',lambda r:r.fulfill(status=409,json={'error':'검증용 제출: 실제 식탁은 변경하지 않았어요.'}))
        page.goto(base+'/admin/tables/'+session['upcomingTable'],wait_until='networkidle')
        page.get_by_text('예외 상황에서 식탁 긴급 재구성',exact=True).click()
        form=page.locator('details').filter(has=page.get_by_text('함께 재구성할 식탁 · 최대 4개',exact=True))
        form.get_by_label('식탁 99',exact=False).check()
        form.get_by_label('새 식탁 수',exact=False).select_option('1')
        expect(form.get_by_label('새 식탁 수',exact=False)).to_have_value('1')
        expect(form.get_by_text('새 식탁 1: 6명',exact=True)).to_be_visible()
        form.get_by_label('조정 사유',exact=True).fill('취소 후 두 식탁을 병합합니다.')
        form.get_by_label('새 식당 배정과 단체방 안내를 참가자에게 전달하는 것을 확인했습니다.').check()
        if form.get_by_label('멤버의 음식·알레르기 요청을 다시 확인했습니다.').count():
            form.get_by_label('멤버의 음식·알레르기 요청을 다시 확인했습니다.').check()
        with page.expect_request('**/api/admin/reconfigure') as submitted:
            form.get_by_role('button',name='필수 조건 검증 후 재구성').click()
        payload=submitted.value.post_data_json
        assert len(payload['groups'])==1 and len(set(payload['groups'][0]))==6
        passed('two three-person tables submit one six-person group without dropping members (intercepted)')
        # Concurrent booking edit must preserve draft and retain optimistic version checking.
        bookings=ctx.request.get(base+'/api/admin/bookings').json();booking=bookings['tables'][0]
        booking['booking_version']=1
        page.route('**/api/admin/bookings',lambda r:r.fulfill(json=bookings))
        page.clock.install()
        page.goto(base+'/admin/bookings',wait_until='networkidle')
        page.get_by_role('button',name='예약 정보 관리',exact=True).first.click()
        editor=page.locator('.booking-editor').first
        editor.get_by_role('textbox',name='예약 메모',exact=True).fill('내가 작성 중인 예약 메모')
        booking['booking_version']=2;booking['booking_note']='동료가 저장한 최신 메모'
        page.clock.fast_forward(30001)
        expect(editor.get_by_text('다른 운영자가 예약을 변경했어요.',exact=False)).to_be_visible()
        expect(editor.get_by_role('textbox',name='예약 메모',exact=True)).to_have_value('내가 작성 중인 예약 메모')
        expect(editor.get_by_role('button',name='예약 내용 저장')).to_be_disabled()
        passed('polling preserves booking draft and blocks stale overwrite')
        page.once('dialog',lambda d:d.accept());editor.get_by_role('button',name='최신 예약 불러오기').click()
        expect(editor.get_by_role('textbox',name='예약 메모',exact=True)).to_have_value('동료가 저장한 최신 메모')
        expect(editor.get_by_role('button',name='예약 내용 저장')).to_be_enabled()
        passed('operator explicitly reloads latest booking after confirmation')
        page.clock.resume()
        # Preference failures must be announced and preserve server-confirmed state.
        attempts=[]
        def alerts(r):
            if r.request.method=='GET':r.fulfill(json={'enabled':True})
            else:
                attempts.append(1)
                r.fulfill(status=500 if len(attempts)==1 else 200,json={'error':'설정을 저장하지 못했어요.'} if len(attempts)==1 else {'enabled':False})
        page.route('**/api/account/alerts',alerts)
        page.goto(base+'/account/data',wait_until='networkidle')
        toggle=page.get_by_label('이전에 선택한 지역·요일의 새 모집을 알려주세요',exact=False)
        expect(toggle).to_be_checked();toggle.click()
        expect(page.locator('main').get_by_role('alert')).to_contain_text('설정을 저장하지 못했어요.')
        expect(toggle).to_be_checked();toggle.click()
        expect(toggle).not_to_be_checked();expect(page.get_by_role('status')).to_contain_text('새 모집 알림을 껐어요.')
        passed('notification failure announced, prior state preserved, retry succeeds')
        # Newly restored action paths use a controlled participant journey.
        participant_ctx=browser.new_context(viewport={'width':390,'height':844})
        participant_ctx.add_init_script("sessionStorage.setItem('todaytable-review-intro-v1','seen')")
        participant_ctx.route('https://fonts.googleapis.com/**',lambda r:r.abort())
        participant_ctx.route('https://fonts.gstatic.com/**',lambda r:r.abort())
        registered=participant_ctx.request.post(base+'/api/auth/register',headers={'origin':base},data={'email':f'cross-{uuid4()}@todaytable','password':str(uuid4())})
        assert registered.status==201
        page=participant_ctx.new_page();page.set_default_timeout(20000)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.clock.install()
        journey={'applications':[{'id':'55555555-5555-4555-8555-555555555555','status':'SUBMITTED','matching_status':'ALTERNATIVE_OFFERED','payment_status':'REFUND_FAILED','pass_choice':'SINGLE','amount_cents':8000,'events':[dict(event,starts_at='2099-11-01T10:30:00Z')],'resolution':None}], 'upcoming':[],'history':[],'alternativeCount':1,'profileComplete':True}
        page.route('**/api/journey',lambda r:r.fulfill(json=journey))
        page.goto(base+'/',wait_until='networkidle')
        expect(page.get_by_role('link',name='다음 일정을 선택해 주세요',exact=False)).to_be_visible()
        expect(page.get_by_role('link',name='결제·환불 상태를 확인해 주세요',exact=False)).to_be_visible()
        passed('home surfaces alternative selection and refund failures')
        application=journey['applications'][0]
        application['resolution']={'selected_choice':'REFUND','status':'FAILED'}
        page.goto(base+'/applications?view=pending',wait_until='networkidle')
        expect(page.get_by_text('환불 처리 확인',exact=True)).to_be_visible()
        expect(page.get_by_role('link',name='환불 상태 보기',exact=False)).to_have_attribute('href','/payments')
        expect(page.get_by_text('다음 일정 선택',exact=True)).to_have_count(0)
        passed('refund-selected pending card leads to payment status without offering another compensation')
        application['resolution']=None;application['matching_status']='WAITING';application['payment_status']='PAID'
        cancel_posts=[]
        def cancel(r):
            cancel_posts.append(r.request.post_data_json);application['status']='CANCELED'
            r.fulfill(json={'status':'CANCELED_EARLY','refund':'REQUESTED'})
        page.route('**/api/applications/*/cancel',cancel)
        page.goto(base+'/applications/'+application['id'],wait_until='networkidle')
        page.get_by_text('신청 취소·환불 안내',exact=True).click()
        page.get_by_label('취소 사유',exact=True).fill('일정이 변경되어 취소합니다.')
        page.once('dialog',lambda d:d.dismiss());page.get_by_role('button',name='신청 취소하기',exact=True).click()
        assert not cancel_posts
        page.once('dialog',lambda d:d.accept());page.get_by_role('button',name='신청 취소하기',exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('환불을 요청했어요.')
        assert len(cancel_posts)==1
        passed('participant cancellation requires confirmation and explains asynchronous refund (intercepted)')
        # The restored page must be reachable and show actual isolated fixture exceptions.
        operator_page=ctx.new_page()
        operator_page.goto(base+'/admin/exceptions',wait_until='networkidle')
        expect(operator_page.get_by_role('heading',name='자동 처리 확인',exact=True)).to_be_visible()
        expect(operator_page.get_by_role('button',name='자동 작업 다시 시도').first).to_be_visible()
        operator_page.close()
        passed('operator exceptions route shows actionable real fixture records')
        # A failed poll must not unmount the chat composer or lose its unsent draft.
        chat_fail=[False]
        def chat(r):
            if chat_fail[0]:r.fulfill(status=503,json={'error':'일시적인 연결 오류'})
            else:r.fulfill(json={'title':'검증 식탁','messages':[],'can_post':True,'currentUserId':'self'})
        page.route('**/api/tables/*/messages',chat)
        page.goto(base+'/tables/'+session['upcomingTable']+'/chat',wait_until='networkidle')
        page.get_by_role('textbox',name='메시지',exact=True).fill('아직 보내지 않은 인사')
        chat_fail[0]=True;page.clock.fast_forward(4001)
        expect(page.locator('main').get_by_role('alert')).to_contain_text('기존 화면과 입력을 유지했어요.')
        expect(page.get_by_role('textbox',name='메시지',exact=True)).to_have_value('아직 보내지 않은 인사')
        chat_fail[0]=False;page.get_by_role('button',name='다시 시도',exact=True).click()
        expect(page.locator('main').get_by_role('alert')).to_have_count(0)
        expect(page.get_by_role('textbox',name='메시지',exact=True)).to_have_value('아직 보내지 않은 인사')
        passed('failed chat polling preserves draft and retry recovers')
        assert not errors,errors
        (out/'results.json').write_text(json.dumps({'passed':True,'checks':checks,'pageErrors':errors,'limits':'Fault and concurrency cases intercept APIs; real API validation separately checked.'},ensure_ascii=False,indent=2))
    finally:
        page.screenshot(path=str(out/'last-page.png'),full_page=True)
        browser.close()
