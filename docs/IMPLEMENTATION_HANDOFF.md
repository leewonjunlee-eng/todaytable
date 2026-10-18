# 우연한 식탁 — 구현 재개용 상세 인수인계

> **이 문서는 10월 17일 인수인계 보관 기록입니다.** 10월 18일 재개 작업의 최신 구현·검증·배포 결과는 [현재 현황](STATUS.md)을 확인하세요. 아래의 “미구현”·“실패”·“통과” 표기는 해당 기록 시점 기준입니다.

작성일: 2026-10-17 (UTC)
작업 폴더: `/home/ubuntu/projects/todaytable`
상태: **사용자 요청으로 새 기능 확장을 중단하고, 작성된 코드 검증과 인수인계를 정리하는 시점. 전체 1~5단계가 완료된 상태가 아니다.**

이 문서는 다른 개발자가 이전 대화를 읽지 않고 작업을 재개하기 위한 실행 지침이다. 제품 의도 전체는 `docs/PRODUCT_EVOLUTION_PLAN.md`, 과거 작업/운영 반영 기록은 `docs/archive/RESUME_STATUS.md`에 있다. 문서와 실제 코드가 다르면 현재 파일·DB·실행 결과를 먼저 확인한다.

---

## 0. 먼저 이해할 제품과 사용자 요청

### 0-1. 제품의 본질

우연한 식탁은 참가자가 특정 테이블이나 사람을 직접 고르는 모임 게시판이 아니다.

1. 참가자가 가능한 일정·지역과 취향을 입력한다.
2. 참가권을 선택하고 모의 결제한다.
3. 시스템이 4~6명의 식탁을 자동 매칭·재배치·확정한다.
4. 식당·채팅방·리마인드·대화 콘텐츠를 안내한다.
5. 참가 후 후기를 받고 다음 매칭을 개선한다.
6. 운영자는 정상 흐름을 매번 검수하지 않고 문의와 예외를 처리한다.

대표님이 추구한 네 가지는 **획득·전환 / 매칭 품질 / 반복 참여 / 운영 효율**이다. 원문은 `kickoff_transcript.txt`의 25~32분과 40분 구간을 확인한다.

### 0-2. 이번 확장에 대해 사용자가 명시한 요구

- 사용자가 웹페이지에서 문의를 남긴다.
- **사용자가 웹사이트 안에서 운영자의 답변을 다시 확인할 수 있어야 한다.** 이메일 발송으로 대체하지 않는다.
- 운영자 3명이 같은 문의를 보며 담당·카테고리·답변·처리 이력을 정리한다.
- 운영자 전용 내부 메모는 참가자에게 노출되지 않는다.
- 운영자가 매칭 기조를 선택하면 같은 후보 안에서도 조합 우선순위가 조금 달라진다.
- 행사 후 좋았던 점/아쉬웠던 점을 수집하고 다음 매칭 개선의 근거로 누적한다.
- 기존의 따뜻한 무드는 유지하면서 디자인과 사용성을 개선한다.
- 모의 결제·가상 식당은 허용되며 실제 돈을 이동시키지 않는다.

원래 사용자는 1~5단계 전체 구현을 요청했으나, 마지막에 **“일단 하던 데까지만 마무리하고 상세한 .md 계획을 남겨 달라”**고 요청했다. 따라서 지금 전체 구현·운영 배포를 계속하지 않는다. 사용자가 재개를 요청하면 아래 순서로 이어간다.

## 1. 5분 안에 상태 확인하기

```bash
cd /home/ubuntu/projects/todaytable
cat AGENTS.md
git status --short
cat package.json
cat docs/PRODUCT_EVOLUTION_PLAN.md
```

- `AGENTS.md`에 따라 Next.js 코드를 수정하기 전 `node_modules/next/dist/docs/`의 해당 문서를 읽는다. 현재 Next.js는 `16.3.0`이다.
- Node.js 22 이상이 필요하다. 개발 DB는 Node 내장 SQLite, 운영 DB는 PostgreSQL이다.
- 기존 작업부터 커밋되지 않은 변경이 많다. `git reset`, 전체 파일 덮어쓰기, `git clean`으로 초기화하지 않는다.
- `git diff`에는 추적 중인 파일만 보인다. 새 파일은 `git status`와 `rg --files`로 함께 확인한다.
- 작업 도중 나타난 `Screenshot 2026-10-17 234822_edited.png`는 이 작업에서 생성하지 않은 파일이다. 임의 수정·삭제·배포하지 않는다.
- `.env.local`, `.data/`의 비밀번호·DB URL·스냅샷을 출력하거나 커밋하지 않는다.

## 2. 로컬과 운영의 차이 — 가장 중요한 주의점

### 2-1. 로컬에만 추가된 이번 확장

- 014~017 마이그레이션이 로컬 SQLite에 적용되어 있다.
- 공동 문의함, 운영 설정, 매칭 스튜디오 API와 UI가 작업 폴더에 있다.
- 로컬에는 운영자 프로필 3개가 생성되어 있다.
- 이번 공동 문의함/스튜디오 확장은 **아직 Railway에 배포하지 않았다.**
- 새 디자인 CSS도 로컬 소스에만 있다. 브라우저 시각 검증은 아직 하지 않았다.

### 2-2. 마지막으로 확인한 운영 배포

| 항목 | 값 |
| --- | --- |
| URL | `https://todaytable-production.up.railway.app` |
| Railway project | `ea8717f4-7740-44c1-a29f-f1107005a7e6` |
| environment | `production` / `d85ed0fc-d6d4-4529-b237-0ceb20451e9e` |
| web service | `todaytable` / `7758a5f7-a439-47c5-b617-2e4f1f856ae6` |
| worker service | `todaytable-worker` / `1b27d398-2380-4795-9007-112d210d0afa` |
| Postgres service | `Postgres` / `b1fca2cb-b55e-46fd-894e-71734b3bf735` |
| web deployment | `9cc7eb1a-a3fc-470e-b7db-1b5ee4bc1164` — SUCCESS |
| worker deployment | `9e1697b1-31ce-4240-a27b-19195a971864` — SUCCESS |

위 값은 이번 인수인계 정리 시 Railway CLI로 확인했다. 재개할 때 현재 배포 상태를 다시 확인한다.

운영에는 이전 작업에서 가상 참가자 48명, 신청·모의 결제 60건, 회차 12개, 식탁·예약 6개, 후기 15개 등이 들어가 있다. 모의 매출 597,000원·모의 환불 23,000원이다. 원본 설문 294행은 별도로 보존되어 있다.

운영 DB의 014~017 적용 여부는 이번 중단 정리에서 직접 조회하지 않았다. 이번 작업에서 운영 마이그레이션을 실행하지는 않았다. 파일이 있다는 이유만으로 운영에도 새 테이블이 있다고 가정하지 않는다.

## 3. 지금 작성된 기능과 정확한 검증 범위

| 영역 | 현재 소스 상태 | 확인된 근거 / 남은 검증 |
| --- | --- | --- |
| 사용자 문의 접수 | 로그인·비회원 접수, 제목·분류·내용, 본인 신청/식탁 연결 | SQLite·PostgreSQL API 테스트 |
| 사용자 답변 확인 | `/support` 목록·대화·추가 질문·해결 후 평가 | 공개 API에 내부 메모가 없음을 테스트. 실제 브라우저 검증은 남음 |
| 공동 문의함 | `/admin/inbox`, 미배정·내 담당·안 읽음·상태·분류·검색 | API 협업 시나리오 테스트, 시각 검증은 남음 |
| 협업 | 담당자, 내부 메모, 상태/태그/우선순위/후속 확인시각, 처리 이력, 열람·작성 presence | 3인 API 흐름과 오래된 버전 409·중복 메시지 방지 테스트 |
| 운영 설정 | 운영자 표시 이름·색상·활성 상태, 총괄 인수인계, 답변 템플릿, 개선 과제 상태 | 소유자 권한 제한 일부 테스트. 동시 인수인계 추가 테스트 권장 |
| 매칭 기조 | 균형/공감·취향/새로운 발견/편안한 대화 4개 | 기조에 따라 다른 조합이 나오는 이력 fixture 테스트 |
| 매칭 미리보기 | 네 정책 비교, 스냅샷 해시, 참고 점수·변경 자리 수·구성·설명 | 반복 실행 결정성, 예약·알림 등 부수 효과 없음 확인 |
| 정책 적용 | 변경된 후보면 409, 회차별 적용, 총괄 기본값·새 버전 생성 | 실제 자동 매칭의 정책/구성이 미리보기와 맞는 단일 회차 테스트 |
| 후기 기반 개인화 | 소비 함수·저장 테이블과 제한된 점수 반영 틀만 작성 | **후기 저장→선호/신호 생성→분석 UI는 미구현** |
| 디자인 | 새 공통 토큰·사이드바·모바일 탐색·문의/스튜디오 CSS | 빌드 통과. 실제 화면·접근성·반응형 검증 미완료 |
| 운영 적용 | 이번 확장 미배포 | 전체 검증·백업·이행·실계정 구성 필요 |

현재 통과 테스트만 보고 전체 제품이 완성됐다고 판단하지 않는다. 특히 후기 학습과 통합 시연은 아직 완료되지 않았다.

## 4. 파일 지도 — 무엇을 어디서 수정하는가

### 4-1. 공동 문의함

| 파일 | 역할 |
| --- | --- |
| `lib/support-domain.ts` | 클라이언트에도 import 가능한 분류/상태 한글명 |
| `lib/support.ts` | 문의 소유권, 조회, 접수, 메시지, 변경 이력, presence, 읽음, 개선 과제 연결 |
| `lib/operators.ts` | 활성 운영자 인증, JSON 파싱, 에러 응답 공통 함수 |
| `app/api/support/route.ts` | GET 목록 / POST 접수, 비회원 쿠키 발급, 접수 제한 |
| `app/api/support/[id]/route.ts` | GET 상세 / POST 업무 액션 |
| `components/support-workspace.tsx` | 사용자 문의함과 운영자 공동 문의함 UI |
| `app/support/page.tsx` | 사용자·비회원 문의 페이지 |
| `app/admin/inbox/page.tsx` | 관리자 문의 페이지 |

비회원 소유권은 무작위 `todaytable_support` HttpOnly 쿠키로 검증하고 DB에는 토큰 해시만 저장한다. 현재는 같은 브라우저에서 조회할 수 있다. **이메일 소유 확인·다른 브라우저에서의 복구·이메일 알림은 구현하지 않았다.** 이메일 문자열만 같다는 이유로 다른 계정에 문의를 연결해서는 안 된다.

### 4-2. 운영자와 설정

- `scripts/provision-operators.ts`: 기존 활성 ADMIN을 유지하면서 부족한 수만 생성해 총 3개의 운영자 프로필을 구성한다. 3명을 초과하면 멈춘다. 기존 비밀번호를 덮어쓰지 않는다.
- `app/api/admin/team/route.ts`: 운영자·템플릿·개선 과제 조회/변경 API.
- `components/operator-settings.tsx`, `app/admin/team/page.tsx`: 설정 화면.
- 신규 계정 비밀번호는 로컬 `.data/new-operator-credentials.json`에 0600 권한으로 저장한다. 문서에 비밀번호를 복사하지 않는다.

현재 로컬 구성은 운영자 A=`operator@todaytable.local`(OWNER), 운영자 B=`admin@todaytable.local`(OPERATOR), 운영자 C=`operator3@todaytable.local`(OPERATOR)다. 이 구성을 운영 계정 구성으로 그대로 가정하지 않는다.

### 4-3. 매칭

| 파일 | 역할 |
| --- | --- |
| `lib/matching.ts` | 조합 탐색·필수 조건·점수. 선호/신호 보조 필드와 큰 cohort 후보 점수 비교 추가 |
| `lib/matching-policy.ts` | 정책 선택, 후보 스냅샷, 선호 보강, 정책 평가, 매칭 이유 |
| `lib/lifecycle-service.ts` | 실제 매칭 실행. `runMatching()`이 위 정책 로더를 사용하도록 연결됨 |
| `app/api/admin/matching-studio/route.ts` | 정책·회차·실행 기록 조회 / 비교·적용·기본값·새 버전 |
| `components/matching-studio.tsx` | 기조 카드·비교·적용·고급 설정·실행 이력 |
| `app/admin/matching/page.tsx` | 새 스튜디오 페이지 |

기존 `app/api/admin/matching-rules/route.ts`와 `AdminMatchingView`는 남아 있다. 새 정책이 선택된 상황에서는 기존 숫자 규칙을 바꿔도 실제 매칭에 적용되지 않을 수 있다. 재개 후 이 중복 경로를 정리해야 한다.

### 4-4. 후기·참가자 여정 — 다음에 주로 수정할 파일

- `app/api/tables/[id]/feedback/route.ts`: 기존 후기 저장. 새 `feedback_details`, `participant_preferences`, `preference_signals`에 아직 쓰지 않는다.
- `components/journey-pages.tsx`: 기존 `FeedbackView`, `HistoryView`, `HomeJourney`가 들어 있다.
- `app/api/tables/[id]/route.ts`: 식탁 상세·참석·기존 후기 여부.
- `app/api/journey/route.ts`: 홈/신청/이력/알림 데이터.
- `worker/index.ts`: 후기 요청·후속 알림 등 예약 작업.
- `/admin/insights`: 아직 파일이 없다. 사이드바에서는 “준비 중”으로 비활성 표시해 404 링크를 만들지 않았다.

### 4-5. 공통 디자인

- `components/site-nav.tsx`: 관리자 사이드바·상단바, 사용자 메뉴·모바일 도크·문의 버튼.
- `components/journey-ui.tsx`: `JourneyLayout`과 참가 신청 카드. 새 nav 연결 및 신청별 문의 링크 추가.
- `components/top-nav.tsx`: 기존 서버 페이지에서 새 nav를 쓰는 어댑터.
- `app/evolution.css`: 이번 확장용 디자인 CSS. `app/layout.tsx`에서 기존 CSS 뒤에 import한다.
- `app/globals.css`: 기존 스타일. 새 스타일과 충돌할 가능성이 있으므로 실제 화면 확인이 필요하다.

서버 전용 `lib/support.ts`는 Node crypto·DB를 import한다. 클라이언트에서 분류 이름을 쓰려고 이 파일을 import하지 말고 `lib/support-domain.ts`를 사용한다.

## 5. 신규 DB 구조와 이행 방법

두 provider에 같은 번호로 파일이 존재한다.

| 마이그레이션 | 내용 |
| --- | --- |
| `014_product_evolution.sql` | 모의 플래그, 운영자, 문의·메시지·이력·읽음·presence·템플릿·개선 과제, 매칭 정책·미리보기·회차 정책, 후기 상세·개인 선호·신호·제품 이벤트 |
| `015_support_delivery.sql` | 접수 request_key 고유 인덱스, IP 해시 기반 접수 제한 저장 |
| `016_support_ordering.sql` | 문의 메시지 ordinal. 초 단위 timestamp가 같아도 대화 순서를 유지 |
| `017_matching_presets.sql` | 최초 4개 불변 정책과 기본 균형형 설정 |

명령:

```bash
npm run db:migrate
node --env-file-if-exists=.env.local --import tsx scripts/provision-operators.ts
npm run typecheck
```

주의:

- 실행은 `.env.local` 또는 환경변수가 가리키는 DB에 적용된다. DB provider와 대상이 개발인지 먼저 확인한다.
- 이행 이력 테이블은 `schema_migrations(name, applied_at)`이다. 파일 번호와 실제 기록을 비교한다.
- 이미 적용된 SQL을 수정해 기존 DB가 따라올 것이라고 생각하지 않는다. 이후 스키마 변경은 018 이후 새 파일로 작성한다.
- 017은 새 기본 정책을 설정한다. 기존 0.4/0.25/... 규칙과 비중이 다르므로 운영 전 총괄과 기본 정책을 확정하고 변화량을 검증한다.
- 신규 JSON 성격의 컬럼은 일부가 TEXT다. PostgreSQL JSONB라고 가정하지 말고 `parseJson()`으로 파싱한다.
- `lib/db.ts`가 SQLite의 bool·날짜·일부 JSON 필드를 정규화한다. 새 필드 추가 시 양 provider의 API 응답 타입이 같은지 테스트한다.

## 6. API를 실제로 호출하는 방법

로그인 세션 쿠키와 같은 출처 요청이 기본이다. 운영자 API는 ADMIN만으로 충분하지 않고 활성 `operator_profiles` 행이 필요하다.

### 6-1. 문의 접수

`POST /api/support`

```json
{
  "subject": "매칭 안내가 언제 오나요?",
  "category": "MATCHING",
  "body": "마감 이후 안내 시점이 궁금해요.",
  "requestKey": "매 접수마다 생성한 UUID",
  "applicationId": "로그인 사용자의 신청 UUID — 없으면 생략",
  "name": "비회원 이름",
  "email": "guest@example.com"
}
```

- 정상 생성: 201과 `{id, created:true}`.
- 같은 소유자의 동일 requestKey 재요청: 200, 중복 생성하지 않음.
- 다른 사람 신청을 연결: 403.
- 비회원은 응답 Set-Cookie를 이후 목록/상세 요청에도 보낸다.
- 현재 웹 작성 폼은 로그인 상태면 이름/이메일을 서버의 계정 정보로 처리한다.

### 6-2. 사용자가 답변 확인

1. `GET /api/support`로 본인 문의만 받는다.
2. `GET /api/support/{id}`로 공개 메시지를 받는다.
3. `POST /api/support/{id}`에 `{"action":"READ"}`를 보내 읽음 처리한다.
4. 같은 주소에 아래 메시지를 보내 추가 질문한다.

```json
{
  "action": "MESSAGE",
  "kind": "PUBLIC",
  "body": "한 가지 더 궁금해요.",
  "version": 3,
  "requestKey": "메시지별 UUID"
}
```

서버가 보내준 `ticket.version`을 사용한다. 임의로 0을 계속 보내면 충돌한다. 오래된 버전은 409이며 최신 내용을 보여주고 작성 중인 텍스트를 보존해야 한다. `INTERNAL`은 운영자 전용이며 사용자 상세 응답에 포함되지 않는다.

### 6-3. 운영자 업무

동일한 `/api/support/{id}` POST 액션:

| action | 추가 값 |
| --- | --- |
| `UPDATE` | `version`, `status`, `category`, `priority`, `assigneeId`, `tags`, `nextFollowupAt` |
| `MESSAGE` | `version`, `kind: PUBLIC 또는 INTERNAL`, `body`, `requestKey` |
| `PRESENCE` | `composing: true/false` |
| `IMPROVEMENT` | 새 과제 `title` 또는 기존 `itemId` |
| `HELPFUL` | 해결된 문의의 사용자만 `helpful: true/false` |

메시지 전송과 접수의 requestKey는 **성공이 확인될 때까지 유지**한다. 네트워크 오류마다 바꾸면 중복 방지가 무력화된다.

### 6-4. 매칭 스튜디오

`GET /api/admin/matching-studio` → policies/defaults/events/runs/me.

`POST /api/admin/matching-studio`:

```json
{"action":"PREVIEW","eventId":"회차 UUID"}
```

응답 `id`를 보관한다. 결과에는 네 정책별 확정 가능 인원, 미매칭, 구성, 점수, 기존안 대비 변경 자리 수가 있다.

```json
{"action":"APPLY","previewId":"앞서 받은 id","policyId":"affinity-v1"}
```

- 후보·선호·회차 정보가 바뀌면 해시가 달라져 409가 된다. 미리보기를 다시 실행한다.
- 이미 확정 식탁이 있는 회차는 409. 확정된 사람을 기조 선택만으로 바꾸지 않는다.
- 적용은 회차 정책 저장과 마감 매칭 작업 예약까지다. 즉시 참가자를 배치하거나 안내하지 않는다.
- `DEFAULT`는 총괄만 `policyId`와 현재 `matching_defaults.version`으로 바꾼다.
- `CUSTOM_POLICY`는 총괄만 새 버전을 생성한다. 기존 정책 UPDATE가 아니다. 가중치 다섯 개의 합계는 1이다.

## 7. 검증 기록과 재실행 명령

### 7-1. 이번 중단 정리에서 확인한 것

- `npm run typecheck`: 통과.
- `TODAYTABLE_IN_PROCESS_TYPESCRIPT=1 npm run build`: 컴파일·타입·정적 페이지 생성 통과. `/support`, `/admin/inbox`, `/admin/team`, `/admin/matching` 및 API가 빌드 목록에 포함됨.
- `node --import tsx tests/evolution.test.ts`: SQLite의 부모 테스트+5개 하위 시나리오, 총 6개 통과.
- `TEST_PRODUCT_DATABASE_URL=postgres://tt_test@127.0.0.1:55439/todaytable_test node --import tsx tests/evolution.test.ts`: 격리 PostgreSQL 스키마에서 같은 6개 통과.
- 전체 `npm test`는 최종 재실행 결과를 문서 마지막의 검증 보충에 기록한다.
- **새 화면을 실제 브라우저로 클릭/캡처한 검증은 하지 않았다.** 과거 모의 운영 화면의 브라우저 검증과 혼동하지 않는다.

### 7-2. 정상 검증 명령

```bash
npm run typecheck
npm test
node --import tsx tests/evolution.test.ts
TEST_PRODUCT_DATABASE_URL=postgres://tt_test@127.0.0.1:55439/todaytable_test node --import tsx tests/evolution.test.ts
TODAYTABLE_IN_PROCESS_TYPESCRIPT=1 npm run build
git diff --check
```

- `TEST_PRODUCT_DATABASE_URL`은 새 기능 테스트의 변수다. 기존 PostgreSQL 전체 통합 테스트의 `TEST_DATABASE_URL`과 이름이 다르다.
- 테스트는 `127.0.0.1`이고 DB 이름이 `_test`로 끝나는 대상만 허용한다. 운영 DB URL을 넣지 않는다.
- 테스트가 만드는 `tt_evolution_*` 스키마는 종료 시 삭제된다.
- 로컬 테스트 PostgreSQL 서버가 없으면 먼저 `pg_isready -h 127.0.0.1 -p 55439`로 확인하고 별도 테스트 서버를 준비한다. 운영 DB를 대체재로 사용하지 않는다.
- 테스트 fixture의 과거 만남은 두 그룹 모두 이력을 넣어야 `공감·취향형`과 `새로운 발견형`의 차이가 확실히 나온다. 이전에 한 그룹만 이력을 넣은 fixture는 결과가 같아 검증에 부족했다.

## 8. 재개하면 가장 먼저 해결할 구체적인 문제

### 8-1. 모의 데이터의 생성 시점 표시 누락 — 후기 학습보다 먼저 해결

014는 기존 `[모의]` 행사와 연결된 신청/후기를 일괄 표시한다. 하지만 현재 `scripts/seed-operations.ts`는 **새 행을 INSERT할 때 is_demo를 명시하지 않는다.** 새 DB에서 014 적용 후 시드를 돌리면 가상 데이터가 false가 될 수 있다.

수정 순서:

1. `scripts/seed-operations.ts`의 users/events/applications/journey_feedback INSERT에 `is_demo=true`를 넣는다.
2. `lib/source-data.ts`의 명시적 데모 변환에도 해당 users/events/applications 플래그를 넣는다.
3. `tests/source-data.test.ts`의 마이그레이션 목록이 013까지 하드코딩되어 있으므로 전체 SQL 파일을 읽는 방식으로 바꾼다.
4. 모의 행사에 실제 사용자가 새 신청하는 경우도 신청이 `is_demo=true`인지 처리한다. `lib/application-service.ts`를 수정한다.
5. 후기의 모의 여부는 작성한 사용자 이메일만으로 판단하지 말고 행사·신청 출처에서 결정한다.
6. 신호 집계와 운영 성과 쿼리는 `is_demo=false`와 실제 참석 조건을 함께 적용한다.
7. 새 DB에서 마이그레이션→시드→조회 테스트로 가상 데이터가 실제 학습에 들어가지 않음을 확인한다.

### 8-2. 매칭 실행/재배치 정책 경로 불일치

`runMatching()`은 새 정책을 읽지만 `repairTable()`은 아직 기존 `matching_rules` 가중치를 읽는 경로가 있다.

1. `repairTable()`이 선택한 대상 회차의 유효 정책을 읽게 한다.
2. 대체 회차로 이동한다면 그 회차 정책을 적용하고, 실행 스냅샷에 정책 ID·가중치·학습 여부를 남긴다.
3. 최초 매칭과 재배치에서 같은 선호 보강·필수 조건을 사용하게 한다.
4. 두 회차에 다른 정책이 적용된 채 후보들이 여러 회차에 동의한 경우를 추가 검증한다. 현재 비교/실행의 연결 컴포넌트는 하나의 정책으로 계산하므로 회차별 정책 충돌을 명확히 처리해야 한다.
5. 미래 회차의 날짜를 미리보기 때문에 실제로 조기 확정하지 않게 한다.

### 8-3. 구 규칙 편집 경로

`/api/admin/matching-rules` PUT으로 저장한 값과 새 스튜디오의 실제 정책이 달라질 수 있다. 구 UI/엔드포인트를 없애거나 새 불변 정책 생성으로 연결하고, 사용자가 무효한 설정을 저장했다고 믿지 않게 한다. 계약 테스트도 바꾼다.

### 8-4. 문의함의 UI 마무리

- 현재 READ는 상세 마운트 시 처리한다. 열린 대화에서 새 답변을 읽었을 때 읽음 갱신이 필요하다.
- 운영자 자신이 공개 답변을 보낸 뒤 미읽음 배지가 남는지 확인하고, 마지막으로 확인한 공개 메시지를 기준으로 조정한다.
- 이력에는 상태·분류뿐 아니라 담당자·태그·우선순위·후속 시각의 실제 변경 내용을 읽기 쉽게 보여준다. DB details에는 before/after 일부가 저장되지만 현재 화면 표시는 단순하다.
- 인앱 알림은 현재 문의 접수 번호를 포함한 텍스트다. 알림에서 `/support?id=...`를 직접 여는 동작을 추가하려면 안전한 action URL/관련 엔티티 필드를 확장한다.
- 모바일 운영 화면에서 사이드바가 숨겨지면 문의/매칭/설정 사이에 이동할 수 있는 메뉴가 충분한지 검증한다.
- `support-workspace.tsx`의 커지는 컴포넌트는 목록/대화/관리 패널로 나누고 변경 중 입력 값이 폴링으로 사라지지 않게 한다.
- 개선 과제 연결과 응답 템플릿은 있으나 자동 분류·요약·AI 답변은 없다. 후속 범위이며 현재 완료로 표기하지 않는다.
- 상태에 맞지 않는 매칭 안내 템플릿이 이미 확정된 참가자에게 쓰이지 않게 문구/변수를 보완한다.

## 9. 남은 구현을 순서대로 끝내는 작업 명세

아래 순서대로 진행한다. 각 항목의 완료 조건을 확인하기 전 다음 항목을 “완료”로 바꾸지 않는다.

### 작업 A — 현재 기능의 브라우저 마무리

대상: `components/support-workspace.tsx`, `components/site-nav.tsx`, `components/operator-settings.tsx`, `components/matching-studio.tsx`, `app/evolution.css`.

1. 격리된 개발 DB에 이행하고 운영자 3인·참가자 2인의 테스트 계정을 준비한다.
2. 각 운영자는 별도 브라우저 context로 로그인한다.
3. 참가자가 문의를 생성한다.
4. A가 담당 배정, B가 내부 메모, C가 공개 답변한다.
5. 참가자가 웹 문의함에서 공개 답변을 확인하고 추가 질문한다. 내부 메모 문구가 DOM/네트워크 응답 어디에도 없어야 한다.
6. 같은 문의를 두 운영자가 오래된 버전으로 답변하면 한쪽이 409를 받고 작성 내용을 잃지 않아야 한다.
7. 390px 모바일과 1440px 데스크톱에서 캡처한다. 가로 넘침, 포커스 누락, 검색/필터, 버튼 비활성 상태를 점검한다.
8. 스튜디오에서 네 정책을 비교하고 후보 변화 후 적용이 거절되는지, 확정 식탁은 보호되는지 확인한다.

완료 기준: 네트워크/브라우저 콘솔 오류 없이 위 시나리오가 실제 UI에서 통과하고 캡처가 남는다.

### 작업 B — 후기 API를 확장

대상: `app/api/tables/[id]/feedback/route.ts`, 필요하면 새 `lib/feedback-service.ts`와 `lib/feedback-domain.ts`.

1. 클라이언트/서버가 공유할 태그와 분위기 상수를 정한다. 예: 공통 관심사, 편안한 대화, 깊은 대화, 새로운 관점 / 관심사 불일치, 대화 속도, 식당 소음, 시간·안내.
2. 후기 GET을 추가해 본인이 저장한 점수·좋았던 점·아쉬웠던 점·다음 희망을 다시 불러온다.
3. POST는 기존의 점수·재참여 의향·멤버 선호 계약을 유지하면서 새 항목을 저장한다.
4. 테이블 소유권, 행사 종료, 실제 참석 기록을 같은 트랜잭션에서 검사한다. `SCHEDULED`나 `NO_SHOW`만 있는 참가자가 실제 참석 후기를 남길 수 없게 한다.
5. 점수 1~5 정수, 태그 허용값, 텍스트 길이, 자기 자신을 상대 선호로 고르지 못하는 규칙을 검사한다.
6. 기존 `journey_feedback` upsert가 반환하는 실제 feedback ID로 `feedback_details`를 upsert한다. 수정할 때 불필요한 새 후기 ID를 만들지 않는다.
7. 긍정/아쉬운 텍스트, 구조 태그, 다음 분위기·관심사, 선호 확인 여부, is_demo를 기록한다.
8. `confirmed=true`라고 참가자가 명시한 다음 선호만 `participant_preferences`에 저장한다. 출처 feedback ID와 수정 시각을 남긴다.
9. 모의 후기의 저장/시연은 가능하되 실제 개인화 선호·신호에는 반영하지 않는다.
10. 기존 DISLIKE 갱신이 여러 회차의 다른 명시적 제외를 잘못 해제하지 않는지도 검증한다. 해제 정책을 정의하고 출처를 추적한다.

완료 기준: 본인 저장/재조회/수정, 타인 차단, 종료 전 차단, 노쇼 차단, 모의 제외, 입력 검증을 SQLite와 PostgreSQL에서 통과한다.

### 작업 C — 후기에서 신호 만들기

대상: 새 후기 서비스/집계 함수, `lib/matching-policy.ts`, `worker/index.ts`.

1. `preference_signals`를 실제로 생성하는 함수를 만든다. 지금은 읽는 함수만 있다.
2. 기본 자료는 실제 참석 + 비모의 + 해당 시점 이전에 작성된 후기다.
3. 식당 소음·음식 만족도는 식당 개선으로 분리한다. 그것만 낮다고 사람 궁합을 낮추지 않는다.
4. 관심사/대화 관련 긍정 태그와 충분한 대화 만족도가 함께 있는 기록에서만 보조 신호를 만든다.
5. 원문을 무조건 AI로 해석하지 말고 구조 태그·확인된 선호를 우선한다.
6. 최소 표본 수 3개부터 보조 신호를 사용한다. 현재 소비 코드는 `evidence_count>=3` 조건이다. confidence 계산식과 최대 영향도를 문서화한다.
7. 현재 `pairScore()`는 신호 영향을 최대 약 10%로 제한하는 틀이 있다. 분위기 항목도 성향 가중치에 영향을 주므로 전체 영향을 검증한다.
8. 후기 수정·삭제·참석 정정 시 같은 집계가 재계산되게 한다. 작업을 재실행해도 같은 신호가 되어야 한다.
9. 워커로 처리한다면 job key와 job_effects가 “같은 후기의 두 번째 수정”을 차단하지 않게 버전/콘텐츠 해시를 설계한다.
10. 개인화 끄기/명시 선호 수정·철회 동작을 제공하고 반영 여부를 테스트한다.

완료 기준: 동일 자료 재집계 결과 동일, 2개 후기에서는 보조 신호 미적용, 3개 이상에서 제한적으로 반영, 가상·노쇼·식당 전용 불만 신호 제외, 필수 조건 위반 0건.

### 작업 D — 후기 작성 화면과 참가자 홈

대상: `components/journey-pages.tsx`, `app/api/journey/route.ts`, `app/api/tables/[id]/route.ts`.

1. 기존 한 화면의 긴 후기 폼을 경험 점수 → 좋았던/아쉬웠던 점 → 다음 희망 정도의 짧은 단계로 정리한다.
2. 저장된 후기는 GET으로 불러오고 수정이 가능해야 한다. 저장 완료와 오류 상태를 분명히 표시한다.
3. `app/api/tables/[id]/route.ts`가 실제 사용자 ID·후기 적격성·행사 종료 상태를 제공하게 한다. 현재 `MemberChoices`에서 기대하는 currentUserId가 상세 응답에 없어 자기 선택이 가능해지는 부분을 점검한다.
4. 홈에 다가오는 식탁, 배정 이유, 남길 후기, 새 문의 답변 같은 다음 행동을 우선 표시한다.
5. `/history`가 미래 식탁을 “지난 식탁”으로 표시하지 않게 API와 UI를 수정한다. 현재 journey의 history 쿼리는 미래를 걸러내지 않는다.
6. 이미 작성한 후기에는 “수정하기”, 작성 전 실제 참석에는 “후기 남기기”, 노쇼에는 적절한 안내를 표시한다.
7. 다음 추천은 마감되지 않은 동의 가능한 회차로 연결한다. 실제 클릭 가능한 신청 동선이 있어야 한다.

완료 기준: 참석→행사 종료→후기 요청→작성→저장된 내용 재조회→다음 선호 반영을 사용자가 웹에서 끝까지 수행한다.

### 작업 E — 운영자 후기 인사이트

신규 대상: `/api/admin/insights`, `/admin/insights`, 관련 UI.

1. `requestOperator()`를 사용해 권한을 검사한다.
2. 전체/실제/모의 데이터 구분과 기간 필터를 제공한다. 실제 운영 개선 지표의 기본값은 실제 데이터다.
3. 정책 버전별 식탁 수, 실제 참석 수, 후기 수·응답률, 대화/식당 만족도, 재참여 의향과 실제 재신청을 따로 집계한다.
4. “재참여 의향”을 “실제 재방문율”로 표기하지 않는다.
5. 긍정 태그와 불편 태그를 분리하고 반복 문의 카테고리/개선 과제와 연결한다.
6. 정책별 차이는 표본 수와 기간을 함께 표시한다. 서로 다른 참가자 집단의 평균 차이를 인과적 개선으로 단정하지 않는다.
7. 최신 후기의 원문은 필요한 운영자 범위에서만 보인다. 다른 참가자의 멤버 선호/신고 사유를 사용자 화면에 공개하지 않는다.
8. 충분한 자료가 없으면 “아직 비교할 자료가 부족해요”로 표시한다. 모의 숫자로 실제 성과를 채우지 않는다.
9. 사이드바의 비활성 인사이트 항목을 실제 링크로 전환한다.

완료 기준: 데이터가 없을 때·모의만 있을 때·실제가 섞였을 때 모두 정직하게 표시되고, 같은 fixture를 직접 SQL로 계산한 값과 API 집계가 일치한다.

### 작업 F — 디자인 완성

1. 크림/브라운/세이지 무드를 유지한다. 무드 유지 요청보다 외부 스킬의 기본 미감을 우선하지 않는다.
2. `app/evolution.css`와 기존 CSS의 우선순위 충돌을 정리한다. 헤더/모바일 도크/고정 문의 버튼이 폼이나 채팅 입력을 가리지 않아야 한다.
3. 실제 새 화면을 캡처해 글자 크기·여백·목록 밀도·3단 문의 화면을 조정한다.
4. 미구현/빈 상태가 버튼만 있는 것처럼 보이지 않게 한다. 메뉴의 준비 중 상태를 진짜 구현과 구분한다.
5. 새 랜딩은 아직 작성되지 않았다. 서비스 방식, 큐레이션 예시, 문의, 참가 동선을 연결한다. 가상 후기를 실제 고객 후기처럼 표시하지 않는다.
6. 키보드만으로 목록 선택·폼 전송·모달 닫기·필터 변경을 검증한다. focus, label, aria-live, 대비, reduced motion을 확인한다.

참고 자료:
- Channel Talk Inbox: https://docs.channel.io/help/en/articles/Inbox-User-Interface-c2d439c6
- Linear Customer Requests: https://linear.app/customer-requests
- frontend-design: https://github.com/anthropics/skills/tree/main/skills/frontend-design
- Web Interface Guidelines: https://github.com/vercel-labs/web-interface-guidelines

현재 외부 스킬을 설치한 상태는 아니다. 필요하면 내용을 읽고 적용하며, 사용자에게 적용 사실을 알린다.

### 작업 G — 최종 통합 검증과 운영 반영

1. 아래 10절의 인수 테스트를 SQLite와 격리 PostgreSQL에서 실행한다.
2. 프로덕션 빌드를 만들고 실제 브라우저에서 다시 검증한다.
3. 운영 DB의 테이블/행과 source 데이터 스냅샷을 백업한다. 기존 `.data/production-before-operations.json`은 이번 확장 전보다도 이전 시점의 public 스키마 스냅샷이다. 이것을 새 백업으로 대체했다고 주장하지 않는다.
4. 운영 계정의 기존 사용자·ADMIN·활성 프로필을 조회해 세 계정으로 매핑한다. 기존 비밀번호를 덮어쓰거나 기존 참가자를 삭제하지 않는다.
5. additive 마이그레이션을 적용하고, 웹과 워커를 같은 호환 코드 버전으로 배포한다. 단계 순서와 이전 버전 호환성을 사전에 확인한다.
6. 기본 매칭 정책을 승인된 운영 기준으로 설정하고, 확정 테이블이 바뀌지 않았는지 확인한다.
7. 실제 공개 URL에서 3인 문의 협업·참가자 답변 확인·매칭 기조·후기 시연을 수행한다. 실제 사용자에게 임의 메시지를 보내지 않고 테스트 계정/모의 회차를 사용한다.
8. 임시 세션·SSH 키·TCP proxy를 정리하고, 운영자 3개의 계정 전달 자료를 별도 보호 파일로 남긴다.
9. 배포 ID, 실행한 이행, 검증 결과, 남은 한계를 `docs/STATUS.md`에 기록한다.

## 10. 완료 여부를 판단하는 인수 테스트 목록

### 문의·협업

- [ ] 로그인 사용자가 문의 접수 후 목록과 상세를 다시 열 수 있다.
- [ ] 비회원은 원래 브라우저에서만 본인 문의를 볼 수 있다. 이메일 문자열만으로 다른 사람의 문의에 접근할 수 없다.
- [ ] A 배정 → B 내부 메모 → C 공개 답변 → 사용자 웹 확인 → 추가 질문이 실제 UI에서 연결된다.
- [ ] 사용자 네트워크 응답과 DOM 어디에도 내부 메모가 없다.
- [ ] 다른 참가자의 ID로 상세를 조회하면 404다.
- [ ] 메시지 요청 재전송은 1건으로 기록된다. 오래된 version은 409다.
- [ ] 분류·태그·담당·상태·우선순위·확인 시각이 저장되고 이력에 작성자가 남는다.
- [ ] 해결된 문의에 만족도 응답이 가능하고 추가 질문 시 다시 열린다.
- [ ] 새 답변을 웹 문의함과 인앱 알림으로 확인할 수 있다.

### 매칭

- [ ] 같은 자료/정책이면 미리보기 결과가 같다.
- [ ] 충분한 후보/만남 이력 fixture에서 기조 변경이 조합을 바꾼다.
- [ ] 미리보기가 결제·예약·채팅방·확정 알림을 만들지 않는다.
- [ ] 후보/선호/회차가 바뀌면 적용 전에 409로 재비교를 요구한다.
- [ ] 적용한 정책이 마감 자동 실행과 재배치에 실제 사용된다.
- [ ] 다중 회차·상이한 정책·동시 신청·수용 정원·기존 좌석과 시간 중복을 처리한다.
- [ ] 확정된 테이블은 정책 선택만으로 뒤섞이지 않는다.
- [ ] 이전 정책으로 돌아갈 수 있고 변경자가 기록된다.

### 후기·개선

- [ ] 행사 종료 후 실제 참석자가 후기를 저장/다시 읽기/수정할 수 있다.
- [ ] 타인·종료 전·노쇼의 실제 후기 작성은 거절된다.
- [ ] 긍정과 아쉬움이 구조화되어 저장된다.
- [ ] 사용자가 확인한 다음 선호가 다음 매칭에 반영된다.
- [ ] 모의 후기/원본 설문 추정값이 실제 학습과 개선 실적에 섞이지 않는다.
- [ ] 식당 점수만 낮다고 사람 궁합을 낮추지 않는다.
- [ ] 최소 표본 수와 제한된 영향도가 적용된다.
- [ ] 정책별 응답률·만족도·실제 재신청과 자료 부족 상태가 정확히 표시된다.

### 화면·운영

- [ ] 390px과 1440px 화면에서 문의/매칭/후기 주요 동작이 가능하다.
- [ ] 키보드·포커스·오류/로딩/빈 상태·중복 클릭이 처리된다.
- [ ] 새 기능의 production build와 PostgreSQL 통합 검증이 통과한다.
- [ ] 운영 웹/워커/DB 이행이 같은 호환 버전에 맞춰져 있다.
- [ ] 기존 계정·원본 설문·기존 신청/결제가 보존된다.
- [ ] 임시 접근 수단을 정리하고 테스트 계정/배포 링크/근거를 남긴다.

## 11. 배포 시 알아둘 실제 환경 문제

- `APP_URL`은 반드시 `https://todaytable-production.up.railway.app`처럼 올바른 공개 origin이어야 한다. 내부 컨테이너 호스트로 logout redirect하던 문제를 이미 수정했다. 회귀시키지 않는다.
- 웹은 Docker standalone `node server.js`, 워커는 `node --import tsx worker/index.ts`를 사용한다.
- `railway.worker.json`을 워커 업로드 폴더의 `railway.json`으로 복사해 사용했다. 웹용 `/` HTTP healthcheck를 포트 없는 워커에 적용하지 않는다.
- Railway API에서 사용자 지정 Config as Code 경로 변경이 거절된 이력이 있다. 실제 CLI/API 상태를 확인하며 작업한다. 설정 경로가 저장됐다고 추정하지 않는다.
- `.data/`·`.env*`·DB 백업을 업로드하지 않는다. 배포 아카이브에 우연히 추가된 스크린샷이나 무관한 파일이 포함되지 않게 한다.
- 과거 원격 TCP 경유로 수백 개 INSERT를 순차 실행한 시드는 시간이 초과되어 롤백됐다. 큰 작업은 검증된 스크립트를 서버 내부에서 실행하는 것이 좋다.
- 임시 SSH 키·TCP proxy는 현재 남겨둔 운영 기능이 아니다. 필요하면 새로 만들고 끝나면 삭제한다.

## 12. 다음 개발자에게 그대로 줄 수 있는 재개 지시문

> `/home/ubuntu/projects/todaytable/docs/IMPLEMENTATION_HANDOFF.md`와 `docs/PRODUCT_EVOLUTION_PLAN.md`, AGENTS.md를 먼저 읽어라. 기존 미커밋 작업을 지우지 말고 현재 소스를 검증한 뒤 이어가라. 공동 문의함과 매칭 스튜디오는 로컬 구현/일부 통합 테스트까지만 되어 있고 운영에는 배포되지 않았다. 먼저 8절의 모의 데이터 표시 누락·정책 경로 불일치·문의함 UI 문제를 해결하고, 9절의 후기 API→신호 집계→참가자 동선→인사이트→디자인→통합 검증 순서로 완성하라. 사용자가 반드시 웹사이트 안에서 본인 문의와 답변을 재조회할 수 있어야 하며, 내부 메모는 절대 노출하지 말라. 가상 후기를 실제 학습 데이터나 개선 실적에 섞지 말라. 10절 체크리스트의 각 항목을 실제 소스·테스트·브라우저·운영 실행 근거로 검증한 뒤에만 전체 완료라고 보고하라.


## 13. 최종 검증 보충

- 최종 `npm test`: 총 33개 중 28개 통과, 5개 PostgreSQL URL 미설정 skip, 실패 0개.
- 새 기능의 PostgreSQL 검증은 위 전체 테스트 skip과 별도로 `TEST_PRODUCT_DATABASE_URL`을 설정해 격리 스키마에서 실행했다. 총 6개 시나리오가 통과했다.
- 최종 타입 검사와 `git diff --check` 통과.
- 최종 `TODAYTABLE_IN_PROCESS_TYPESCRIPT=1 npm run build`: 컴파일·타입 검사·페이지 생성까지 통과. 새 UI의 실제 브라우저 검증은 아직 수행하지 않았다.
- 이번 정리에서 Git commit/push, Railway 배포, 운영 DB 이행·운영 계정 변경은 하지 않았다.
