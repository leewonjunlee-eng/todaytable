# 검증과 재실행

Node.js 22 이상을 사용합니다. 테스트는 SQLite 임시 파일 또는 별도 PostgreSQL 테스트 DB/스키마를 사용합니다. 운영 DB를 테스트 URL로 사용하지 않습니다.

## 최신 화면·가상 운영 검증 — 2026-10-19

전체 자동 테스트 85개, 최종 관련 검사 16개, SQLite/PostgreSQL 인수 각 20개가 통과했습니다. 실제 XLSX 294행의 연결과 재실행, 식탁 인원·연령·식당 수용량, 외부 푸시 차단을 검사합니다. 마이그레이션은 029까지 적용합니다. 로컬 Python Playwright 129개 확인과 55개 캡처, 운영 네 계정 138개 확인을 완료했습니다. 최신 운영 검증과 배포·보존 근거는 [STATUS](STATUS.md)에 모읍니다.

브라우저 실행법과 Python 환경은 [테스트 안내](../tests/README.md), GitHub 스킬·디자인 기준은 [개편 기록](EXPERIENCE_REDESIGN_20261019.md)을 확인하세요. 원본은 `python3 scripts/prepare_source_data.py`로 파싱하고, DB 이행·기본 계정·운영자 프로비저닝·원본 가져오기 후 `npm run db:populate:lifecycle`로 가상 운영을 구성합니다. 검증용 DB는 별도 파일 또는 로컬 테스트 DB를 사용하세요.

## 이전 릴리스 검증 — 2026-10-19 05:32 UTC

전체 PostgreSQL 구성 81개 통과·실패 0·건너뜀 0, SQLite 기본 구성 76개 통과·PG 전용 5개 건너뜀입니다. DB별 인수 각 20개와 001~028 두 번 이행, 타입 검사 포함 프로덕션 빌드, 최종 빌드 브라우저 113개 검사가 통과했습니다. 운영 사이트 49개 확인과 DB 보존 대조도 완료했습니다. 배포 ID와 실제 근거는 [현재 현황](STATUS.md), 수정 범위·한계는 [릴리스 기록](RELEASE_20261019.md)에 있습니다.

```sh
TEST_DATABASE_URL=postgres://tt_test@127.0.0.1:55439/todaytable_test \
TEST_PRODUCT_DATABASE_URL=postgres://tt_test@127.0.0.1:55439/todaytable_test \
AUTO_TEST_POSTGRES=postgres://tt_test@127.0.0.1:55439/todaytable_test \
COMPLETION_TEST_POSTGRES=postgres://tt_test@127.0.0.1:55439/todaytable_test \
OPERATOR_TEST_POSTGRES=1 PROFILE_TEST_POSTGRES=1 VIRTUAL_FINANCE_PROVIDER=postgres npm test
TEST_DATABASE_URL=postgres://tt_test@127.0.0.1:55439/todaytable_test npm run test:providers
node tests/operations-settings-browser.mjs
```

아래 기존 브라우저 준비 절차로 운영·프로필·설정을 실행합니다. 활성 서버의 `.next`를 빌드로 덮어쓰지 않도록, 빌드가 끝난 standalone 출력·static·public을 별도 디렉터리에 복사해 제공합니다. 설정 브라우저는 테스트용 회차와 안내 문구를 변경하므로 로컬 격리 DB에서만 실행합니다. 결제/환불의 추가 브라우저 근거는 `.data/completion-payment-browser-verified.log`이며 백엔드의 재현 가능한 회귀 검증은 `tests/prd-completion.test.ts`, `tests/virtual-payments.test.ts`입니다.

## 10월 19일 이전 검증 및 재실행 자료

## 운영 개편 당시 PRD v0.2 검증 — 2026-10-19

추가 계측 검증: `tests/operator-workspace.test.ts`는 신청 시작 중복 방지와 운영자 전용 작업 시간 시작·종료·분석 집계를 SQLite와 별도 PostgreSQL 스키마에서 확인합니다. `tests/matching-learning.test.ts`는 자료 부족 시 고정 가중치 유지, 20개 이상 실적에서 제한적 자동 조정, 합계 보존을 확인합니다. `npm run typecheck` 통과. 이전 브라우저 결과는 계측 UI 추가 전 기록이므로 해당 새 화면의 검증 근거로 사용하지 않습니다.

운영 메뉴·예약과 신규 가입·선호 테스트의 현재 화면은 아래 스크립트로 확인한다. 아래의 이전 제품 브라우저 시나리오는 과거 화면용 기록이며 최신 UI의 통합 성공 근거로 사용하지 않는다.

```sh
npm run build
node --import tsx tests/prepare-operator-browser.ts
cp -R .next/static .next/standalone/.next/
cp -R public .next/standalone/
HOSTNAME=127.0.0.1 PORT=3326 node --env-file=.data/operator-browser.env .next/standalone/server.js
```

준비 스크립트는 기존 개발 DB 설정을 무시하고 `.data/operator-browser.sqlite`에만 회차·식탁·운영자·예약 상태·신고를 준비한다. 세션과 환경 파일은 Git에서 제외된 `.data`에 저장한다. 별도 터미널에서 실행한다.

```sh
node tests/operator-workspace-browser.mjs
node tests/profile-onboarding-browser.mjs
```

운영 검증은 360·390·430·1440px의 6개 메뉴, 월·연 그래프 조작, 마감 전/후/지난 매칭, 식탁 멤버·단체방·안내·후기, 예약 필터와 실제 저장 응답, 문의함 신고 맥락, 가로 넘침·JavaScript/API 오류를 확인한다. 저장된 예약 메모를 다시 편집할 때도 접근성 이름으로 입력창을 찾아 재실행할 수 있다. 최종 실행에서 60개 확인이 통과했다. 결과·캡처·실행 추적은 `.data/admin-browser/`에 남긴다. 가입·프로필은 모바일 세 너비의 입력 누락 차단·단계 이동·답변 보존·수정·저장·재사용을 확인하고 `.data/profile-browser/`에 남긴다.

자동 매칭·운영·프로필·결제의 PostgreSQL 검증은 다음 환경변수를 사용한다. 각 파일이 별도 임시 스키마를 만들고 정리한다.

```sh
TEST_DATABASE_URL=postgres://...@127.0.0.1:5432/todaytable_test \
AUTO_TEST_POSTGRES=postgres://...@127.0.0.1:5432/todaytable_test \
OPERATOR_TEST_POSTGRES=1 PROFILE_TEST_POSTGRES=1 VIRTUAL_FINANCE_PROVIDER=postgres \
node --import tsx --test tests/automatic-matching.test.ts tests/operator-workspace.test.ts tests/profile-onboarding.test.ts tests/virtual-payments.test.ts
```

## 타입·빌드·DB 검증

```sh
npm ci
npm run typecheck
npm test
npm run build
npm audit
```

`TEST_DATABASE_URL`이 없으면 기존 PostgreSQL 통합 테스트 5개는 명시적으로 건너뜁니다. PostgreSQL을 포함한 전체 검증은 별도 로컬 `*_test` DB를 만들고 아래처럼 실행합니다. 새 제품 테스트의 URL은 `127.0.0.1` 호스트를 요구합니다.

```sh
TEST_DATABASE_URL=postgres://...@127.0.0.1:5432/todaytable_test \
TEST_PRODUCT_DATABASE_URL=postgres://...@127.0.0.1:5432/todaytable_test npm test
TEST_DATABASE_URL=postgres://...@127.0.0.1:5432/todaytable_test npm run test:providers
```

제품 테스트는 회차별 정책·기존 좌석·시간 중복·정원·버전 충돌·3인 협업·개인정보 분리·후기 적격성·신호 철회·실제/모의 집계를 검사합니다. provider 인수 검증은 각각 20개 시나리오와 실제 마이그레이션 2회 실행을 확인합니다.

## 실제 브라우저 검증

Playwright는 개발 의존성에 고정되어 있습니다. 최초 설치 시 `npx playwright install chromium`으로 실행용 브라우저를 준비합니다.

```sh
node --env-file-if-exists=.env.local --import tsx tests/prepare-product-browser.ts
```

아래처럼 격리 환경 파일을 읽는 서버로 실행해야 테스트 DB를 사용합니다. 일반 개발 서버와 동시에 같은 포트를 열지 않습니다.

```sh
node tests/serve-product-browser.mjs --dev
```

별도 터미널에서 실행합니다.

```sh
node tests/product-browser.mjs
node tests/accessibility-browser.mjs
```

- 준비 스크립트는 `.data/goal-browser.sqlite`만 사용합니다. 운영/기본 로컬 DB와 분리되며 기존 계정 비밀번호를 덮어쓰지 않습니다.
- 참가자 신청·모의 결제→문의→A 배정/B 내부 메모/C 공개 답변→매칭 비교·적용→실제 워커 처리→체크인→종료 후 후기→저장된 내용 재조회→개인화 철회를 확인합니다.
- 비회원 문의 재조회, 390px/1440px 화면 넘침, 내부 메모의 DOM/API 비노출, 렌더링 오류도 검사합니다.
- 키보드 검증은 Tab/Enter 목록 선택·답변 전송·필터·모바일 운영 메뉴·모달 포커스 순환과 Esc 복원을 확인합니다.
- `.data/product-browser/`, `.data/accessibility-browser/`에 결과 JSON과 캡처를 저장합니다. 계정 전달 파일은 `.data/goal-browser-credentials.json`이며 0600 권한을 사용합니다.

실제 production bundle은 `npm run build` 후 `node tests/serve-product-browser.mjs`로 실행하여 같은 검증을 수행합니다. 실행기는 정적 파일을 복사하고 SQLite 절대 경로·테스트 origin을 검사합니다. 외부에서 설정된 production DB 환경변수도 격리 설정으로 대체하므로 운영 DB에 연결하지 않습니다.

## 운영 검증 근거

최신 배포 ID와 최종 결과는 [현재 현황](STATUS.md), 요구사항별 근거는 [완료 검증표](PRODUCT_ACCEPTANCE.md)를 확인합니다. 운영 검증은 기존 체험 계정과 모의 회차만 사용하며 실제 고객에게 메시지를 보내지 않습니다. 원본 스냅샷, 비교 결과, 새 운영자 비밀번호와 원격 접근 자료는 Git에 포함하지 않는 `.data/`에 보관합니다.
