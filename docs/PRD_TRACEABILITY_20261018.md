# PRD v0.2 요구사항 추적표

2026-10-19 보완·검증·배포 상태는 [릴리스 기록](RELEASE_20261019.md)과 [현재 현황](STATUS.md)을 함께 확인합니다. 아래 경로 목록은 요구사항별 구현 위치이며 실기기 푸시·실제 사용 시간·외부 결제의 성공 증거가 아닙니다.

기준 자료는 `files/우연한식탁_PRD.pdf` 전체, `files/우연한식탁_CTO_온보딩_오리엔테이션.pdf` 전체, `kickoff_summary.md`이다. 아래는 소스와 검증 위치를 연결하는 표다. 구현 파일이 있다는 사실과 실제 시나리오 검증을 구분한다. 최종 통합 실행 결과는 별도 검증 기록과 함께 읽는다.

사용자 지정 범위: 실제 돈 이동, PG 호출, 이메일 발송, 외부 식당 예약 요청은 연결하지 않는다. 결제 승인·실패·취소, 부분·전체 환불, 처리 실패·재시도는 내부 원장과 상태로 실행한다. PAY-01/03의 해커톤 허용 범위에 해당하며 PAY-04의 실제 PG 연동은 사용자 지시에 따라 대체한다. 운영 화면의 독립 참석/예외/작업/안전 메뉴는 제거하고 식탁 상세·문의함·운영 분석으로 통합한다.

표의 `구현`은 코드 경로 확인, `검증`은 명시한 자동화 테스트에서 해당 조건 확인을 뜻한다. 모바일 실제 완료 시간과 외부 발송 결과는 코드만으로 완료를 주장하지 않는다.

| ID | 우선순위 | 요구 | 구현 및 확인 위치 |
|---|---|---|---|
| ACC-01 | P0 | 로그인·가입 | `/login`, `/signup`, `app/api/auth/login`, `app/api/auth/register`; 간단 계정 로그인 허용 |
| ACC-02 | P0 | 기본 정보 수정 | `/profile/edit`, `/profile/test`, `lib/profile-validation.ts`, `app/api/profile` |
| ACC-03 | P0 | MBTI·관심사·성향·희망 성향 | `components/profile-test.tsx`, `lib/profile-test.ts`, 프로필 저장 및 매칭 입력에 연결 |
| ACC-04 | P0 | 식사 예산·제한·알레르기 | 프로필 식사 단계, `lib/venues.ts` 예산 검증·음식 요청 확인 |
| ACC-05 | P0 | 동의 없으면 신청 차단 | `lib/profile-validation.ts`, `lib/application-service.ts`, 확정 직전 재검증 |
| ACC-06 | P1 | 프로필 재사용 | `/api/profile` 본인 값 불러오기·수정, 테스트 기존 답변 재사용 |
| APP-01 | P0 | 모집 날짜·지역·마감 | `/apply`, `/api/availability`, `lib/availability.ts` |
| APP-02 | P0 | 복수 날짜·지역 | `components/application-form.tsx`, `availability_registrations`, 선택 옵션 조합 |
| APP-03 | P0 | 필수 검증·신청 제출 | `lib/application-service.ts`, `lib/domain.ts`; 요청 키 중복 방지 |
| APP-04 | P0 | 1회권·다회권 | 신청의 SINGLE/THREE_PASS/EXISTING_PASS, 참가권 지갑 |
| PAY-01 | P0 | 결제 각 상태 양쪽 조회 | `/payments`, `/api/payments`, 마감 전 신청 목록·결제 CSV, 내부 결제 시도/원장 |
| PAY-02 | P0 | 48시간·당일 취소 정책 | 신청 결제 전·신청 상세·식탁 공지, 취소 API 시간 검증 |
| PAY-03 | P0 | 매칭 실패 자동 환불 | 미매칭 REFUND 선택 → refund_requests → worker 자동 처리, 승인 불필요 |
| PAY-04 | P1 | 부분·전체 환불·실패 | `lib/virtual-transactions.ts` 내부 상태·원장으로 대체. 외부 PG 제외는 사용자 지시 |
| STA-01 | P0 | 신청·결제·매칭·취소 구분 | 참가자 홈·신청 상세, 독립 데이터 상태 및 다음 행동 |
| STA-02 | P0 | 발표·다음 안내 시점 | 신청 마감/예상 안내, 확정 상세·단체방·리마인드 |
| STA-03 | P0 | 동의 범위 안 자동 재배치 | `lib/matching-policy.ts`, `lib/automatic-matching.ts`, `lib/lifecycle-service.ts` |
| STA-04 | P0 | 실패 이유·대체 일정 | ALTERNATIVE_OFFERED, resolution_cases, 신청 상세 대안 선택 |
| STA-05 | P0 | 이동·보관·환불 선택 | 참가자 해결 화면, `resolveApplication`; 임의 이동/환불 금지 |
| STA-06 | P0 | 기존 결제로 이동 | `resolveApplication` TRANSFER, 결제 재승인 없이 옵션·대기 상태 갱신 |
| STA-07 | P1 | 취소석 응답 기한 | `lib/waitlist.ts`, `/api/waitlist`, `components/waitlist-offers.tsx`; 기한/응답·다음 후보 |
| MAT-01 | P0 | 마감 자동 실행 | worker MATCH_EVENT 마감 게이트·스케줄러, `tests/automatic-matching.test.ts` |
| MAT-02 | P0 | 일정·지역·4~6명 | `isHardCompatible`, `matchingInput`, 자동 확정 직전 validateGroup |
| MAT-03 | P0 | 연령 차 ≤8 | 매칭 엔진·확정·긴급 재구성 재검증 |
| MAT-04 | P0 | 성비→MBTI→관심사→성향 | `lib/matching.ts` 품질 점수 및 정책. MBTI는 제품 휴리스틱이며 과학적 진단을 주장하지 않음 |
| MAT-05 | P0 | 차단·신고·비선호 제외 | match_relationships, 피드백 저장·매칭/확정 직전 확인 |
| MAT-06 | P0 | 새로운 사람 우선 | match_history·novelty 가중치, `tests/matching.test.ts` |
| MAT-07 | P0 | 확정 직전 필수 재검증 | `lib/matching-review.ts` validateGroup, 변경된 동의/결제/제외/정원 차단 |
| MAT-08 | P0 | 불완전 조합 자동 재배치 | 다중 회차 matchingPlan·취소 복구 repairTable, 변경된 제안 폐기 |
| MAT-09 | P0 | 7명 이상 분리·미완성 병합 | 결정적 그룹 탐색에서 4~6명으로 최대 배치, `tests/matching.test.ts` |
| MAT-10 | P0 | 정상 조합 승인 없는 확정 | `runAutomaticMatching` → automaticallyConfirmProposal, matching_decisions 생성 없음 검증 |
| MAT-11 | P0 | 마지막 실패 대안 전환 | 모든 선택 마감 후 ALTERNATIVE_OFFERED·해결 케이스·본인 알림 |
| MAT-12 | P0 | 개인정보 안전한 이유 설명 | 참가자 큐레이션; 운영자 식탁 상세 §7.2 근거. 상세 점수/배제 관계는 운영자 전용 |
| MAT-13 | P0 | 해결 불가 항목만 운영 맥락 | 식당 부족→예약 관리, 신고→문의함, 관련 실패→식탁 안내 이력, 분석에서 전체 확인 필요 건수 |
| MAT-14 | P1 | 예외 긴급 이동·분리·병합 | `/api/admin/reconfigure`, `lib/operator-reconfigure.ts`, 식탁 상세. 같은 선택 회차·모든 멤버 보존·4~6명·제외/연령/지불/중복 검증·새 방·감사 기록 |
| MAT-15 | P1 | 가중치·최소 기준 설정 | `/admin/matching`, matching-studio 정책/회차 적용 API |
| MAT-16 | P2 | 누적 결과 기반 가중치 조정 | `preference_signals` 개인 보조 신호와 `outcomeWeightEvidence`의 완료된 실제 식탁 참석·대화 만족도·재방문 결과. 유효 식탁 20개부터 운영자 설정 가중치를 항목당 ±0.04 이내 조정하고 총합을 보존. 이력 부족 시 설정값 그대로 사용 |
| INF-01 | P0 | 확정 앱 알림·푸시 | provisionTable 앱 알림; PUSH_DELIVERY 스케줄. 실제 브라우저 푸시는 구독·키 설정에 의존 |
| INF-02 | P0 | 지역·시간·인원별 식당 | recommendVenues 예산·동시간 잔여 수용 인원; 모두 실패하면 HELD, 신규 식당 등록 시 자동 재시도 |
| INF-03 | P0 | 식당·주소·지도·시간·예약명·식사비 | `/tables/[id]`, `/api/tables/[id]`, 예약 관리와 연결 |
| INF-04 | P0 | 방 생성·전원 초대 | provisionTable journey_rooms + table_members 권한, 중복 실행 방지 |
| INF-05 | P0 | 자동 시간·장소·큐레이션·정책 공지 | provisionTable 시스템 메시지, 실제 장소·예약명 포함 |
| INF-06 | P0 | 매칭 전 비공개·확정 후 제한 소개 | 참가자 table API는 ACTIVE 멤버만, 이름/MBTI/관심사만 반환 |
| INF-07 | P0 | 1일 전 상세 리마인드 | worker JOURNEY_REMINDER; 앱 알림·단체방, 시간·장소·예약명·정책 |
| INF-08 | P0 | 실패 재시도·최종 예외 | worker lease/backoff/job_effects, push_deliveries, 식탁 안내 이력 |
| CON-01 | P0 | 대화 주제·게임 | 식탁 상세·앱 단체방, 기본 아이스브레이커와 콘텐츠 규칙 |
| CON-02 | P0 | 관심사 기반 구체 질문 ≥3개 | conversationQuestions, selectTableContent, 콘텐츠 입력 3~8개 서버 검증 |
| CON-03 | P0 | 시작 시 자동 게시 | worker POST_CONTENT, 시스템 메시지 멱등 키 |
| CON-04 | P1 | 운영 콘텐츠·유형별 규칙 | 식탁 상세 안내 탭, `/api/admin/content`, table_content_templates. 분위기/관심사/활성/우선순위·버전 |
| FDB-01 | P0 | 체크인·종료 후 노쇼 | 본인 check-in API; CLOSE_ATTENDANCE; 식탁 상세 사유 있는 참석 정정·시간 검증 |
| FDB-02 | P0 | 식탁·대화·식당 평가 | 피드백 화면/API·journey_feedback, 운영자 상세는 집계만 |
| FDB-03 | P0 | 재참여·추천 의향 | feedback 서비스 저장·식탁 상세 합계 |
| FDB-04 | P0 | 비공개 호감·비선호 | 사람별 선호 저장·차단 관계/학습 신호 반영, 상대 비공개 |
| SAF-01 | P0 | 신고·차단 | 본인 소속 식탁 신고·match_relationships 즉시 분리 |
| SAF-02 | P0 | 검토·경고·제한 | 문의함 내 참가자 신고, `/api/admin/journey` OPEN 상태 잠금·메모·중복 조치409·감사 |
| RET-01 | P0 | 이력·피드백 제출 상태 | 참가자 history·이전 식탁·후기 상태 |
| RET-02 | P0 | 다음 일정 추천 | `/api/journey` 이력/지역/요일/확인 선호 기반 모집 추천 |
| RET-03 | P1 | 이용권 횟수·기간·사용 | wallet·aggregatePasses·EXISTING_PASS·복원·소진 기록 |

## §7.2 운영자 매칭 근거

`lib/operator-workspace.ts`, `/admin/tables/[id]`에서 인원, 각 멤버의 해당 일정 선택 여부, 최저/최고 연령·차이, 성비, MBTI 구성, 공통 관심사, 희망 성향에 해당하는 동석 멤버 수, 이전 동일 식탁 배정 관계, 현재 제외 관계 충돌, 저장된 품질 점수·규칙 버전, 재배치 횟수·처리 시각을 확인한다. 성향 충족 설명과 점수 산식은 구별한다. 이전 배정과 실제 참석도 구별한다.

## §17 참가자 화면 10개

| 화면 | 진입점 |
|---|---|
| 로그인·가입 | `/login`, `/signup` |
| 프로필·매칭 선호 테스트 | `/profile/test`, `/profile/edit` |
| 일정·지역 선택 | `/apply` |
| 이용권·결제 | 신청 결제 단계, `/payments`, 지갑 |
| 신청·자동 매칭 상태 | `/`, `/applications`, 신청 상세 |
| 미매칭 해결 | 신청 상세 대체 일정·보관·환불 선택 |
| 확정 상세 | `/tables/[id]` |
| 단체방·주제·게임 | `/tables/[id]/chat` |
| 체크인·만족도·사람별 선호·신고 | 식탁 상세·후기 화면 |
| 이력·다음 일정 | `/history`, 참가자 홈·추천 |

## §17 운영 기능의 여섯 메뉴 배치

| 사용자 지정 메뉴 | 포함하는 PRD 운영 기능 |
|---|---|
| 문의함 | 공동 응대, 담당·메모·참가 맥락, 비공개 신고 검토·조치 |
| 마감 전 신청 현황 | 모집 일정별 신청·결제·희망 옵션, 검색·정렬·CSV, 모집 일정 설정 링크 |
| 마감 후 매칭 현황 | 자동 확정·미배정·식당 확인, 식탁 구성·상세 근거, 식탁별 읽기 전용 단체방·안내 이력, 긴급 재구성 |
| 지난 매칭들 | 종료된 식탁, 참석·노쇼·후기 결과, 참석 정정·상세 이력 |
| 식당·예약 관리 | 다양한 음식·예산별 재고, 회차별 잔여 수용 인원 검증, 식탁 예약 상태·담당·예약명·메모, 예외 재시도 |
| 운영 분석 | 월/연 전환·매출·지역·재방문 그래프, 재배치·대체 일정·자동 환불·노쇼 지표, 현재 미해결 상황 |

회차·매칭 정책·팀 권한 설정은 보조 설정에 둔다. 자동 대화 콘텐츠 등록·유형 규칙은 식탁 상세 안내 탭에 둔다. 독립 참석/예외/작업/안전 주소는 해당 맥락으로 이동한다.

## §16 비기능과 범위

- 본인/운영자 권한: 참가자 API의 자기 소유 검사와 active operator 확인. 기존의 role=ADMIN만으로 접근 가능하던 journey/CSV/venues 경로를 active operator 기준으로 맞춤.
- 데이터 보존: 기존 확정 식탁·원본 제공 자료·294개 설문을 삭제하지 않는다. 긴급 재구성도 원래 식탁과 대화를 남기고 새 식탁·방을 만든다.
- 개인정보 요청·보관 정책: `/privacy`, `/account/data`, 본인 데이터 내보내기·삭제 요청. 실제 삭제·보관 기간 적용은 정책 안내와 실행 구현을 구분한다.
- 모바일: 화면별 하나의 다음 행동, 단계형 프로필, 카드/탭/접힌 상세. '5분 이내'는 사람의 실제 사용 시간을 재기 전 보장 수치로 쓰지 않는다.
- 추적: match_runs·match_explanations·audit_logs·resolution_cases·payment_ledger·job_effects·push_deliveries를 사용한다.
- 분석: 부분 환불은 payment_ledger의 CHARGE-REFUND, 과거 원장 없는 결제만 결제 상태로 보정한다. 등록 집단과 행사 집단을 구별하고 분모가 0이면 비율을 숨긴다. 자동 재배치 지표는 취소 복구 제안 이력이 기록된 집단이다.
- 신청 완료율: `/api/availability/start`가 인증된 신청 화면 시작을 사용자·한국 날짜별 한 번 기록한다. 같은 기간에 이 시점 이후 제출한 고유 사용자를 분자로 계산한다. 계측 시작 이전 방문은 소급하지 않는다.
- 운영 시간: 식탁 안내 이력의 예외별 작업 시작·종료와 해결 시 자동 종료를 `operator_work_sessions`에 저장한다. 종료된 시간만 회차별 합계·평균에 넣는다. 운영자 개입률은 기록된 예외 수/같은 기간의 등록 신청 수로 표시한다. 계측 이전의 처리 시간은 소급하지 않는다.
- 범위: 실제 PG·실예약·이메일은 사용자 지시에 따라 제외한다.

## §18 완료 시나리오와 증거

1~8: `tests/automatic-matching.test.ts`, `tests/reviewed-matching.test.ts`, `tests/provider-acceptance.ts`에서 프로필·결제·마감·4~6인·재배치·승인 없는 확정·식당·방·대안 선택을 검증한다.

9~11: worker 관련 lifecycle/journey/feedback 테스트와 피드백·추천 테스트에서 예약 안내·행사 시작 콘텐츠·체크인·세 가지 만족도·사람별 선호·다음 매칭 반영을 확인한다.

12: 정상 자동화 테스트에서 matching_decisions 없이 확정되고 같은 작업을 재실행해도 테이블·방·알림이 중복되지 않는지 검증한다. 관리자 수동 조정은 정상 흐름이 아닌 명시적 예외로 분리한다.

관리자 보강의 실제 검증: `tests/operator-workspace.test.ts`를 SQLite와 전용 PostgreSQL 임시 스키마에서 각각 실행했다. 마감 전/후/과거 경계, 참가자·비활성 운영자 접근 차단, 예약 버전 충돌, 행사 시작 전 참석/종료 전 노쇼 금지, 신고 중복 조치 금지, 콘텐츠 규칙/버전/fallback, 부분 환불 매출, 긴급 재구성 연령·인원·변경충돌 차단/기존 방 보존/재시도 멱등성을 확인했다. 기록은 `.data/operator-workspace-tests.log`, `.data/operator-workspace-postgres-tests.log`에 남긴다. 통합 빌드·전체 테스트·모바일 확인은 부모 작업의 최종 결과에 합쳐 기록한다.

최신 통합 재검증은 [2026-10-19 운영 개편 검증](ADMIN_REWORK_20261018.md#이어서-수행한-통합-검증--2026-10-19)에 기록했다. 로컬 구현과 이전 운영 배포는 [현재 현황](STATUS.md)에서 구분한다.
