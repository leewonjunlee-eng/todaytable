ALTER TABLE notifications ADD COLUMN action_url text CHECK(action_url IS NULL OR (action_url LIKE '/%' AND action_url NOT LIKE '//%'));
UPDATE support_templates SET body='{{name}}님, 현재 연결된 신청은 {{matching_status}}입니다. 내 식탁에서 일정·장소·안내를 확인하실 수 있으며 추가 확인이 필요한 내용은 이 대화에서 이어서 안내하겠습니다.'
WHERE id='matching' AND body='{{name}}님, 가능한 일정과 관심사를 바탕으로 4~6명의 식탁을 준비하고 있습니다. 확정되면 내 식탁과 알림에서 장소·시간·채팅방을 확인하실 수 있어요.';
