# 기본 틀 구현·검증 결과

2026-10-16. 범위: [사용자가 승인한 1차 기반](foundation_acceptance.md). 구현은 Luna 모델이 맡고, 주 에이전트가 설계·코드 검토·수정 지시·독립 검사를 진행했다. PostgreSQL 통합 테스트는 별도의 Luna 작업에서 작성하고 검토 후 보완했다.

**현재 판정: 소스 구현 및 가능한 정적·단위 검증 완료, 실제 실행 검증 미완료. 전체 완료로 판정하지 않는다.**

## 요구사항별 증거와 남은 확인

| 항목 | 현재 소스 증거 | 실행 검증 |
|---|---|---|
| Next.js·TypeScript·PostgreSQL | `package.json`, `app/`, `lib/db.ts` | 임시 의존성 경로를 사용한 전체 소스 타입 검사 통과. 정상 의존성 설치·프로덕션 빌드 미완료 |
| 로그인·로그아웃·역할·소유권 | `lib/auth.ts`, `lib/security.ts`, `app/api/auth/`, 각 API의 서버 권한 검사 | 비밀번호·세션 해시 단위 검사 통과. 실제 로그인·세션 만료·로그아웃·접근 제한 실행 대기 |
| 프로필·선호·식사 조건·동의 | `components/profile-form.tsx`, `app/api/profile/route.ts` | 실제 PostgreSQL 저장·재조회와 모바일 입력 검사 대기 |
| 날짜·지역 복수 선택·신청 | `components/application-form.tsx`, `lib/application-service.ts` | 입력 선택 단위 검사 통과. 모집 마감·중복 신청·동시 요청 DB 검사 대기 |
| 모의 결제·3회권·기존 이용권 | 같은 신청 서비스와 `entitlements`, `entitlement_entries`, `payments` 스키마 | 트랜잭션·잔여량·만료·재결제 방지 통합 테스트 작성. 실제 실행 대기 |
| 운영자 회차·식당·신청·결제 | `app/admin/`, `app/api/admin/` | 역할 검사 소스 확인. 등록·목록 갱신·조회 실행 대기 |
| 별도 예약 작업 프로세스 | `worker/index.ts`, `scheduled_jobs`, `job_effects` | 재시도 지연 단위 검사 통과. 독립 실행·점유 경합·임대 복구·중복 처리·실패 종료 DB 검사 대기 |
| 데이터 유지·재시작 복구 | `docker-compose.yml`의 PostgreSQL 볼륨, DB 작업 큐 | 실제 웹·worker·DB 재시작 후 보존 검사 대기 |
| 모바일 공통 화면 | `app/globals.css`, 공통 내비게이션·폼·페이지 | 소스 타입 검사 통과. 실제 브라우저 크기·조작·시각 검사 대기 |
| 스키마·시드·실행 안내 | `db/migrations/001_foundation.sql`, `scripts/`, `.env.example`, `README.md` | 마이그레이션·초기 데이터·시드 재실행 검사 대기 |

## 실행한 검사

1. **단위 테스트 3개 통과, 실패 0개**: 신청 선택·상품 가격·잘못된 UUID·중복 선택, 재시도 지연, 비밀번호 해시·검증과 세션 토큰 해시. 인접 프로젝트에 이미 설치된 tsx 4.21.0 로더로 아래 명령을 실행했다. 프로젝트의 지정 버전 4.23.1을 설치해 검증한 결과는 아니다.

   ```sh
   node --import /home/ubuntu/second-brain/node_modules/tsx/dist/loader.mjs tests/domain.test.ts
   ```

2. **전체 소스 타입 검사 통과**: `/tmp/todaytable-typecheck.json`에서 실제 설치된 Next.js·React·Node 타입 경로와 공식 DefinitelyTyped `pg` 타입 정의를 연결해 검사했다. 가짜 DB 드라이버나 임의 타입 스텁을 앱에 추가하지 않았다. 이 검사는 PostgreSQL 드라이버 실행 또는 Next.js 빌드 증거가 아니다. 임시 경로·타입 파일은 저장소 구성에 포함하지 않았다.

   ```sh
   /home/ubuntu/projects/personal-assets/frontend/node_modules/.bin/tsc -p /tmp/todaytable-typecheck.json --noEmit --pretty false
   ```

   타입 정의 출처: [DefinitelyTyped pg](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/pg/index.d.ts), 확인한 blob SHA `9700c723c78a9ffc211445b012896962a7338950`.

3. **통합 테스트 생략 경로 확인**: `TEST_DATABASE_URL`을 제거하고 실행해 **4개 모두 명시적으로 SKIP, 통과 0개**임을 확인했다. DB 연결 성공으로 계산하지 않는다. 테스트 소스는 전용 테스트 DB의 임시 스키마에서 실제 신청 서비스·API·worker를 검사하도록 작성했다.

   ```sh
   env -u TEST_DATABASE_URL node --import /home/ubuntu/second-brain/node_modules/tsx/dist/loader.mjs tests/postgres.integration.test.ts
   ```

4. **프로덕션 빌드 미통과**: `npm run build`는 `next: not found`로 종료했다. 이 프로젝트의 의존성이 설치되지 않은 상태다. Luna가 시도한 오프라인 설치도 캐시에 없는 패키지로 `ENOTCACHED` 실패했다. lockfile은 생성하지 못했으며 위조하지 않았다.

## 실제 실행을 막는 환경 조건

- 이 환경에는 PostgreSQL 서버·`psql`·Docker가 없다.
- 필요한 npm 패키지 중 PostgreSQL 드라이버 등이 설치·캐시되어 있지 않다. 네트워크 DNS 확인도 실패했다.
- Python에서 TCP 소켓을 생성하는 단계가 `PermissionError: Operation not permitted`로 차단된다. 따라서 여기서 웹 서버·DB 연결·브라우저를 통한 전체 흐름을 증명할 수 없다.

## 추가 검토와 보완

이어진 검토에서 모바일 CSS가 주요 메뉴 링크를 숨기는 문제와 작은 화면의 참가권 가격·라디오 위치 충돌 가능성을 발견했다. Luna가 내비게이션 줄바꿈, 라디오 전용 영역, 선택 항목의 키보드 포커스 표시를 추가했다. 실제 브라우저에서 렌더링한 검증은 아직 하지 못했다.

통합 테스트에는 실제 로그인 성공·실패와 저장된 세션, 로그아웃의 303 이동·세션 삭제, 운영자의 회차·식당 등록과 조회, 참가자의 등록 거부, 한국 시간의 UTC 저장 확인을 추가했다. 전체 소스 타입 검사는 다시 통과했고, 통합 테스트는 여전히 **4개 모두 명시적 SKIP**다. 각 테스트 안에 여러 업무 시나리오가 있으며 실행 통과한 DB 시나리오는 없다.

동일 환경을 재확인했지만 PostgreSQL/Docker 및 프로젝트 의존성은 없고 TCP 생성도 여전히 차단된다. 따라서 아래 실제 실행 순서가 남아 있다.

## 환경이 준비되면 이어갈 순서

1. README대로 의존성을 설치하고 생성된 `package-lock.json`을 검토·보관한다.
2. PostgreSQL을 시작하고 마이그레이션·시드를 실행한다. 시드를 다시 실행해 중복 생성 여부를 확인한다.
3. 별도 전용 테스트 DB(예: `todaytable_test`)에 `TEST_DATABASE_URL`을 설정하고 통합 테스트 4개를 실제로 실행한다. 테스트 DB 이름에 `test`가 있어야 하며 운영 DB를 지정하지 않는다.
4. 프로젝트 자체의 `npm test`, `npm run typecheck`, `npm run build`를 실행한다.
5. 웹·별도 worker를 시작하고 참가자 로그인→프로필→신청·모의 결제→조회, 운영자 등록·조회를 브라우저에서 확인한다.
6. 브라우저 종료 후 예약 작업, 실패 재시도, 재시작 후 데이터·작업 유지와 중복 방지를 확인한다.

이 확인이 끝나기 전에는 “실제로 동작하는 기본 틀 검증 완료”나 “배포 완료”로 표시하지 않는다.
