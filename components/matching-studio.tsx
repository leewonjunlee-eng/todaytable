'use client';
import {useState} from 'react';
import Link from 'next/link';
import {JourneyLayout,JourneyState,FormNotice,journeyFetch,useJourney} from './journey-ui';
const axes:Record<string,string>={gender:'구성 균형',mbti:'MBTI 참고',interests:'공통 관심사',traits:'대화·성향',novelty:'새로운 만남'};
export function MatchingStudio(){
 const q=useJourney('/api/admin/matching-studio');
 const [eventId,setEventId]=useState('');
 const [preview,setPreview]=useState<any>(null);
 const [choice,setChoice]=useState('');
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const policies=q.data?.policies??[];
 const event=q.data?.events?.find((e:any)=>e.id===eventId);
 const owner=q.data?.me?.role==='OWNER';
 async function act(data:any){
  setBusy(true);setMessage('');
  try{
   const result=await journeyFetch('/api/admin/matching-studio',{method:'POST',body:JSON.stringify(data)});
   if(data.action==='PREVIEW'){
    setPreview(result);setChoice(result.baselinePolicy);
   }else{
    await q.refresh();
    setMessage(data.action==='APPLY'?'이 회차의 기조를 저장했어요. 마감 시 조건에 맞는 식탁을 자동 확정하고 안내합니다.':data.action==='DEFAULT'?'다음 회차에 사용할 기본 기조를 변경했어요.':'새 정책 버전을 만들었어요.');
    if(data.action==='CUSTOM_POLICY')setPreview(null);
   }
   return result;
  }catch(e){
   setMessage(e instanceof Error?e.message:'처리하지 못했어요.');
  }finally{
   setBusy(false);
  }
 }
 const [weights,setWeights]=useState<Record<string,number>>({gender:35,mbti:10,interests:30,traits:15,novelty:10});
 const total=Object.values(weights).reduce((n,v)=>n+v,0);
 const comparison=preview?.results?.find((r:any)=>r.policyId===choice);
 function handleCustomPolicySubmit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();
  const f=new FormData(e.currentTarget);
  void act({action:'CUSTOM_POLICY',name:f.get('name'),description:f.get('description'),minScore:Number(f.get('minScore')),learningEnabled:f.get('learning')==='on',weights:Object.fromEntries(Object.keys(axes).map(k=>[k,weights[k]/total]))});
 }
 return (
  <JourneyLayout title="어떤 만남을 준비할까요?" eyebrow="ADMIN MATCHING" description="변하지 않는 안전 기준 위에, 이번 식탁의 작은 방향을 더합니다.">
   <JourneyState {...q} onRefresh={q.refresh}>
    <div className="button-row"><Link className="button primary" href="/admin/matching/review">마감 후 매칭 결과 보기 →</Link></div>
    <div className="studio-principles"><span>4~6명</span><span>남녀 4명 2:2 · 5명 2:3/3:2 · 6명 2:4/3:3/4:2</span><span>연령 폭 8년 이내</span><span>동의한 일정·지역</span><span>차단·신고 제외</span><p>모든 기조가 함께 지키는 기준입니다.</p></div>
    <section className="studio-policy-grid">{policies.map((p:any)=><article key={p.id} className={`policy-card ${q.data?.defaults?.policy_id===p.id?'default-policy':''}`}><div className="policy-icon">{p.id.startsWith('affinity')?'❋':p.id.startsWith('discovery')?'✧':p.id.startsWith('conversation')?'❧':'◌'}</div><div className="section-title"><h2>{p.name}</h2>{q.data?.defaults?.policy_id===p.id&&<span className="tag">기본 기조</span>}</div><p>{p.description}</p><div className="weight-bars">{Object.entries(p.weights).map(([k,v])=><div key={k}><span>{axes[k]}</span><i><b style={{width:`${Number(v)*100}%`}}/></i><small>{Math.round(Number(v)*100)}%</small></div>)}</div><small className="policy-version">{p.id} · 후기 반영 {p.learningEnabled?'사용':'해제'}</small>{owner&&q.data?.defaults?.policy_id!==p.id&&<button className="button quiet" disabled={busy} onClick={()=>void act({action:'DEFAULT',policyId:p.id,version:q.data.defaults.version})}>기본 기조로 사용</button>}</article>)}</section>
    <section className="panel studio-preview">
     <div className="section-title"><div><h2>같은 참가자, 다른 조합</h2><p className="muted">회차를 선택해 기조별 결과를 먼저 살펴보세요.</p></div><span className="tag">미리보기는 안내를 보내지 않아요</span></div>
     <div className="studio-event-picker"><label>비교할 회차<select value={eventId} onChange={e=>{setEventId(e.target.value);setPreview(null);setMessage('');}}><option value="">회차를 선택해 주세요</option>{q.data?.events?.map((e:any)=><option key={e.id} value={e.id}>{e.title} · 대기 {e.waiting_count}명{Number(e.table_count)>0?' · 확정 식탁 있음':''}</option>)}</select></label><button className="button primary" disabled={busy||!eventId} onClick={()=>void act({action:'PREVIEW',eventId})}>{busy?'조합을 살펴보는 중…':'기조별 결과 비교'}</button></div>
     {event&&<p className="studio-event-info">{event.area} · {new Date(event.starts_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · 적용 중인 기조: {policies.find((p:any)=>p.id===(event.policy_id??q.data?.defaults?.policy_id))?.name??'기본 기준'}</p>}
     {preview&&(
      <>
       <p className="notice">{preview.notice}</p>
       {preview.results.some((r:any)=>r.matchedCount>0)&&(
        <div className="comparison-cards">{preview.results.map((r:any)=><button key={r.policyId} className={`comparison-card ${choice===r.policyId?'selected':''}`} onClick={()=>setChoice(r.policyId)}><strong>{r.policyName}</strong><div><b>{r.matchedCount}</b>명 확정 가능</div><p>미매칭 {r.unmatched.length}명 · 변경되는 자리 {r.changedSeats}명</p><small>조합 참고 점수 {Number(r.qualityScore).toFixed(2)}</small></button>)}</div>
       )}
       <p className="muted small-note">점수는 조합 비교를 위한 내부 기준이며 실제 만족도나 만족 확률이 아닙니다.</p>
       {comparison&&(
        <div className="preview-tables">
         {comparison.groups.length?(
          comparison.groups.map((g:any,n:number)=><article key={n}><div className="section-title"><h3>식탁 {n+1}</h3><span>{g.members.length}명</span></div><div className="preview-members">{g.members.map((m:any)=><span key={m.applicationId}>{m.name}</span>)}</div><p>{g.explanation}</p></article>)
         ):(
          <div className="empty-card">
           {preview.results.some((r:any)=>r.matchedCount>0)?(
            '아직 조건을 만족하는 식탁을 구성하기 어려워요. 적합한 참가자가 모이면 자동으로 다시 준비합니다.'
           ):(
            <>
             이 회차의 대기 인원으로는 최소 식탁(4명)을 만들 수 없습니다.

            </>
           )}
          </div>
         )}
        </div>
       )}
      </>
     )}
     <div className="studio-apply"><div><strong>{policies.find((p:any)=>p.id===choice)?.name}</strong><p>{Number(event?.table_count)>0?'이미 확정된 식탁은 기조 변경으로 바뀌지 않습니다.':'이 회차에 적용하면 마감 시 새로운 기준으로 자동 매칭·확정합니다.'}</p></div><button className="button primary" disabled={busy||!choice||Number(event?.table_count)>0} onClick={()=>void act({action:'APPLY',previewId:preview.id,policyId:choice})}>이 회차에 적용</button></div>
     <FormNotice message={message}/>
    </section>
    <details className="panel advanced-policy"><summary>직접 조정하기 · 어떤 기준을 얼마나 반영할까요?</summary><p className="muted">정책은 덮어쓰지 않고 새 버전으로 남깁니다. 이전 정책을 다시 선택해 되돌릴 수 있어요. MBTI는 검증된 궁합 지표가 아닌 참고 규칙입니다.</p>
        {owner ? (
         <form className="form-grid" onSubmit={handleCustomPolicySubmit}>
          <label>기조 이름<input name="name" required minLength={2} maxLength={60}/></label>
          <label>설명<input name="description" required maxLength={500}/></label>
          <p className="weight-helper">슬라이더로 원하는 기준의 비중을 높여보세요. 저장할 때 전체 합을 100%로 맞춥니다.</p>
          {Object.entries(axes).map(([k,v])=><label key={k}>{v} · {total?Math.round(weights[k]/total*100):0}%<input aria-label={`${v} 반영 비중`} name={k} type="range" min="0" max="100" step="1" value={weights[k]} onChange={e=>setWeights(w=>({...w,[k]:Number(e.target.value)}))}/></label>)}
          <label>최소 참고 점수<input name="minScore" type="number" defaultValue={0} min="0" max="1" step="0.01"/></label>
          <label className="check-label"><input type="checkbox" name="learning" defaultChecked/>확인된 선호·누적 후기 반영</label>
          <button className="button primary" disabled={busy||total===0}>이 비중으로 새 기조 저장</button>
         </form>
        ) : (
         <p>기조 추가와 기본값 변경은 총괄 운영자가 관리합니다.</p>
        )}
       </details>
    <section className="panel"><h2>실제로 실행된 매칭</h2><div className="table-scroll"><table><thead><tr><th>회차</th><th>사용한 정책</th><th>확정 인원</th><th>실행 시각</th></tr></thead><tbody>{q.data?.runs?.map((r:any)=><tr key={r.id}><td>{r.title}</td><td>{r.policy_name??r.rule_version}</td><td>{r.matched_count}명</td><td>{new Date(r.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</td></tr>)}</tbody></table></div></section>
   </JourneyState>
  </JourneyLayout>
 );
}
