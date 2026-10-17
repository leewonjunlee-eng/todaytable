# 우연한 식탁 · Todaytable foundation

모바일 참가자와 운영자가 함께 쓰는 Next.js + TypeScript 앱입니다. 개발은 Node.js 22의 파일 기반 SQLite로 바로 실행할 수 있고, 배포는 PostgreSQL을 사용합니다. 기존 기획 자료와 원본 파일은 그대로 두고 이 디렉터리에서 애플리케이션을 실행합니다.

참가자 Journey 화면(`/`, `/applications`, `/history`, `/notifications`, `/tables/:id`)과 운영자 대시보드(`/admin`)가 보호된 API와 연결됩니다. 신청·모의 결제·자동 매칭·식당과 채팅방 준비·체크인·비공개 피드백·인앱 알림·예외 재시도·안전 검토·CSV 내보내기를 제공합니다. 채팅은 3~5초 polling을 사용합니다. 실제 결제·환불은 모의 처리이며, 푸시는 VAPID 설정이 없으면 비활성 상태를 표시합니다.

2026-10-17 중단된 통합 검증을 재개해 알림 조회·예외 재시도·한국 날짜 기준 취소 처리와 테스트 계약을 수정했습니다. 타입 검사, 전체 테스트, SQLite 통합 시나리오 19개와 프로덕션 빌드가 통과했습니다. 상세 근거와 남은 범위는 [재개 작업 기록](RESUME_STATUS.md)을 참고하세요. PostgreSQL 런타임과 외부 배포는 이번 검증에 포함되지 않습니다.

## 로컬 개발

필요한 도구는 Node.js 22 이상과 npm 10 이상입니다. 개발용 SQLite는 Node 내장 `node:sqlite`를 사용합니다. Docker는 선택 사항이며 PostgreSQL 모드에서만 필요합니다.

```sh
cp .env.example .env.local
npm install
# npm install creates package-lock.json; commit that lockfile before using npm ci in deployment
npm run db:migrate
npm run db:seed
npm run dev
```

웹은 `http://localhost:3000`에서 엽니다. 개발 데이터는 기본 파일 `data/todaytable.sqlite`와 WAL에 저장됩니다. 별도 터미널에서 `npm run worker`를 실행하면 브라우저를 닫아도 예약 작업을 처리하며, 웹과 워커는 같은 `SQLITE_PATH`를 사용해야 합니다.

TCP 소켓을 열 수 없는 로컬 환경에서는 같은 Next 서버를 Unix 도메인 소켓으로 실행할 수 있습니다. 일반 설치에서는 `npm run serve:unix`를 실행하고, curl 요청은 아래처럼 보냅니다. 기본 소켓은 `/tmp/todaytable.sock`이며 프로세스를 종료하면 정리됩니다.

```sh
npm run serve:unix
curl --unix-socket /tmp/todaytable.sock -i http://localhost/login
```

프로필에 테스트 게스트 프로필이 준비되어 있습니다. 데모 로그인은 `guest@todaytable.local` / `GuestDemo!2026`, 운영자는 `admin@todaytable.local` / `AdminDemo!2026`입니다. 실제 배포 전에 두 계정 비밀번호를 교체하거나 테스트 사용자를 제거하세요. 시드 스크립트는 기존 계정 비밀번호를 덮어쓰지 않습니다.

## 환경 설정

`.env.example`을 `.env.local`로 복사해 설정합니다. Next.js는 `.env.local`을 읽고, 워커와 DB 명령도 Node의 `--env-file-if-exists`를 통해 같은 파일을 읽습니다.

- `DATABASE_PROVIDER`: `sqlite` (개발 기본값) 또는 `postgres`. 프로덕션에서는 반드시 `postgres`를 지정합니다.
- `SQLITE_PATH`: SQLite 파일 경로. 기본값은 `./data/todaytable.sqlite`입니다.
- `DATABASE_URL`: `DATABASE_PROVIDER=postgres`일 때 필요한 PostgreSQL 접속 URL
- `SESSION_SECRET`: 32자 이상의 임의 비밀값. 로그인에서 길이를 확인하며 세션 토큰 원문 대신 HMAC-SHA-256 해시를 저장합니다.
- `DATABASE_SSL=require`: TLS가 필요한 DB에서 설정합니다. 인증서 검증을 켜 둡니다. 별도 CA가 필요하면 `DATABASE_SSL_CA`를 제공합니다.
- `SEED_ADMIN_PASSWORD`, `SEED_PARTICIPANT_PASSWORD`: 배포 환경에서 시드할 경우 반드시 개별 비밀번호로 지정합니다.
- `WORKER_ID`: 로그 식별용 접두어입니다. 각 프로세스는 시작할 때 고유한 UUID를 덧붙입니다.

## 데이터베이스·작업

SQL 변경은 개발용 `db/sqlite/`와 PostgreSQL용 `db/migrations/`에 각각 순서가 있는 파일로 추가합니다. `npm run db:migrate`는 선택한 provider의 스키마 파일을 `schema_migrations`에 기록하고 트랜잭션으로 실행합니다. `npm run db:seed`는 데모 계정·프로필·다음 목요일 저녁 회차·식당을 넣습니다. 날짜는 Asia/Seoul 기준으로 계산합니다.

작업은 `scheduled_jobs` 테이블에 저장합니다. PostgreSQL은 `FOR UPDATE SKIP LOCKED`, SQLite는 WAL과 `BEGIN IMMEDIATE` writer lock을 사용해 작업을 점유합니다. 임대 만료 작업은 재점유하며 실행 시도·다음 재시도·오류·완료 시각을 저장합니다. 재시도 횟수를 다 쓰면 `DEAD`와 감사 로그로 남깁니다. 업무 부수 효과와 `job_effects`를 같은 트랜잭션에서 기록해 재실행이 중복 처리하지 않도록 합니다. 신청 접수, 마감 매칭, 식당·채팅방 준비, 리마인드, 대화 콘텐츠, 참석 마감, 후기 요청·후속 안내, 모의 환불과 푸시 작업 핸들러를 제공합니다. 취소 후 테이블 재편성(`REPAIR_TABLE`)은 아직 자동 재매칭을 구현하지 않았으며, 예외로 남겨 운영자에게 표시합니다. 알 수 없는 작업은 재시도 후 실패 처리합니다.

테스트 명령은 다음과 같습니다.

```sh
npm test
npm run test:sqlite
TEST_DATABASE_URL=postgres://... npm run test:integration
npm run typecheck
npm run build
```

SQLite 통합 테스트는 격리된 파일 DB에 실제 마이그레이션·연결 종료 후 재개방 지속성·워커 경합을 검사합니다. 별도 프로세스 검증은 자식 프로세스 실행이 허용된 환경에서 추가로 수행합니다. PostgreSQL 통합 테스트는 격리된 테스트 DB에 실제 제약과 워커 동작을 검사합니다. 개발·운영 DB를 테스트 URL로 사용하지 마세요.

## 배포 메모 (Railway)

Railway 프로젝트에 PostgreSQL, 웹, 워커 서비스를 각각 만듭니다. 웹과 워커는 이 저장소의 같은 코드베이스를 사용하고 동일한 `DATABASE_URL`을 Railway 내부 연결로 받습니다. `DATABASE_PROVIDER=postgres`를 지정합니다. 프로덕션은 SQLite로 자동 대체되지 않습니다.

1. Node 22 환경에서 두 앱 서비스의 빌드 명령으로 `npm install && npm run build`를 설정합니다.
2. 웹 시작 명령은 `npm start`, 워커 시작 명령은 `npm run worker`로 설정합니다. 워커는 상시 실행 서비스로 두고 자동 재시작을 켭니다.
3. 웹과 워커의 `DATABASE_URL`, 32자 이상 `SESSION_SECRET`, `NODE_ENV=production`을 설정합니다. DB TLS가 필요한 경우에만 `DATABASE_SSL=require`와 필요한 CA를 설정합니다.
4. 첫 웹 배포 전에 Railway의 일회성 명령 실행 기능에서 `npm run db:migrate`를 실행합니다. 테스트 자료가 필요하면 시드 비밀번호 두 개를 설정한 뒤 한 번만 `npm run db:seed`를 실행합니다.
5. 웹 공개 도메인에서 로그인·프로필·신청·운영자 화면을 확인하고, 워커 로그와 예약 작업 상태를 확인합니다. 데이터베이스 볼륨/백업 정책을 Railway PostgreSQL에서 설정합니다.

`docker-compose.yml`은 개발용 PostgreSQL만 실행하며 프로덕션 배포 정의가 아닙니다. 서비스 재배포와 무관하게 DB 볼륨을 유지하고, 비밀값은 저장소에 커밋하지 마세요.

## 정책·범위 메모

- 임시 정책으로 신청 가능한 출생연도를 현재 한국 연도에서 19를 뺀 값까지 허용합니다. 생일을 수집하지 않으므로 실제 만 나이 판단은 불가능하며, 정확한 최소 나이 기준은 운영 전 확정해야 합니다.
- 3회권은 첫 신청에서 15,000원 모의 승인하고 2개월 이내 3회 entitlement를 생성한 뒤 1회를 차감합니다. 기존 이용권 선택은 소유한 잔여 entitlement가 있을 때만 가능합니다. 미매칭 해결의 이용권 보관은 사용 횟수를 한 번만 복구하고, 모의 환불은 예약 작업으로 처리합니다. 일반 취소의 환불·이용권 복구 정책은 별도 보완이 필요합니다.
- 연락처는 실제 신청서, 출생연도는 PRD 기준으로 수집합니다. 실제 서비스 운영에 필요한 보유 기간, 접근·삭제 절차, 최종 동의 문구는 확정해야 합니다.
- 공통 일정과 지역은 운영자가 등록한 회차만 선택할 수 있습니다. 자유 입력 지역, Instagram ID, 실제 결제는 현재 범위에 포함되지 않습니다. 테이블 구성원 전용 앱 내 채팅을 제공합니다.
- 운영자 계정은 `ADMIN` 역할을 DB에서 확인합니다. 페이지 보호 외에도 각 API 요청에서 세션과 역할을 다시 확인합니다.
