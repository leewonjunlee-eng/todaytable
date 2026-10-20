export type GuideRole = 'participant' | 'operator';
export type GuideStep = {
  title: string;
  description: string;
  action: string;
  outcome: string;
  image: string;
  alt: string;
  href: string;
  link: string;
};
export const guideSteps: Record<GuideRole, GuideStep[]> = {
  participant: [
    {title:'나를 알리고, 만날 사람의 취향을 고르기',description:'짧은 상황 질문에 답하고 관심사와 대화 취향을 알려주세요. 저장한 답변은 다음 신청에도 이어집니다.',action:'프로필과 매칭 취향에서 내 정보와 원하는 만남을 입력해요.',outcome:'취향과 가능한 일정을 함께 살펴 4~6명의 식탁을 준비해요.',image:'participant-profile',alt:'참가자가 프로필과 상황 질문을 입력하는 실제 화면',href:'/profile/test',link:'프로필과 취향 입력 열기'},
    {title:'가능한 날짜와 지역, 참가권 선택하기',description:'모집 중인 날짜와 갈 수 있는 지역을 고르고 참가권을 확인하세요. 여러 날짜를 골라도 한 번의 만남을 준비합니다.',action:'일정을 고른 뒤 참가권·결제 단계로 이동해요.',outcome:'신청 중에서 진행 상황을 확인해요. 식사 비용은 현장에서 각자 계산해요.',image:'participant-apply',alt:'모집 중인 날짜와 지역을 고르는 실제 참가 신청 화면',href:'/apply',link:'일정 선택 화면 열기'},
    {title:'확정된 식탁에서 만남 준비하기',description:'매칭 마감 후 식탁이 확정되면 식당, 시간, 함께할 사람과 대화방을 한곳에서 확인할 수 있어요.',action:'내 만남의 만남 예정에서 식탁 안내를 열어요.',outcome:'장소와 안내를 확인하고, 대화방에서 미리 인사해요. 체크인은 시작 30분 전부터 가능해요.',image:'participant-table',alt:'식당과 시간, 멤버와 체크인 안내가 모인 실제 식탁 화면',href:'/applications?view=upcoming',link:'만남 예정 화면 열기'},
    {title:'저녁을 돌아보고, 다음 만남 이어가기',description:'참석 확인된 만남에는 비공개 후기를 남길 수 있어요. 다시 만나고 싶은 취향과 피하고 싶은 관계는 다음 매칭에 반영됩니다.',action:'내 만남의 지난 만남에서 후기 남기기를 선택해요.',outcome:'후기는 다른 참가자에게 공개되지 않아요. 불편한 일은 식탁 안내에서 신고·차단할 수 있어요.',image:'participant-feedback',alt:'참석한 식탁에 비공개 후기와 다음 만남 선호를 남기는 실제 화면',href:'/applications?view=past',link:'지난 만남 화면 열기'},
  ],
  operator: [
    {title:'신청부터 마감까지, 지금의 상황 보기',description:'날짜와 지역별 신청을 살펴보세요. 참가자 프로필과 결제 상태를 확인하고, 마감 전까지 모집 상황을 파악합니다.',action:'신청 중에서 회차와 지역을 선택해 참가자를 확인해요.',outcome:'신청과 확정된 만남을 구분해 다음으로 처리할 일을 찾을 수 있어요.',image:'operator-applications',alt:'회차별 신청과 참가자 정보를 살펴보는 실제 운영자 화면',href:'/admin/applications',link:'신청 중 화면 열기'},
    {title:'자동 매칭 결과와 식탁 구성 확인하기',description:'마감에 맞춰 조건을 충족한 식탁은 자동으로 확정돼요. 만남 예정에서 멤버와 준비 상태를 확인합니다.',action:'만남 예정에서 식탁을 열어 구성과 안내 상태를 살펴봐요.',outcome:'성비·연령·가능 일정 등 필수 조건을 지키며, 취소나 빈자리가 생긴 식탁을 확인해요.',image:'operator-matching',alt:'확정된 식탁과 참가자 구성을 확인하는 실제 만남 예정 화면',href:'/admin/matching/review',link:'만남 예정 화면 열기'},
    {title:'식당 예약을 확인하고 동료와 이어받기',description:'식당·예약에서 예약 대기부터 확인 완료까지 관리해요. 예약명과 확인 코드, 담당자와 메모를 함께 남길 수 있어요.',action:'식탁의 예약 상태와 담당자를 확인하고 필요한 내용을 저장해요.',outcome:'작성 중인 내용은 자동 새로고침에도 유지돼요. 동료가 먼저 수정했다면 충돌을 알려줘요.',image:'operator-bookings',alt:'식탁별 예약 상태와 담당자, 메모를 관리하는 실제 운영자 화면',href:'/admin/bookings',link:'식당·예약 화면 열기'},
    {title:'자동으로 끝나지 않은 일에 집중하기',description:'운영 현황에서 처리할 상황을 찾고, 자동 처리 확인에서 실패한 작업을 재시도하거나 해결 결과를 남겨요. 참가자 문의와 신고는 문의함에서 살펴봅니다.',action:'예외의 원인을 확인하고 재시도하거나, 처리 후 해결 완료로 기록해요.',outcome:'취소·환불·예약 문제를 놓치지 않고 다음 담당자가 이어서 확인할 수 있어요.',image:'operator-exceptions',alt:'자동 작업의 미해결 원인과 재시도·해결 버튼이 보이는 실제 예외 처리 화면',href:'/admin/exceptions',link:'자동 처리 확인 열기'},
  ],
};
