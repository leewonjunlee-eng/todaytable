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
