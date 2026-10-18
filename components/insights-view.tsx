'use client';
import Link from 'next/link';
import {useState} from 'react';
import {JourneyLayout,JourneyState,useJourney} from './journey-ui';
import {FEEDBACK_TAGS} from '@/lib/feedback-domain';
import {SUPPORT_CATEGORIES} from '@/lib/support-domain';
const pct=(x:number|null)=>x===null?'—':`${Math.round(x*100)}%`;
const score=(x:number|null)=>x===null?'—':x.toFixed(1);
export function InsightsView(){
 const [source,setSource]=useState('real'),[from,setFrom]=useState(new Date(Date.now()-90*86400000).toISOString().slice(0,10)),[to,setTo]=useState(new Date().toISOString().slice(0,10));
 const q=useJourney(`/api/admin/insights?${new URLSearchParams({source,from,to})}`);
 const metrics=q.data?.metrics??[];const total=metrics.reduce((a:any,m:any)=>({tables:a.tables+m.tables,attendees:a.attendees+m.attendees,feedback:a.feedback+m.feedbackCount,reapplications:a.reapplications+m.actualReapplications}),{tables:0,attendees:0,feedback:0,reapplications:0});
 return <JourneyLayout title="한 번의 식탁, 다음 만남의 단서" eyebrow="ADMIN INSIGHTS" description="실제 경험과 모의 자료를 나누어 살펴보고, 다음 식탁을 조금씩 개선합니다.">
  <div className="panel insights-filters"><label>자료 구분<select value={source} onChange={e=>setSource(e.target.value)}><option value="real">실제 자료</option><option value="demo">모의 자료</option><option value="all">전체 · 구분 표시</option></select></label><label>시작일<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>종료일<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
  <JourneyState {...q} onRefresh={q.refresh}>
   <div className="insight-totals">{[['종료된 식탁',total.tables],['실제 참석 기록',total.attendees],['후기',total.feedback],['후속 신청 완료 기록',total.reapplications]].map(([label,value])=><article className="panel" key={label}><span>{label}{source!=='real'?' · 선택 자료':''}</span><strong>{value}</strong></article>)}</div>
   {source!=='real'&&<p className="notice">모의 자료가 포함된 보기입니다. 실제 성과나 학습 근거로 해석하지 마세요.</p>}
   {q.data?.insufficientData&&<p className="notice">아직 비교할 자료가 부족해요. 정책마다 실제 후기 3개 이상이 모인 뒤에도 표본과 기간을 함께 살펴봐 주세요.</p>}
   <section className="panel"><h2>정책별 경험</h2><p className="muted">선택한 기간에 시작한 식탁 중 종료된 식탁을 집계합니다. 재참여 의향은 후기 응답 건수입니다. 재신청률은 참석 이후 모의 결제를 완료한 후속 신청이 있는 참석 기록의 비율이며, 같은 사람의 여러 참석은 각각 집계하며, 후속 신청은 조회 시점까지 확인합니다.</p>{metrics.length?<div className="table-scroll"><table><thead><tr><th>정책 / 자료</th><th>식탁 / 참석</th><th>후기 / 응답률</th><th>대화 / 식당</th><th>재참여 의향</th><th>후속 재신청</th></tr></thead><tbody>{metrics.map((m:any)=><tr key={`${m.policyId}:${m.source}`}><td>{m.policyName}<small>{m.policyId} · {m.source==='real'?'실제':'모의'}</small></td><td>{m.tables} / {m.attendees}</td><td>{m.feedbackCount} / {pct(m.responseRate)}</td><td>{score(m.conversationScore)} / {score(m.venueScore)}</td><td>{m.returnIntent} / {m.feedbackCount}건</td><td>{m.actualReapplications}건 · {pct(m.reapplicationRate)}</td></tr>)}</tbody></table></div>:<p className="empty-card">이 기간에 분석할 참석·후기 자료가 없어요.</p>}<p className="muted">{q.data?.note}</p></section>
   <div className="insights-columns">{(['positiveTags','improvementTags'] as const).map(key=><section className="panel" key={key}><h2>{key==='positiveTags'?'좋았던 경험':'개선이 필요한 경험'}</h2>{metrics.some((m:any)=>Object.keys(m[key]).length)?metrics.map((m:any)=><div key={`${m.policyId}:${m.source}`}><h3>{m.policyName} · {m.source==='real'?'실제':'모의'}</h3>{Object.entries(m[key]).map(([tag,n])=><p key={tag}>{(FEEDBACK_TAGS as any)[tag]??tag}<strong className="insight-count">{String(n)}건</strong></p>)}</div>):<p className="muted">아직 선택된 태그가 없어요.</p>}</section>)}</div>
   <section className="panel"><div className="section-title"><h2>반복 문의와 개선 과제</h2><Link href="/admin/inbox">공동 문의함 →</Link></div><p>문의 {q.data?.support.count??0}건 · 미해결 {q.data?.support.unresolved??0}건 · 첫 답변 평균 {q.data?.support.averageFirstResponseHours===null?'자료 없음':`${Number(q.data?.support.averageFirstResponseHours).toFixed(1)}시간`}</p><div className="feedback-tags">{Object.entries(q.data?.support.categories??{}).map(([key,n])=><span className="tag" key={key}>{(SUPPORT_CATEGORIES as any)[key]??key} {String(n)}건</span>)}</div><p className="muted">아래는 전체 운영 개선 과제입니다. 기간·자료 필터의 성과 수치에 포함하지 않습니다.</p>{q.data?.improvements?.map((i:any)=><p key={i.id}>{i.title} · {({OPEN:'확인 중',PLANNED:'예정',DONE:'완료'} as any)[i.status]} · 연결 문의 {i.linked_tickets}건</p>)}</section>
   <section className="panel"><h2>최근 후기</h2><p className="muted">운영 개선에 필요한 원문만 표시합니다. 멤버에 대한 비공개 선택과 신고 사유는 포함하지 않습니다.</p>{q.data?.latest?.length?q.data.latest.map((f:any)=><article className="insight-review" key={f.id}><strong>{f.title}</strong><span className="tag">{f.source==='real'?'실제':'모의'}</span><small>{f.policyName} · {new Date(f.createdAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})}</small>{f.goodText&&<p>좋았던 점 · {f.goodText}</p>}{f.improveText&&<p>아쉬웠던 점 · {f.improveText}</p>}{f.comment&&<p>{f.comment}</p>}</article>):<p className="empty-card">아직 후기가 없어요.</p>}</section>
  </JourneyState>
 </JourneyLayout>;
}
