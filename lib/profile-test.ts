import {TRAITS} from './domain';

export const PROFILE_TEST_VERSION='dinner-style-v1';
export const PROFILE_QUESTIONS=[
 {id:'arrival',title:'처음 만난 식탁에서 나는?',hint:'정답은 없어요. 평소 나와 가까운 쪽을 골라 주세요.',options:[{id:'calm',label:'분위기를 천천히 살피며 편안하게 시작해요',trait:TRAITS[0]},{id:'energetic',label:'먼저 반갑게 인사하며 분위기를 풀어요',trait:TRAITS[1]}]},
 {id:'conversation',title:'대화가 잘 통한다고 느끼는 순간은?',hint:'어떤 이야기를 나누고 싶은가요?',options:[{id:'deep',label:'서로의 생각이나 경험을 깊이 알아갈 때',trait:TRAITS[2]},{id:'light',label:'일상 이야기로 함께 웃음이 터질 때',trait:TRAITS[3]}]},
 {id:'role',title:'함께 이야기할 때 더 자연스러운 모습은?',hint:'모임마다 달라도 괜찮아요.',options:[{id:'listen',label:'상대 이야기에 귀 기울이고 질문해요',trait:TRAITS[4]},{id:'lead',label:'새로운 화제를 꺼내 대화를 이어가요',trait:TRAITS[5]}]},
] as const;
export type ProfileTestAnswers=Record<string,string>;
export function validProfileTestAnswers(raw:unknown):raw is ProfileTestAnswers {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const answers=raw as Record<string,unknown>;
 return Object.keys(answers).length===PROFILE_QUESTIONS.length&&PROFILE_QUESTIONS.every(q=>q.options.some(o=>o.id===answers[q.id]));
}
export function profileTestResult(answers:ProfileTestAnswers){
 const traits=PROFILE_QUESTIONS.flatMap(q=>{const choice=q.options.find(o=>o.id===answers[q.id]);return choice?[choice.trait]:[];});
 const title=answers.arrival==='calm'?(answers.conversation==='deep'?'차분하게 깊어지는 식탁':'편안하게 웃음 짓는 식탁'):(answers.conversation==='deep'?'생각을 나누는 활기찬 식탁':'유쾌하게 가까워지는 식탁');
 return {title,traits,description:answers.role==='listen'?'이야기에 귀 기울이며 서로를 알아가는 시간을 좋아해요.':'새로운 이야기를 꺼내며 함께하는 시간을 즐겁게 만들어요.'};
}
