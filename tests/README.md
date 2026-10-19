# PostgreSQL integration tests

These tests execute the checked-in SQL migrations and actual application/worker services against PostgreSQL. They report explicit skips if `TEST_DATABASE_URL` is unset. Use a dedicated database whose name includes `test` (for example `todaytable_test`); the harness creates and drops only a uniquely named `tt_test_*` schema inside it. It never resets `public` or the database itself.

Run after installing project dependencies:

```sh
TEST_DATABASE_URL=postgres://localhost/todaytable_test npm run test:integration
```

The database role needs permission to create a schema in the dedicated test database. The tests use real PostgreSQL transactions and row locks; they do not replace them with mocks or an in-memory database.

# In-process rendered page smoke check

With the seeded development database and project dependencies available, run:

```sh
npm run test:render
```

This prepares the real Next.js app and passes requests directly to its request handler, without opening a TCP or Unix listener. It logs in through the real auth route, renders participant and admin pages against the configured database, and saves representative HTML under `.data/render-smoke/` (ignored by git).

# Product and keyboard browser scenarios

See [validation guide](../docs/VALIDATION.md) for the isolated browser fixture setup, production bundle checks and PostgreSQL product suites.

## 모바일 화면 검증

`node tests/mobile-browser.mjs`는 360/390/430px 및 PC에서 목록/상세 이동, 문의 뒤로가기 복원, 신청 단계, 채팅 입력창과 가로 넘침을 검사합니다. 별도 실행 중인 검증 서버와 해당 환경의 임시 로그인 세션이 필요합니다. `MOBILE_REVIEW_BASE`, `MOBILE_REVIEW_SESSIONS`, `MOBILE_REVIEW_OUTPUT`으로 서버 주소, Git에서 제외한 세션 JSON(`role`, `token` 필드), 결과 폴더를 지정합니다. 기본 주소는 `http://127.0.0.1:3310`, 기본 세션 파일은 `.data/mobile-review-sessions.json`입니다. `MOBILE_REVIEW_WIDTHS=390`처럼 화면 폭을 제한할 수 있습니다. 구성 자료를 갖춘 격리 DB/검증 계정을 사용하고 검증 종료 후 임시 세션을 만료시킵니다.

# 2026-10-19 completion checks

`tests/prd-completion.test.ts` covers published recruitment, a registered date more than 60 days away, resumable and consumed checkout sessions, venue slots and dietary confirmation, template snapshots and delivery retries, and held/resumed account deletion. SQLite is the default; set `COMPLETION_TEST_POSTGRES` to a dedicated local `*_test` database for PostgreSQL. Each run uses an isolated schema or temporary file.

`tests/global-matching.test.ts` verifies the eight-person counterexample, deterministic input ordering, 19/25/50/100-person placement and hard constraints. `tests/automatic-matching.test.ts` also verifies invitation acceptance and merging two three-person tables.

After preparing the isolated operator fixture and serving a completed production build, run `node tests/operations-settings-browser.mjs` alongside the operator and profile browser checks. It creates local recruitment, checks edit preview and stale versions, publishes local notification templates, and inspects the venue/deletion settings at 360 and 1440px. See [validation](../docs/VALIDATION.md) for commands and [release evidence](../docs/RELEASE_20261019.md) for results. Do not rebuild the directory serving an active browser suite; serve a separate copy of the finished standalone output.

## 가상 운영·개편 화면 검증

`tests/showcase.test.ts`는 실제 제공 XLSX 294행으로 별도 SQLite DB를 구성해 전체 연결, 시점, 식탁 정원·연령·식당 수용량, 재실행, 외부 푸시 차단을 검사합니다. `npm test`에 포함됩니다. PostgreSQL의 동일 자료 생성과 DB별 인수 테스트도 별도로 실행합니다.

브라우저 검증은 Python Playwright를 사용합니다. 가상 자료를 구성한 서버를 실행한 뒤 다음과 같이 실행합니다. 기본 계정은 로컬 시드 계정이며 운영 계정은 Git 제외 JSON 경로로 전달합니다.

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tests/showcase-browser.py --base http://localhost:3101
# 기존 설치 브라우저를 쓸 때는 PLAYWRIGHT_CHROMIUM_EXECUTABLE 환경변수 지정
```

360·390·430·1440px에서 화면 넘침, 세 상태, URL 탭/새로고침/뒤로가기, 본인 대화·지난 대화, 계정별 권한, 원본 294행 연결을 확인합니다. 기본 결과 경로는 Git 제외 `.data/showcase-browser/`입니다. 운영 계정 옵션을 사용하면 테스트 메시지를 전송하지 않습니다.

최종 신청 화면의 날짜·지역 중복 제거, 가격과 라디오 간격, 결제 결과 선택의 접근성 이름, 키보드 본문 이동은 `python3 tests/showcase-reviewed-browser.py --base <URL>`로 확인합니다. 운영 계정은 같은 `--credentials` 옵션을 사용하며 결제 요청은 전송하지 않습니다.
