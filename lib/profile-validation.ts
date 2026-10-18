import {INTERESTS,TRAITS,DESIRED_TRAITS,FOOD_BUDGETS} from './domain';
export const MBTI_TYPES=['ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'] as const;
export function profileInput(raw:any){
 const b=raw&&typeof raw==='object'?raw:{};
 const value={...b,name:typeof b.name==='string'?b.name.trim():'',phone:typeof b.phone==='string'?b.phone.replace(/\s/g,''):'',occupation:typeof b.occupation==='string'?b.occupation.trim():'',mbti:typeof b.mbti==='string'?b.mbti.trim().toUpperCase():'',dietaryNotes:typeof b.dietaryNotes==='string'?b.dietaryNotes.trim():''};
 const fields:Record<string,string>={};
 const year=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date()));
 if(!value.name||value.name.length>80)fields.name='이름을 입력해 주세요.';
 if(!/^01[0-9]-?\d{3,4}-?\d{4}$/.test(value.phone))fields.phone='연락처를 010-1234-5678 형식으로 입력해 주세요.';
 if(!Number.isInteger(b.birthYear)||b.birthYear<1920||b.birthYear>year-19)fields.birthYear='만 19세 이상인 출생연도를 입력해 주세요.';
 if(!['WOMAN','MAN','PREFER_NOT_TO_SAY'].includes(b.gender))fields.gender='성별 항목을 다시 선택해 주세요.';
 if(value.occupation.length>120)fields.occupation='직업은 120자 이내로 입력해 주세요.';
 if(!MBTI_TYPES.includes(value.mbti as any))fields.mbti='MBTI 유형을 선택해 주세요.';
 for(const [key,allowed,min,label]of [['interests',INTERESTS,1,'관심사를 하나 이상 선택해 주세요.'],['traits',TRAITS,0,'나의 성향을 다시 선택해 주세요.'],['desiredTraits',DESIRED_TRAITS,0,'만나고 싶은 사람 항목을 다시 선택해 주세요.'],['foodBudgets',FOOD_BUDGETS,1,'식사 예산을 하나 이상 선택해 주세요.']]as const){
  const a=b[key]??[];value[key]=a;
  if(!Array.isArray(a)||a.length<min||a.length>allowed.length||new Set(a).size!==a.length||a.some(v=>!allowed.includes(v as never)))fields[key]=label;
 }
 if(value.dietaryNotes.length>1000)fields.dietaryNotes='음식 안내는 1,000자 이내로 입력해 주세요.';
 if(b.privacy!==true)fields.privacy='개인정보 수집 및 이용에 동의해 주세요.';
 if(b.operations!==true)fields.operations='행사 운영 및 안내 이용에 동의해 주세요.';
 return {value,fields};
}
