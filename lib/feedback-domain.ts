export const FEEDBACK_TAGS = {
  COMMON_INTERESTS: '공통 관심사', CONVERSATION: '대화 분위기', PERSPECTIVES: '다양한 관점',
  GROUP: '인원 구성', GUIDANCE: '시간·안내', VENUE: '장소', FOOD: '음식·소음',
} as const;
export const ATMOSPHERES = {
  BALANCED: '균형 있게', CALM: '차분하게', LIVELY: '활기 있게', DEEP: '깊이 있는 대화',
} as const;
export const MIN_SIGNAL_EVIDENCE = 3;
export const MAX_PERSONALIZATION_INFLUENCE = .1;

// Keep the short labels people type consistent with the profile's interest choices.
const INTEREST_ALIASES: Record<string,string> = {
  독서:'독서·글쓰기', 책:'독서·글쓰기', 글쓰기:'독서·글쓰기',
  영화:'영화·드라마', 드라마:'영화·드라마', 사진:'사진·영상', 영상:'사진·영상',
  운동:'운동 (헬스, 러닝, 클라이밍 등)', 헬스:'운동 (헬스, 러닝, 클라이밍 등)', 러닝:'운동 (헬스, 러닝, 클라이밍 등)',
  맛집:'맛집·카페 탐방', 카페:'맛집·카페 탐방', 전시:'전시·공연·아트', 공연:'전시·공연·아트',
  패션:'패션·뷰티', 뷰티:'패션·뷰티', 자기계발:'자기계발·공부', 공부:'자기계발·공부',
};
export const normalizeInterests=(values:unknown):string[]=>Array.isArray(values)?[...new Set(values.filter((value):value is string=>typeof value==='string').map(value=>{const word=value.trim();return Object.hasOwn(INTEREST_ALIASES,word)?INTEREST_ALIASES[word]:word;}).filter(Boolean))]:[];
