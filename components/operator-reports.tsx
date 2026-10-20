'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {JourneyState,useJourney} from './journey-ui';
import {ReportReview} from './admin-journey';
import {formatKstDateTime} from '@/lib/date-format';
import './operator-detail.css';
export function OperatorReports(){
 const q=useJourney('/api/admin/reports',30000),[all,setAll]=useState(false),reports=q.data?.reports??[],open=reports.filter((r:any)=>r.decision==='OPEN');
 const reportDetails=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const reveal=()=>{if(window.location.hash!=='#participant-reports'||!reportDetails.current)return;reportDetails.current.open=true;reportDetails.current.scrollIntoView({block:'start'});};reveal();window.addEventListener('hashchange',reveal);return()=>window.removeEventListener('hashchange',reveal);},[]);
 return <details ref={reportDetails} className="panel" id="participant-reports" style={{scrollMarginTop:90}}><summary>참가자 신고 · 검토 대기 {open.length}건</summary><p>참가자의 비공개 신고를 검토하고 조치합니다. 신고 내용과 신고자 정보는 상대에게 공개되지 않습니다.</p><JourneyState {...q} onRefresh={q.refresh}><label><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/> 처리한 신고도 보기</label><div className="operator-report-grid">{(all?reports:open).map((r:any)=><article key={r.id}><span className="tag">{({OPEN:'검토 대기',WARNING:'경고',SUSPEND:'참가 제한',PERMANENT:'영구 제한',DISMISSED:'기각'} as any)[r.decision]??r.decision}</span><h3>{r.reporter_name} → {r.target_name}</h3><small>{formatKstDateTime(r.created_at)} · {r.area}</small><p>{r.reason}</p>{r.note&&<p>검토 기록: {r.note}</p>}<Link className="inline-link" href={`/admin/tables/${r.table_id}`}>식탁·대화 맥락 확인 →</Link>{r.decision==='OPEN'&&<ReportReview row={{...r,status:r.decision}} onDone={q.refresh}/>}</article>)}</div>{(all?reports:open).length===0&&<p>확인할 신고가 없습니다.</p>}</JourneyState></details>;
}
