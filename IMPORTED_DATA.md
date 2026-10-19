# 제공 데이터 적재와 가상 운영

## 2026-10-19 전체 활용

사용자 요청에 따라 294행 모두를 가상 참가자로 연결했습니다. 원본 보관 영역은 수정하지 않았습니다. 지난 만남 105명·만남 예정 98명·신청 중 91명이며, 연락처 없는 합성 계정과 MOCK 결제·예약을 사용합니다. 기존 체험 계정에는 세 상태를 함께 확인할 수 있는 신청을 추가했습니다. `029_showcase_lifecycle.sql`과 `scripts/populate-lifecycle-showcase.ts`가 원본 행별 연결·가정·활성 배치를 관리합니다. 상세 설계와 GitHub 스킬은 [화면·가상 운영 개편](docs/EXPERIENCE_REDESIGN_20261019.md)에 있습니다.

## 최초 원본 적재 — 2026-10-17

대상은 `files/우연한식탁_가상데이터.xlsx`의 `설문지 응답 시트1`이다. Railway production의 앱이 사용하는 PostgreSQL에 원본 XLSX와 응답 294건을 저장했다. 웹 애플리케이션 재배포는 하지 않았다.

- 원본 파일 SHA-256: `8c6fc783e9dab9e047f5bc6fe0667e521cf44951808e56f49f3fe6eaf3e54a7a`
- 헤더: Excel 2행, 17열. 응답: 3–296행, 294건.
- 서로 다른 가명 문자열 258개, 남 응답 95건, 여 응답 199건.
- MBTI 확인 대상 15건과 중복 후보 218·271행을 삭제·추정 수정 없이 보존했다.
- 타임스탬프·연락처·Instagram·직업 공란을 그대로 유지했다. 나이를 출생연도로, 연도 없는 날짜를 특정 연도 회차로 변환하지 않았다. 참가권 선택을 결제 완료로 바꾸지 않았다.

## 저장 위치

`provided_data.datasets`는 원본 XLSX 파일(bytea), 파일명, SHA-256, 열 제목·검증 집계(manifest)를 보관한다. `provided_data.survey_responses`는 원래 시트명·행 번호와 17열 전체 값(`raw_values`), 원본 필드명 매핑(`fields`), 확인 사항(`issues`)을 보관한다.

파일 체크섬과 시트·행 번호를 기본키로 사용하므로 동일 원본을 다시 가져와도 중복 행을 추가하지 않는다. 동일 내용인 두 응답도 원래 행 번호가 다르므로 모두 보존한다. 실제 사용자·프로필·신청·결제 테이블과 구분한 원본 보관이며, 최초 적재 시에는 웹의 신청·매칭 목록에 노출하지 않았다. 이후 사용자 요청에 따라 위의 별도 가상 운영 배치로 연결했다. 원본은 계속 보존한다.

```sql
SELECT filename, manifest->>'record_count' AS source_rows
FROM provided_data.datasets;

SELECT sheet_row, fields, issues
FROM provided_data.survey_responses
ORDER BY sheet_name, sheet_row;
```

## 재현과 검증

```sh
python3 scripts/prepare_source_data.py
python3 -m unittest discover -s tests -p test_source_data.py
node scripts/import_provided_data.mjs          # 대상과 행 수 미리보기
node scripts/import_provided_data.mjs --apply  # Railway production 적재 및 검증
```

로컬 SQLite에서 운영자 화면의 검색·검토·데모 변환을 확인하려면 마이그레이션 후 별도 스테이징 테이블에 적재한다. 이 경로는 `provided_data` 원본 스키마와 같은 응답 키를 유지하며, 프로덕션 적재를 실행하지 않는다.

```sh
npm run db:migrate
python3 scripts/prepare_source_data.py
node --env-file-if-exists=.env.local --import tsx scripts/import_source_data_sqlite.ts .data/provided-data-import.json
```

`/admin/source-data`는 운영자만 접근한다. 응답 상세에서 가정 내용을 확인하고 synthetic demo 전용 매칭 동의를 선택한 뒤 한 행씩 변환한다. 변환 레코드는 원본 체크섬·시트·행 키로 중복을 막는다. 변환된 synthetic demo는 상세 화면에서 제거할 수 있다. 나이는 2026년 기준으로 `2026 - age` 출생연도를 만들고, 날짜의 월/일은 2027년 19:00 KST로 매핑한다(날짜가 없으면 2027-12-31). 날짜와 첫 지역이 같은 응답은 `DEMO ONLY`라는 이름의 닫힌 이벤트를 공유해 매칭 테스트 cohort를 만든다. 결제는 운영자가 직접 변환을 실행한 경우에만 MOCK/PAID로 생성되며 실제 입금은 없다. 참가권은 데모 가격표(1회 8,000원, 3회 15,000원, 4회는 앱 한도에 맞춰 3회·18,000원)를 적용한다. 원본 연락처·Instagram·가명·동의 응답은 생성 계정에 복사하지 않는다. 동의 checkbox는 생성된 synthetic identity에만 매칭용 동의를 설정한다.

Python 표준 라이브러리로 원본을 읽는다. importer는 별도 `db/imports/provided_data.sql`로 source 전용 스키마를 관리하며 앱 lifecycle 마이그레이션 006–011을 실행하지 않는다. 트랜잭션 안에서 모든 응답 필드를 DB와 다시 대조하고 저장된 XLSX 바이트의 SHA-256도 확인한 후 commit한다. 새 데이터셋 적재는 운영자 감사 로그에 남긴다. Railway 임시 SSH 키는 실행 후 등록 해제한다. 실행에는 Railway 계정 접근 권한이 필요하다.

운영 DB 최초 실행: insertedRows=294, storedRows=294. 재실행: insertedRows=0, storedRows=294. 두 실행 모두 원본 파일 체크섬과 모든 행·필드 일치 검증을 통과했다.
