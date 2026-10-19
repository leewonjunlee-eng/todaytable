# 발견에서 만남까지: 화면과 가상 운영 자료 개편

## 설계 기준

참가자 메뉴는 `발견 → 내 만남 → 대화 → 마이` 네 곳으로 고정한다. 내 만남은 `만남 예정 / 신청 중 / 지난 만남`으로 구분하고 URL에 상태를 남긴다. 결제·참가권·문의·설정은 마이에 모은다. 기존 신청 상세, 매칭 실패 대안, 예약 안내, 후기 기능은 각 만남에서 이어진다.

[Hinge의 Discover와 Matches 구분](https://help.hinge.co/hc/en-us/articles/360011090134-Wie-treffe-ich-jemanden-und-fange-an-zu-chatten-)과 [Bumble의 대화 목록](https://support.bumble.com/hc/articles/28055378294685-Your-conversations)을 참고해 탐색과 이미 연결된 만남을 분리했다. [Timeleft의 식사 경험](https://timeleft.com/dinners/)처럼 날짜 선택부터 장소·함께할 사람·대화 안내까지 이어지도록 구성한다. 서비스의 4–6인 식탁 모델을 유지한다.

- 배경 `#fcfcf8`, 본문 `#293c31`, 주요 동작 `#385b44`, 보조색 `#e8eddf`.
- 한 화면의 주요 행동을 명확히 하고, 식탁 사진과 실제 일정·진행 상태를 중심으로 배치한다.
- 사람 사진을 임의로 붙이지 않고 가명의 첫 글자로 멤버를 표시한다.
- 키보드 포커스, 본문 건너뛰기, 44px 조작 영역, 동작 줄이기 설정, 모바일 줄바꿈을 확인한다.

## GitHub 스킬

공개 저장소에서 아래 스킬을 설치하고 이 작업에 적용했다. 스킬 자체는 개발 도구이며 서비스 배포 파일에 포함하지 않는다.

| 스킬 | 출처 | 적용 |
| --- | --- | --- |
| frontend-design | [Anthropic skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | 시각 방향, 색상과 서체, 화면 위계, 반응형 구성 |
| webapp-testing | [Anthropic skills](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) | Python Playwright로 실제 브라우저와 화면 검증 |
| web-design-guidelines | [Vercel agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | 접근성, 탐색, 상태 표현, 반응형 점검 |

설치 시 확인한 저장소 기준: Anthropic `dbd4588f9e1033efb41dad4bef2f7947c8993d44`, Vercel `063bee94c3f4df8453406c830b0a7df0f2860278`. 최신 [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md)도 함께 검토했다.

## 가상 운영 자료

`files/우연한식탁_가상데이터.xlsx`의 294행을 중복 의심 행까지 각각 보존한다. 원본 파일, 원본 응답, 행별 변환 가정을 따로 보관하고 참가자·신청·결제·회차에 연결한다. 연락처와 Instagram을 복사하지 않으며, 합성 계정은 `.invalid` 주소를 사용한다.

연도 없는 희망 날짜는 현재 시점을 기준으로 목요일 19:30 KST 회차로 재구성한다. 이는 실제 참석 이력을 의미하지 않는다. 원본 나이는 2026년 기준으로 해석하고, 해석하기 어려운 MBTI는 검토 표시와 함께 INFP로 보완한다. 지역은 앱의 네 지역으로 정규화한다.

| 원본 참가자 상태 | 인원 | 구성 |
| --- | ---: | --- |
| 지난 만남 | 105 | 확정 식탁, 예약, 출석, 대화, 후기 |
| 만남 예정 | 98 | 매칭 마감 후 확정, 장소·예약·멤버·대화 |
| 신청 중 | 91 | 마감 전 신청, 결제 완료, 가능한 날짜·지역 |
| 합계 | 294 | 원본 행을 빠짐없이 한 번씩 연결 |

기존 체험용 참가자 계정에는 세 상태를 함께 볼 수 있도록 추가 신청을 연결한다. 기존 계정과 기록은 보존한다. 전체 구성은 참가자 295명, 신청 307건, 확정 식탁 37개, 후기 83개, 참가자 대화 148개, 문의 12건이다. 식탁은 4–6명, 연령 차이 8년 이내로 구성한다.

결제·예약은 모두 MOCK이며 금전이나 외부 예약은 발생하지 않는다. 가상 운영 모드에서는 웹 푸시 등록 안내를 끄고 워커의 외부 푸시 전송을 차단한다. 알림과 문의 답변은 앱 안의 자료다. 매칭 학습에는 simulation 표시를 남긴다.

## 운영과 재실행

마이그레이션 `029_showcase_lifecycle.sql`을 먼저 적용한다. 원본 가져오기를 완료한 뒤 `node --import tsx scripts/populate-lifecycle-showcase.ts <원본 파싱 JSON 경로>`로 구성한다. 같은 원본 해시와 기준 목요일에 대한 재실행은 기존 결과를 반환한다. 활성 배치는 하나이며 관리 화면·모집 일정·참가자 체험 화면이 같은 배치를 사용한다. 기존 자료를 삭제하지 않는다.

검증·배포 결과는 STATUS와 VALIDATION에 기록한다. 보호된 원본 백업, 계정 비밀번호, DB 덤프와 브라우저 세션은 저장소에 추가하지 않는다.

## 실제 화면 점검에서 보완한 항목

휴대폰 소개 영역을 사진과 설명의 세로 배치로 바꾸고, 작은 상태·대화 글자를 키웠습니다. 메시지의 기존 카드 테두리를 제거해 본인·상대 대화가 말풍선으로 구분되도록 했습니다. 일정 선택에서 같은 날짜·지역의 내부 회차를 하나의 안내로 묶고, 연결 신청의 날짜·지역도 중복 표시하지 않습니다. 본문 건너뛰기 대상은 로그인·가입·개인정보·원본 자료 화면에도 연결했습니다. 만남 상태 탭은 URL과 브라우저 뒤로가기·새로고침에 따라 유지됩니다.

참가권 선택 표시를 가격 왼쪽으로 옮겨 금액과 겹치지 않도록 했고, 모의 처리 결과 선택에 명시적인 접근성 이름을 추가했습니다.
