"""Local synthetic fixture: delayed chat sends must preserve the next draft.

Prepare the operator/experience-guide fixture first. POST responses are intercepted;
this test never stores chat messages or calls production.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:3344')
parser.add_argument('--out', default='.data/submission-review/chat-draft.json')
args = parser.parse_args()
assert urlparse(args.base).hostname in ['127.0.0.1', 'localhost'], 'Local fixture only'
base = args.base.rstrip('/')
session = json.loads(Path('.data/final-guide/screenshots.json').read_text())['upcoming']
checks, errors = [], []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    try:
        context = browser.new_context(viewport={'width': 390, 'height': 844})
        context.add_cookies([{'name': 'todaytable_session', 'value': session['token'], 'url': base}])
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + '/tables/' + session['table_id'] + '/chat')
        field = page.get_by_role('textbox', name='메시지', exact=True)
        send = page.get_by_role('button', name='메시지 보내기', exact=True)
        expect(field).to_be_visible()
        pending, payloads = [], []

        def intercept(route):
            if route.request.method == 'POST':
                pending.append(route)
                payloads.append(route.request.post_data_json)
            else:
                route.continue_()

        page.route('**/api/tables/*/messages', intercept)

        def start(text):
            field.fill(text)
            send.click()
            expect(send).to_be_disabled()
            # Process browser events until the intercepted POST is available.
            for _ in range(100):
                if pending:
                    break
                page.wait_for_timeout(20)
            assert pending, 'No intercepted message request'

        def respond(status=200, body=None):
            pending.pop(0).fulfill(status=status, content_type='application/json',
                                   body=json.dumps(body or {}))

        start('먼저 보낸 인사')
        field.fill('다음에 보낼 인사')
        respond()
        expect(send).to_be_enabled()
        expect(field).to_have_value('다음에 보낼 인사')
        assert payloads[-1]['body'] == '먼저 보낸 인사'
        checks.append('Sending an earlier message preserves text typed before its response')

        start('다음에 보낼 인사')
        respond()
        expect(field).to_have_value('')
        checks.append('Successful send clears its unchanged draft')

        start('실패해도 남아 있는 인사')
        respond(503, {'error': '연결을 확인하고 다시 시도해 주세요.'})
        expect(send).to_be_enabled()
        expect(field).to_have_value('실패해도 남아 있는 인사')
        expect(page.get_by_text('연결을 확인하고 다시 시도해 주세요.', exact=True)).to_be_visible()
        failed_key = payloads[-1]['requestKey']
        start('실패해도 남아 있는 인사')
        assert payloads[-1]['requestKey'] == failed_key
        respond()
        expect(field).to_have_value('')
        checks.append('Failure preserves draft; retry reuses the request key')

        start('응답을 받지 못한 메시지')
        respond(503, {'error': '응답을 확인하지 못했어요.'})
        expect(send).to_be_enabled()
        uncertain_key = payloads[-1]['requestKey']
        start('내용을 고친 새 메시지')
        assert payloads[-1]['requestKey'] != uncertain_key
        respond()
        expect(field).to_have_value('')
        checks.append('Editing text after an uncertain response uses a new request key')

        # Hold a pre-send poll, then verify refresh fetches again after it settles.
        endpoint = base + '/api/tables/' + session['table_id'] + '/messages'
        snapshot = context.request.get(endpoint).json()
        held_gets, get_count = [], []
        overlap_text = '전송 직전 조회와 겹친 인사'

        def overlap(route):
            if route.request.method != 'GET':
                route.fallback()
                return
            get_count.append(route.request.url)
            if len(get_count) == 1:
                held_gets.append(route)
            else:
                fresh = {**snapshot, 'messages': [*snapshot['messages'], {
                    'id': 'intercepted-post-send', 'body': overlap_text, 'kind': 'USER',
                    'author_name': '체험 참가자', 'author_user_id': snapshot['currentUserId'],
                    'created_at': '2026-10-21T00:00:00.000Z',
                }]}
                route.fulfill(json=fresh)

        page.route('**/api/tables/*/messages', overlap)
        page.clock.install()
        page.clock.fast_forward(4100)
        for _ in range(100):
            if held_gets:
                break
            page.wait_for_timeout(20)
        assert held_gets, 'No pre-send poll was intercepted'
        start(overlap_text)
        respond()
        held_gets.pop(0).fulfill(json=snapshot)
        expect(page.locator('.chat-timeline').get_by_text(overlap_text, exact=True)).to_be_visible()
        assert len(get_count) >= 2, 'Post-send refresh reused an older poll'
        checks.append('Post-send refresh fetches again after a pre-send poll settles')
    finally:
        browser.close()

assert not errors, errors
target = Path(args.out)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps({'checks': checks, 'javascriptErrors': errors}, ensure_ascii=False, indent=2))
print(f'{len(checks)} chat draft checks passed; JavaScript errors 0')
