# 검증과 재실행

Node.js 22 이상을 사용합니다. 테스트는 SQLite 임시 파일 또는 별도 PostgreSQL 테스트 DB/스키마를 사용합니다. 운영 DB를 테스트 URL로 사용하지 않습니다.

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
