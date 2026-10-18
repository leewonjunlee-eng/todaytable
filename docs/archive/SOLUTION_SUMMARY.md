> 과거 기록 보관본입니다. 최신 상태와 검증 결과는 [현재 현황](../STATUS.md)을 기준으로 확인하세요.

# Todaytable 작업 진행 상황

## 1. ✅ 모의 데이터의 생성 시점 표시 누락 (Issue 8-1)

### 문제
`014_product_evolution.sql` 마이그레이션은 기존 행사와 연결된 신청/후기를 일괄 `is_demo=TRUE`로 표시하지만, `scripts/seed-operations.ts`와 `lib/source-data.ts`에서 새 행을 INSERT할 때 `is_demo`를 명시하지 않아 모의 데이터가 실제 데이터와 섞일 수 있음.

### 변경 파일

#### `scripts/seed-operations.ts`
- `users` INSERT에 `is_demo=true` 추가
- `events` INSERT에 `is_demo=true` 추가
- `applications` INSERT(2곳)에 `is_demo=true` 추가
- `journey_feedback` INSERT에 `is_demo=true` 추가

#### `lib/source-data.ts`
- `users` INSERT에 `is_demo=true` 추가
- `events` INSERT에 `is_demo=true` 추가
- `applications` INSERT에 `is_demo=true` 추가

### 검증 방안
`tests/source-data.test.ts`의 마이그레이션 목록이 013까지 하드코딩되어 있으므로 전체 SQL 파일을 읽는 방식으로 변경 필요 (미해결 — TODO)

---

## 상태
- 1번 완료
- 2번(매칭 정책 불일치), 작업 B(후기 API 확장), 작업 C(후기 신호 생성)도 추가 완료
- 요청하신 1번만 반영하라면 현재 상태 유지
- 추가 작업 이어서 진행 필요 시 알려주세요