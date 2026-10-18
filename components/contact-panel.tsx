'use client';
import Link from 'next/link';
import {UiIcon} from './ui-icon';
import {FormEvent,KeyboardEvent,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import {SUPPORT_CATEGORIES} from '@/lib/support-domain';
import {journeyFetch,FormNotice} from './journey-ui';
export function ContactPanel({loggedIn}:{loggedIn:boolean}){
 const dialog=useRef<HTMLDialogElement>(null),button=useRef<HTMLButtonElement>(null),key=useRef('');const path=usePathname();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 function open(){key.current=crypto.randomUUID();setMessage('');dialog.current?.showModal();}
 function close(){dialog.current?.close();button.current?.focus();}
 function keepFocus(event:KeyboardEvent<HTMLDialogElement>){
  if(event.key!=='Tab')return;
  const fields=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(el=>el.getClientRects().length>0);
  const first=fields[0],last=fields[fields.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }

 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;setBusy(true);const form=new FormData(e.currentTarget);try{
  const table=path.match(/^\/tables\/([0-9a-f-]{36})(?:\/|$)/)?.[1];
  const result=await journeyFetch('/api/support',{method:'POST',body:JSON.stringify({name:form.get('name'),email:form.get('email'),subject:form.get('subject'),category:form.get('category'),body:form.get('body'),requestKey:key.current,tableId:table})});
  location.href=`/support?id=${encodeURIComponent(result.id)}`;
 }catch(e){setMessage(e instanceof Error?e.message:'접수하지 못했어요.');setBusy(false);}}
 return <><button ref={button} className="contact-fab" type="button" onClick={open} aria-haspopup="dialog" aria-label="운영팀에 문의하기"><span><UiIcon name="message" size={20}/></span> 이야기 나누기</button><dialog className="contact-dialog" ref={dialog} aria-labelledby="contact-title" onKeyDown={keepFocus} onClose={()=>button.current?.focus()}>
  <div className="section-title"><h2 id="contact-title">어떤 이야기를 들려주실래요?</h2><button type="button" className="text-button" onClick={close} aria-label="문의 창 닫기">닫기 ×</button></div>
  <p>접수 후 문의함에서 답변을 확인하고 추가 질문을 이어갈 수 있어요.</p><form className="form-stack" onSubmit={submit}>
   {!loggedIn&&<div className="form-grid"><label>이름<input name="name" required maxLength={60}/></label><label>이메일<input name="email" type="email" required maxLength={254}/></label></div>}
   <label>분류<select name="category">{Object.entries(SUPPORT_CATEGORIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>제목<input name="subject" required minLength={2} maxLength={160}/></label><label>내용<textarea name="body" required maxLength={5000} rows={4}/></label><FormNotice message={message}/><button className="button primary" disabled={busy}>{busy?'접수 중…':'문의 남기기'}</button>
  </form><p className="muted">비회원 문의는 접수한 브라우저에서 확인합니다.</p><Link className="inline-link" href="/support" onClick={close}>나의 문의와 답변 전체 보기 →</Link>
 </dialog></>;
}
