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

## 성비·회차 참가자 목록

`tests/gender-composition.test.ts`와 자동 매칭 테스트는 허용된 여섯 조합과 승인·취소·충원·프로필 변경 경계를 검사합니다. `python3 tests/gender-browser.py --base <URL> [--credentials <보호 JSON>]`는 실제 설문 294행 연결, 식탁 성비·연령, 네 화면 폭의 참가자 목록과 여러 회차 중복 집계를 확인합니다. 결과는 기본 `.data/gender-browser/`에 저장합니다.

## Opus 교차 검토 회귀 검사 (2026-10-19)

`tests/cross-review-browser.py`는 로컬 운영자 fixture의 세션을 사용합니다. `tests/prepare-operator-browser.ts`를 실행하고 해당 환경 파일로 마지막 production standalone bundle을 제공한 뒤 Python Playwright로 실행합니다. 기본 주소는 `http://127.0.0.1:3326`이며 `--base`, `--out`으로 변경합니다. 결제/환불·장애·동시 편집·병합 상태는 API 응답 통제로 재현하고, 실제 checkout 검증과 예외 목록은 격리 서버 API로 확인합니다. 운영 사이트는 허용하지 않습니다.

`tests/virtual-payments.test.ts`에는 SINGLE/THREE_PASS의 환불 대기·실패 → 직접 취소/HOLD/TRANSFER 차단과 중복 환불 방지가 포함됩니다. `tests/{sqlite,postgres}.integration.test.ts`는 예외 재실패 시 동일 행 재개와 성공 시 해결을 검증합니다. `tests/prd-completion.test.ts`는 성별 미선택 상태의 결제 차단과 유료 신청 후 미선택 변경 거부를 검증합니다. 상세 범위·결과·한계는 [교차 검토 보고서](../docs/CROSS_REVIEW_20261019.md)를 확인하세요.


## 첫 방문·역할별 가이드와 최종 여정 확인 (2026-10-20)

`tests/login-destination.test.ts`는 로그인 복귀 주소의 내부 경로·역할 제한과 외부 주소 거부를 검사합니다.

브라우저 준비는 다음 순서입니다. 모든 fixture는 `.data/operator-browser.sqlite` 전용이며 운영 주소는 허용하지 않습니다. Playwright가 설치된 Python을 사용합니다.

```bash
node --import tsx tests/prepare-operator-browser.ts
node --env-file=.data/operator-browser.env --import tsx tests/prepare-experience-guide.ts
npm run build
APP_URL=http://127.0.0.1:3340 node --env-file=.data/operator-browser.env node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3340
```

다른 터미널에서 `python tests/experience-guide-browser.py --section guide`, `python tests/experience-guide-browser.py --section journeys`로 실행합니다. 결과와 캡처는 `.data/final-guide/browser/`에 저장합니다. 가이드 이미지를 다시 만들 때만 `python tests/capture-experience-guide.py`를 실행합니다. `--only participant-table`처럼 한 화면만 재촬영할 수도 있습니다. fixture 생성기는 가상 프로필 이름·예약 정보·미래 참석 상태를 정리하고 전용 체험 계정의 비밀번호를 새로 만들어 보호 파일에 저장합니다. 운영 DB·실제 계정은 사용하지 않습니다.


### 가이드 고해상도 이미지 검증

`tests/capture-experience-guide.py`는 모바일 360·390·430px 각각 DPR 3, 데스크톱 DPR 2에서 글꼴 로딩 후 촬영하고, 설치된 Next.js의 `sharp`로 무손실 WebP를 생성합니다. 인코딩 전후 픽셀 일치를 검사합니다. 원본 PNG는 `.data/guide-quality/raw/`에 보관합니다. 캡처를 갱신한 뒤 빌드하고 `python tests/guide-image-quality-browser.py --base http://127.0.0.1:3340`로 32개 화면·해상도 조합과 원본 열기를 확인합니다.


### 참가자 모바일 화면 검증

위 로컬 fixture 서버에서 `python tests/participant-mobile-browser.py --base http://127.0.0.1:3342 --section screens`를 실행합니다. `--section controls`는 날짜·지역·참가권 선택과 채팅 입력·작은 높이·터치 영역을 검사하고 결제를 제출하지 않습니다. `--section scope`는 700/701px 경계, 데스크톱 및 운영자 화면의 범위 분리를 검사합니다. 기본 폭은 360·390·430px이며 `--widths 360`으로 좁힐 수 있습니다. 운영 주소는 허용하지 않습니다.
