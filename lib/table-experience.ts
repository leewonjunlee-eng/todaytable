import {normalizeInterests} from './feedback-domain';
export function sharedInterestKeywords(members:Array<{interests?:unknown}>){
 const counts=new Map<string,number>();for(const m of members)for(const i of normalizeInterests(m.interests))counts.set(i,(counts.get(i)??0)+1);
 return [...counts].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,5).map(([label,count])=>({label,count}));
}
const questions:Record<string,string>={
 '영화·드라마':'최근에 본 영화나 드라마 중, 누군가에게 꼭 추천하고 싶은 작품은 무엇인가요?',
 '음악':'요즘 가장 자주 듣는 노래와 그 노래를 듣는 순간은 언제인가요?',
 '독서·글쓰기':'최근에 읽은 책에서 기억에 남는 문장이나 이야기가 있나요?',
 '운동 (헬스, 러닝, 클라이밍 등)':'최근에 관심이 생긴 운동이나 새롭게 도전해 보고 싶은 운동은 무엇인가요?',
 '맛집·카페 탐방':'최근에 발견한 맛집이나 다시 가고 싶은 카페가 있나요?',
 '여행':'가장 최근 여행에서 의외로 좋았던 장소나 다음에 가고 싶은 곳은 어디인가요?',
 '사진·영상':'최근 휴대폰에 남긴 사진 중 가장 마음에 드는 장면은 무엇인가요?',
 '전시·공연·아트':'최근에 다녀온 전시나 앞으로 보고 싶은 공연은 무엇인가요?',
 '패션·뷰티':'요즘 관심 있게 보는 스타일이나 오래 아껴 쓰는 물건이 있나요?',
 '자기계발·공부':'최근에 새롭게 배우기 시작했거나 올해 꼭 배워 보고 싶은 것은 무엇인가요?',
};
export function conversationQuestions(members:Array<{interests?:unknown}>){
 const common=sharedInterestKeywords(members).map(x=>x.label),all=normalizeInterests(members.flatMap(m=>Array.isArray(m.interests)?m.interests:[]));
 const result=[...new Set([...common,...all])].map(i=>questions[i]).filter(Boolean).slice(0,4);
 for(const q of ['이번 주에 나를 기분 좋게 만든 작은 일은 무엇이었나요?','하루가 온전히 비어 있다면 어떻게 보내고 싶으세요?','다음 한 달 안에 꼭 해 보고 싶은 일이 있나요?'])if(result.length<3)result.push(q);
 return result;
}
export function participantCuration(members:Array<{interests?:unknown}>){
 const keywords=sharedInterestKeywords(members);return {keywords,summary:keywords.length?'함께 이야기할 공통 관심사가 있어요.':'같은 날, 같은 지역에서 새로운 이야기를 나눌 식탁이에요.'};
}
export function aggregatePasses(rows:Array<{id:string;remaining_uses:number;expires_at:string|null}>,now=Date.now()){
 const usable=rows.filter(r=>Number(r.remaining_uses)>0&&(!r.expires_at||new Date(r.expires_at).getTime()>now));
 return usable.length?{remainingUses:usable.reduce((n,r)=>n+Number(r.remaining_uses),0),batches:usable.map(r=>({id:r.id,remainingUses:Number(r.remaining_uses),expiresAt:r.expires_at})).sort((a,b)=>(a.expiresAt?new Date(a.expiresAt).getTime():Infinity)-(b.expiresAt?new Date(b.expiresAt).getTime():Infinity))}:null;
}
