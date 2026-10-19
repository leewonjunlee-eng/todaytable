'use client';
import Link from 'next/link';
import {useState} from 'react';
import {JourneyLayout,JourneyState,useJourney,journeyFetch} from './journey-ui';
import {formatKstDateTime} from '@/lib/date-format';

const states:Record<string,string>={OPEN:'확인 필요',RETRYING:'재시도 중',RESOLVED:'해결 완료'};
const sources:Record<string,string>={scheduled_job:'자동 작업',repair_table:'취소 후 식탁 복구',dining_table:'식탁 준비'};
export function OperatorExceptions(){
 const q=useJourney('/api/admin/journey',15000),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
 const rows=(q.data?.exceptions??[]).filter((r:any)=>r.status!=='RESOLVED');
 async function act(id:string,action:string){
  if(busy)return;
  if(action==='RESOLVE_EXCEPTION'&&!window.confirm('처리 결과를 확인하고 이 예외를 해결 완료로 기록할까요?'))return;
  setBusy(id);setError('');setMessage('');
  try{await journeyFetch('/api/admin/journey',{method:'POST',body:JSON.stringify({id,action,status:'RESOLVED'})});setMessage(action==='RETRY_EXCEPTION'?'재시도를 요청했어요. 자동 작업 결과를 다시 확인해 주세요.':'해결 완료로 기록했어요.');await q.refresh();}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했어요. 다시 시도해 주세요.');}finally{setBusy('');}
 }
 return <JourneyLayout title="자동 처리 확인" description="자동으로 끝내지 못한 작업을 확인하고 재시도하거나 해결 결과를 기록합니다."><Link className="inline-link" href="/admin">← 운영 현황</Link><JourneyState {...q} onRefresh={q.refresh}>
  <p className="notice">미해결 항목을 우선해 최근 100건을 조회합니다. 현재 표시된 미해결 작업 {rows.length}건</p>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  {rows.length?rows.map((r:any)=><article className="panel" key={r.id}><div className="section-title"><h2>{sources[r.kind]??'자동 처리'}</h2><span className="tag">{states[r.status]??'상태 확인 필요'}</span></div><p>{r.reason}</p><p className="muted">발생 {formatKstDateTime(r.created_at)}</p>{['repair_table','dining_table'].includes(r.kind)&&<Link className="inline-link" href={`/admin/tables/${r.entity_id}`}>식탁 맥락 확인 →</Link>}<div className="button-row"><button className="button primary" disabled={Boolean(busy)||r.status==='RETRYING'} onClick={()=>void act(r.id,'RETRY_EXCEPTION')}>{busy===r.id?'처리 중…':'자동 작업 다시 시도'}</button><button className="button quiet" disabled={Boolean(busy)} onClick={()=>void act(r.id,'RESOLVE_EXCEPTION')}>해결 완료로 기록</button></div></article>):<section className="panel"><h2>확인이 필요한 자동 작업이 없어요</h2><p>새로 발생하는 예외는 이곳에서 확인할 수 있어요.</p></section>}
 </JourneyState></JourneyLayout>;
}
