'use client';
import {FormEvent,useEffect,useState} from 'react';
import {ATMOSPHERES,FEEDBACK_TAGS} from '@/lib/feedback-domain';
import {FormNotice,journeyFetch,JourneyState,useJourney} from './journey-ui';
const initial={publishVenueReview:false,venueReview:'',tableScore:4,conversationScore:4,venueScore:4,returnIntent:true,recommendIntent:true,comment:'',positives:[] as string[],improvements:[] as string[],goodText:'',improveText:'',nextAtmosphere:'BALANCED',nextInterests:[] as string[],preferenceConfirmed:false,likedUserIds:[] as string[],dislikedUserIds:[] as string[]};
export function FeedbackForm({id,detail,onSaved}:{id:string;detail:any;onSaved:()=>Promise<void>}){
 const q=useJourney(`/api/tables/${id}/feedback`);const [form,setForm]=useState(initial),[interests,setInterests]=useState(''),[learning,setLearning]=useState(true),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{if(!q.data)return;setForm({...initial,...q.data.feedback});setInterests((q.data.feedback?.nextInterests??[]).join(', '));setLearning(q.data.learningEnabled);},[q.data]);
 const set=(key:string,value:any)=>setForm(f=>({...f,[key]:value}));
 const toggle=(key:'positives'|'improvements',tag:string)=>set(key,form[key].includes(tag)?form[key].filter(x=>x!==tag):[...form[key],tag]);
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;if(step<2){setStep(step+1);return;}setBusy(true);setMessage('');try{
  await journeyFetch(`/api/tables/${id}/feedback`,{method:'POST',body:JSON.stringify({...form,nextInterests:interests.split(',').map(s=>s.trim()).filter(Boolean),learningEnabled:learning})});setMessage('후기를 저장했어요. 다음 만남 선호는 언제든 수정할 수 있어요.');await Promise.all([q.refresh(),onSaved()]);
 }catch(e){setMessage(e instanceof Error?e.message:'저장하지 못했어요.');}finally{setBusy(false);}}
 async function remove(){if(busy||!window.confirm('이 후기를 삭제할까요? 이 후기에서 얻은 선호 근거도 다시 계산합니다.'))return;setBusy(true);try{await journeyFetch(`/api/tables/${id}/feedback`,{method:'DELETE'});setMessage('후기를 삭제했어요.');setStep(0);await Promise.all([q.refresh(),onSaved()]);}catch(e){setMessage(e instanceof Error?e.message:'삭제하지 못했어요.');}finally{setBusy(false);}}
 return <JourneyState {...q} onRefresh={q.refresh}>{!detail.feedback_eligible?<section className="panel"><h2>후기 작성 안내</h2><p>{!detail.event_ended?'행사가 끝난 뒤 후기를 남길 수 있어요.':'실제 참석 확인 후 후기를 남길 수 있어요. 참석 기록이 다르면 운영팀에 문의해 주세요.'}</p></section>:<form className="panel form-stack feedback-form" onSubmit={submit}>
  <div className="section-title"><h2>{q.data?.feedback?'후기 수정하기':'오늘의 식탁은 어땠나요?'}</h2><span className="tag">약 1~2분</span></div>

  <nav className="feedback-steps" aria-label="후기 작성 단계">{['경험 점수','좋았던 점과 아쉬움','다음 만남'].map((s,n)=><button type="button" key={s} aria-current={step===n?'step':undefined} onClick={()=>setStep(n)}>{n+1}. {s}</button>)}</nav>
  <p className="sr-only" role="status">{step+1}단계</p>
  {step===0&&<>
   {([['tableScore','식탁 전체'],['conversationScore','대화 분위기'],['venueScore','식당·장소']] as const).map(([key,label])=><label key={key}>{label}<select aria-label={label} value={form[key]} onChange={e=>set(key,Number(e.target.value))}>{[1,2,3,4,5].map(n=><option value={n} key={n}>{n}점 {['','많이 아쉬워요','아쉬워요','보통이에요','좋았어요','아주 좋았어요'][n]}</option>)}</select></label>)}
   <label>다시 참여하고 싶나요?<select value={String(form.returnIntent)} onChange={e=>set('returnIntent',e.target.value==='true')}><option value="true">네</option><option value="false">아니요</option></select></label>
   <label>주변에 추천하고 싶나요?<select value={String(form.recommendIntent)} onChange={e=>set('recommendIntent',e.target.value==='true')}><option value="true">네</option><option value="false">아니요</option></select></label>
  </>}
  {step===1&&<>
   {(['positives','improvements'] as const).map(key=><fieldset key={key}><legend>{key==='positives'?'좋았던 점':'아쉬웠던 점'}</legend><div className="feedback-tags">{Object.entries(FEEDBACK_TAGS).map(([tag,label])=><label className="option-card" key={tag}><input type="checkbox" checked={form[key].includes(tag)} onChange={()=>toggle(key,tag)}/>{label}</label>)}</div></fieldset>)}
   <label>좋았던 경험을 조금 더 알려주세요<textarea value={form.goodText} maxLength={2000} onChange={e=>set('goodText',e.target.value)}/></label><label>개선하면 좋을 점<textarea value={form.improveText} maxLength={2000} onChange={e=>set('improveText',e.target.value)}/></label>
   <fieldset><legend>다녀온 식당 이야기 (선택)</legend><p className="muted">다른 분들이 장소를 고를 때 참고할 수 있어요. 이 항목만 식당 소개에 이름 없이 공개됩니다.</p><label className="check-label"><input type="checkbox" checked={form.publishVenueReview} onChange={e=>set('publishVenueReview',e.target.checked)}/>식당 점수와 아래 후기를 공개할게요</label>{form.publishVenueReview&&<label>공개할 식당 후기<textarea value={form.venueReview} minLength={5} maxLength={1000} onChange={e=>set('venueReview',e.target.value)} placeholder="음식, 좌석, 대화하기 좋은 분위기에 대해 알려주세요." required/></label>}</fieldset>
   <label>운영팀에 남기는 추가 메모<textarea value={form.comment} maxLength={2000} onChange={e=>set('comment',e.target.value)}/></label>
   <fieldset><legend>멤버에 대한 비공개 의견 (선택)</legend><p className="muted">다른 멤버에게 공개되지 않아요. 안전 문제는 아래 안전 요청으로 알려주세요.</p>{(detail.members??[]).filter((m:any)=>m.user_id!==detail.currentUserId).map((m:any)=><label key={m.user_id}>{m.display_name}<select value={form.likedUserIds.includes(m.user_id)?'LIKE':form.dislikedUserIds.includes(m.user_id)?'DISLIKE':''} onChange={e=>setForm(f=>({...f,likedUserIds:[...f.likedUserIds.filter(x=>x!==m.user_id),...(e.target.value==='LIKE'?[m.user_id]:[])],dislikedUserIds:[...f.dislikedUserIds.filter(x=>x!==m.user_id),...(e.target.value==='DISLIKE'?[m.user_id]:[])]}))}><option value="">선택하지 않음</option><option value="LIKE">좋았던 멤버</option><option value="DISLIKE">다음에는 피하고 싶은 멤버</option></select></label>)}</fieldset>
  </>}
  {step===2&&<>
   <label>다음에는 이런 분위기로<select aria-label="다음에는 이런 분위기로" value={form.nextAtmosphere} onChange={e=>set('nextAtmosphere',e.target.value)}>{Object.entries(ATMOSPHERES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <label>다음에 나누고 싶은 관심사<input value={interests} onChange={e=>setInterests(e.target.value)} maxLength={600} placeholder="독서, 여행처럼 쉼표로 구분해 주세요"/></label>
   <label className="check-label"><input type="checkbox" checked={form.preferenceConfirmed} onChange={e=>set('preferenceConfirmed',e.target.checked)}/>이 선호를 다음 식탁에 반영해 주세요</label>
   <label className="check-label"><input type="checkbox" checked={learning} onChange={e=>setLearning(e.target.checked)} disabled={detail.table.is_demo}/>후기 기반 개인화 사용</label>
   <p className="muted">실제 후기 3개 이상부터 보조 신호로 사용하며 영향은 최대 10%입니다. 식당 점수는 사람 궁합에 반영하지 않아요. 마이에서 개인화를 끄거나 선호를 철회할 수 있어요.</p>
  </>}
  <div className="button-row">{step>0&&<button className="button quiet" type="button" disabled={busy} onClick={()=>setStep(step-1)}>이전</button>}<button className="button primary" disabled={busy}>{busy?'저장 중…':step<2?'다음':q.data?.feedback?'수정한 후기 저장':'후기 저장'}</button>{q.data?.feedback&&<button className="button quiet" type="button" disabled={busy} onClick={()=>void remove()}>후기 삭제</button>}</div>
 </form>}<FormNotice message={message}/></JourneyState>;
}
