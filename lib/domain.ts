export const REGIONS = ['홍대/합정', '잠실', '강남/신논현', '을지로/종로'] as const;
export const INTERESTS = [
  '영화·드라마', '음악', '독서·글쓰기', '운동 (헬스, 러닝, 클라이밍 등)', '맛집·카페 탐방',
  '여행', '사진·영상', '전시·공연·아트', '패션·뷰티', '자기계발·공부',
] as const;
export const FOOD_BUDGETS = ['UNDER_20000', '20000_30000', 'OVER_30000', 'ANY'] as const;
export const TRAITS = [
  '잔잔하고 조용한 편', '활기차고 에너지 있는 편', '깊은 대화를 좋아함',
  '가볍고 유머 있는 대화를 좋아함', '경청을 잘 함', '이야기를 이끄는 편',
] as const;
export const DESIRED_TRAITS = [
  '나와 비슷한 사람', '나와 다른 자극을 주는 사람', '깊은 대화가 되는 사람',
  '편하고 유머 있는 사람', '열정 있는 사람', '잔잔하고 안정적인 사람',
] as const;

export type PassChoice = 'SINGLE' | 'THREE_PASS' | 'EXISTING_PASS';
export type ValidSelection = {
  eventIds: string[];
  pass: PassChoice;
  uses: number;
  amount: number;
};

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isEventIdList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length >= 1 && value.length <= 32
    && value.every(isCanonicalUuid);
}

export function validateApplicationSelection(eventIds: unknown, pass: unknown): ValidSelection {
  if (!isEventIdList(eventIds) || new Set(eventIds).size !== eventIds.length) {
    throw new Error('참석 가능한 일정을 하나 이상 선택해 주세요.');
  }
  if (pass !== 'SINGLE' && pass !== 'THREE_PASS' && pass !== 'EXISTING_PASS') {
    throw new Error('이용권을 선택해 주세요.');
  }
  return {
    eventIds,
    pass,
    uses: pass === 'THREE_PASS' ? 3 : 1,
    amount: pass === 'SINGLE' ? 8000 : pass === 'THREE_PASS' ? 15000 : 0,
  };
}

export function retryDelayMs(attempt: number) {
  return Math.min(60_000 * 2 ** Math.max(attempt - 1, 0), 6 * 60 * 60 * 1000);
}
