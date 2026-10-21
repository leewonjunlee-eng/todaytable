"""Final UX regressions on the dedicated local operator/guide fixture.

All mutation requests in this suite are intercepted; no production access.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:3344')
parser.add_argument('--out', default='.data/submission-review/polish.json')
args = parser.parse_args()
assert urlparse(args.base).hostname in ['127.0.0.1', 'localhost'], 'Local fixture only'
base = args.base.rstrip('/')
sessions = json.loads(Path('.data/final-guide/screenshots.json').read_text())
checks, errors = [], []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    try:
        def context(role):
            ctx = browser.new_context(viewport={'width': 390, 'height': 844})
            ctx.add_cookies([{'name': 'todaytable_session', 'value': sessions[role]['token'], 'url': base}])
            ctx.add_init_script("if(location.protocol==='http:'||location.protocol==='https:')sessionStorage.setItem('todaytable-review-intro-v1','seen')")
            ctx.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
            return ctx

        ctx = context('upcoming')
        page = ctx.new_page()
        page.goto(base + '/apply', wait_until='networkidle')
        availability = ctx.request.get(base + '/api/availability').json()
        event = availability['events'][0]
        page.locator('.availability-day').nth(availability['days'].index(event['day'])).get_by_role('checkbox').check()
        page.get_by_label(event['area'], exact=True).check()
        page.get_by_role('button', name='다음 · 참가권 확인', exact=True).click()
        heading = page.get_by_role('heading', name='참가권 확인', exact=True)
        expect(heading).to_be_focused()
        assert heading.bounding_box()['y'] >= 0
        page.get_by_role('button', name='변경', exact=True).click()
        expect(page.get_by_role('heading', name='어느 날이 편하세요?', exact=True)).to_be_focused()
        checks.append('Application steps move keyboard focus to the visible heading in both directions')

        page.route('**/api/tables/*/safety', lambda route: route.fulfill(json={'ok': True}))
        page.goto(base + '/tables/' + sessions['upcoming']['table_id'] + '#safety-request', wait_until='networkidle')
        form = page.locator('form').filter(has=page.get_by_role('heading', name='안전 요청', exact=True))
        value = form.get_by_label('대상 멤버').locator('option').nth(1).get_attribute('value')
        form.get_by_label('대상 멤버').select_option(value)
        form.get_by_label('이유', exact=True).fill('검증용 신고이며 실제로 접수하지 않습니다.')
        form.get_by_role('button', name='신고/차단 접수').click()
        expect(form.get_by_label('이유', exact=True)).to_have_value('')
        expect(form.get_by_text('안전 요청을 접수했어요.', exact=False)).to_be_visible()
        checks.append('Successful safety request clears the form and explains the next action (intercepted)')

        # Observe that a recurring failed refresh keeps its existing alert mounted.
        path = '**/api/tables/' + sessions['upcoming']['table_id'] + '/messages'
        page.goto(base + '/tables/' + sessions['upcoming']['table_id'] + '/chat', wait_until='networkidle')
        expect(page.get_by_role('textbox', name='메시지', exact=True)).to_be_visible()
        pending = []
        def failure(route):
            pending.append(route)
        page.route(path, failure)
        page.wait_for_timeout(4500)
        for _ in range(100):
            if pending: break
            page.wait_for_timeout(20)
        assert pending
        pending.pop(0).fulfill(status=503, json={'error': '일시적인 연결 오류'})
        alert = page.get_by_role('alert').filter(has_text='일시적인 연결 오류')
        expect(alert).to_be_visible()
        alert.evaluate('(el) => window.submissionAlert = el')
        page.wait_for_timeout(4500)
        for _ in range(100):
            if pending: break
            page.wait_for_timeout(20)
        assert pending
        assert alert.evaluate('(el) => el === window.submissionAlert'), 'Alert remounted during refresh'
        pending.pop(0).fulfill(status=503, json={'error': '일시적인 연결 오류'})
        expect(alert).to_be_visible()
        assert alert.evaluate('(el) => el === window.submissionAlert')
        checks.append('Repeated failed polling retains the same alert node while a retry is pending')
        ctx.close()

        ctx = context('operator')
        page = ctx.new_page()
        table_id = sessions['past']['table_id']
        page.route('**/api/admin/journey', lambda route: route.fulfill(status=409, json={'error': '다른 운영자가 기록을 변경했습니다.'}) if route.request.method == 'POST' else route.continue_())
        page.goto(base + '/admin/tables/' + table_id, wait_until='networkidle')
        page.get_by_role('button', name='기록 정정', exact=True).first.click()
        reason = page.get_by_label('정정 사유', exact=True)
        reason.fill('참석 확인 자료를 다시 확인했습니다.')
        page.get_by_role('button', name='정정 저장', exact=True).click()
        expect(page.get_by_text('다른 운영자가 기록을 변경했습니다.', exact=True)).to_be_visible()
        expect(reason).to_be_visible()
        expect(reason).to_have_value('참석 확인 자료를 다시 확인했습니다.')
        checks.append('Attendance conflict keeps the correction editor and its reason (intercepted)')

        exception_table = json.loads(Path('.data/admin-browser-session.json').read_text())['upcomingTable']
        page.goto(base + '/admin/tables/' + exception_table, wait_until='networkidle')
        page.get_by_role('button', name='안내 이력', exact=True).click()
        resolve = page.get_by_role('button', name='해결 기록', exact=True).first
        expect(resolve).to_be_visible()
        mutations = []
        page.on('request', lambda request: mutations.append(request.url) if request.method == 'POST' and '/api/admin/journey' in request.url else None)
        page.once('dialog', lambda dialog: dialog.dismiss())
        resolve.click()
        expect(resolve).to_be_enabled()
        assert not mutations, 'Dismissing confirmation must not send a mutation'
        checks.append('Canceling exception resolution confirmation makes no mutation request')
        ctx.close()
    finally:
        browser.close()

assert not errors, errors
target = Path(args.out)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps({'checks': checks, 'javascriptErrors': errors}, ensure_ascii=False, indent=2))
print(f'{len(checks)} final polish checks passed; JavaScript errors 0')
