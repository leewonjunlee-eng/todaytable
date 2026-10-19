'use client';
import {useState,type FormEvent} from 'react';
import Link from 'next/link';
import {journeyFetch} from './journey-ui';
import {formatKstDateTime} from '@/lib/date-format';

export function ApplicationCancellation({record,startsAt,onSaved}:{record:any;startsAt?:string;onSaved:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const starts=new Date(startsAt??''),now=new Date();
 const day=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
 const valid=Number.isFinite(+starts),allowed=valid&&+starts>+now&&day(starts)!==day(now),early=valid&&+starts-+now>=48*3600000;
 const active=record.status==='SUBMITTED'&&record.resolution?.selected_choice!=='REFUND'&&!['OFFERED','FAILED'].includes(record.resolution?.status);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||!allowed)return;
  const reason=new FormData(e.currentTarget).get('reason');
  if(!window.confirm(early?'이 신청을 취소할까요? 취소 후에는 되돌릴 수 없어요.':'환불과 참가권 복원 없이 신청을 취소할까요? 취소 후에는 되돌릴 수 없어요.'))return;
  setBusy(true);setError('');
  try{
   const result=await journeyFetch(`/api/applications/${record.id}/cancel`,{method:'POST',body:JSON.stringify({reason})});
   setMessage(result.refund==='REQUESTED'?'신청을 취소하고 환불을 요청했어요. 결제 내역에서 처리 상태를 확인해 주세요.':result.status==='CANCELED_EARLY'?'신청을 취소했어요. 사용한 참가권 1회를 복원했어요.':'신청을 취소했어요. 결제·참가권 상태는 결제 내역에서 확인해 주세요.');
   await onSaved();
  }catch(e){setError(e instanceof Error?e.message:'취소하지 못했어요. 다시 시도해 주세요.');}finally{setBusy(false);}
 }
 return <>{message&&<p role="status" className="notice">{message} <Link href="/payments">결제·환불 내역 보기</Link></p>}{active&&<details className="panel detail-disclosure"><summary>신청 취소·환불 안내</summary>
  {valid&&<p>취소 규정 기준 일정 · {formatKstDateTime(starts)}</p>}
  <p>{!allowed?'행사 당일과 시작 후에는 취소할 수 없어요. 도움이 필요하면 이 신청의 문의하기를 이용해 주세요.':early?record.pass_choice==='SINGLE'?'지금 취소하면 참가비 전액 환불을 자동으로 요청합니다.':'지금 취소하면 사용한 참가권 1회를 복원합니다. 남은 참가권 환불은 결제 내역에서 확인해 주세요.':'시작 48시간 이내이므로 환불이나 참가권 복원 없이 취소됩니다.'}</p>
  {allowed&&<form className="form-stack" onSubmit={submit}><label>취소 사유<textarea name="reason" required maxLength={1000} rows={3}/></label><button className="button quiet" disabled={busy}>{busy?'취소 처리 중…':early?'신청 취소하기':'환불 없이 신청 취소하기'}</button></form>}
  {error&&<p role="alert">{error}</p>}
 </details>}</>;
}
