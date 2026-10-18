'use client';
import {FormEvent,useEffect,useState} from 'react';
import {SUPPORT_CATEGORIES,SUPPORT_STATUSES} from '@/lib/support-domain';
const draft=(t:any):{version:number;status:string;category:string;priority:string;assigneeId:string;tags:string;followup:string}=>({version:Number(t.version),status:t.status,category:t.category,priority:t.priority,assigneeId:t.assignee_id??'',tags:(t.tags??[]).join(', '),followup:t.next_followup_at?new Date(new Date(t.next_followup_at).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):''});
export function TicketSettings({ticket,operators,busy,onSave}:{ticket:any;operators:any[];busy:boolean;onSave:(payload:any)=>Promise<boolean>}){
 const [form,setForm]=useState(()=>draft(ticket)),[dirty,setDirty]=useState(false);
 useEffect(()=>{if(!dirty)setForm(draft(ticket));},[ticket.version,dirty]);
 function change(key:string,value:string){setDirty(true);setForm(f=>({...f,[key]:value}));}
 async function save(e:FormEvent){e.preventDefault();if(busy)return;const ok=await onSave({action:'UPDATE',version:form.version,status:form.status,category:form.category,priority:form.priority,assigneeId:form.assigneeId||null,tags:form.tags.split(',').map(x=>x.trim()).filter(Boolean),nextFollowupAt:form.followup?new Date(form.followup).toISOString():null});if(ok)setDirty(false);}
 return <form className="form-stack" onSubmit={save}>
  {dirty&&form.version!==Number(ticket.version)&&<div className="notice" role="status">동료가 이 문의를 변경했어요. 작성 중인 입력은 유지했습니다.<button type="button" className="button quiet" onClick={()=>{setForm(draft(ticket));setDirty(false);}}>최신 설정 불러오기</button></div>}
  <label>담당자<select aria-label="담당자" value={form.assigneeId} onChange={e=>change('assigneeId',e.target.value)}><option value="">미배정</option>{operators.map(o=><option key={o.user_id} value={o.user_id}>{o.display_name}</option>)}</select></label>
  <label>처리 상태<select aria-label="처리 상태" value={form.status} onChange={e=>change('status',e.target.value)}>{Object.entries(SUPPORT_STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <label>분류<select aria-label="분류" value={form.category} onChange={e=>change('category',e.target.value)}>{Object.entries(SUPPORT_CATEGORIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <label>우선순위<select aria-label="우선순위" value={form.priority} onChange={e=>change('priority',e.target.value)}>{[['LOW','낮음'],['NORMAL','보통'],['HIGH','높음'],['URGENT','긴급']].map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <label>태그<input value={form.tags} onChange={e=>change('tags',e.target.value)} placeholder="첫 참가, 일정 변경"/></label>
  <label>다음 확인 시각<input type="datetime-local" value={form.followup} onChange={e=>change('followup',e.target.value)}/></label>
  <button className="button quiet" disabled={busy}>분류·담당 저장</button>
 </form>;
}
