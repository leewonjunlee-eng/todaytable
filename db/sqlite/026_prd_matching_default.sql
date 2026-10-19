-- Preserve historical and operator-selected versions; version the corrected PRD default.
INSERT INTO matching_policies(id,name,description,weights) VALUES('prd-v2','운영 기본형','연령·선택 일정·제외 관계를 먼저 지키고 성비, MBTI, 관심사, 성향 순으로 구성합니다.','{"gender":0.4,"mbti":0.25,"interests":0.2,"traits":0.1,"novelty":0.05}');
UPDATE matching_defaults SET policy_id='prd-v2',version=version+1 WHERE id=1 AND (policy_id IS NULL OR (policy_id='balanced-v1' AND version=0));
