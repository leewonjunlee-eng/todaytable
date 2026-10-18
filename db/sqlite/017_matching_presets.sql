-- Immutable initial matching policy versions.
INSERT INTO matching_policies(id,name,description,weights) VALUES('balanced-v1','균형형','취향과 새로운 만남, 식탁의 구성을 두루 살펴요.','{"gender": 0.35, "mbti": 0.1, "interests": 0.3, "traits": 0.15, "novelty": 0.1}');
INSERT INTO matching_policies(id,name,description,weights) VALUES('affinity-v1','공감·취향형','공통 관심사에서 시작되는 자연스러운 대화를 준비해요.','{"gender": 0.2, "mbti": 0.05, "interests": 0.5, "traits": 0.2, "novelty": 0.05}');
INSERT INTO matching_policies(id,name,description,weights) VALUES('discovery-v1','새로운 발견형','처음 만나는 사람과 새로운 관점을 발견해요.','{"gender": 0.25, "mbti": 0.05, "interests": 0.2, "traits": 0.15, "novelty": 0.35}');
INSERT INTO matching_policies(id,name,description,weights) VALUES('conversation-v1','편안한 대화형','대화의 분위기와 서로가 원하는 성향을 더 살펴요.','{"gender": 0.2, "mbti": 0.05, "interests": 0.25, "traits": 0.4, "novelty": 0.1}');
UPDATE matching_defaults SET policy_id='balanced-v1' WHERE id=1;
