'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
const storageKey='todaytable-guide-intro-v3';
export function ReviewIntro() {
  const path=usePathname(),dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false);
  const audience=path.startsWith('/admin')?'operator':'participant';
  const dismiss=()=>setOpen(false);
  const hidePermanently=()=>{try{localStorage.setItem(`${storageKey}-${audience}`,'hidden');}catch{}dismiss();};
  useEffect(()=>{
    setOpen(false);
    if(path==='/guide')return;
    try{if(localStorage.getItem(`${storageKey}-${audience}`)==='hidden')return;}catch{}
    setOpen(true);
  },[path,audience]);
  useEffect(()=>{
    if(!open||!dialog.current)return;
    const element=dialog.current,previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';element.showModal();
    return()=>{element.close();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[open]);
  if(!open)return null;
  return <dialog ref={dialog} className="first-visit-guide" aria-labelledby="first-visit-title" aria-describedby="first-visit-description" onCancel={dismiss}>
    <div className="first-visit-top"><span>우연한 식탁 · 이용 가이드</span><button type="button" className="guide-close" aria-label="안내 닫기" onClick={dismiss}>×</button></div>
    <h2 id="first-visit-title">어떤 자리에서<br/>둘러보실래요?</h2><p id="first-visit-description">참가자의 만남 여정과 운영자의 사용 방법.<br/>로그인 없이 실제 화면으로 먼저 살펴보세요.</p>
    <div className="first-visit-choices"><Link href="/guide?role=participant" onClick={dismiss}><span aria-hidden="true">함께하는 자리</span><strong>참가자로 둘러보기</strong><small>취향 → 신청 → 만남 → 후기</small></Link><Link href="/guide?role=operator" onClick={dismiss}><span aria-hidden="true">준비하는 자리</span><strong>운영자로 둘러보기</strong><small>신청 → 매칭 → 예약 → 예외 처리</small></Link></div>
    <p className="first-visit-note">가상 자료를 사용하는 체험 사이트예요. 결제·환불로 실제 금액이 이동하지 않으며, 외부 예약·발송은 이루어지지 않습니다.</p>
    <button type="button" className="guide-skip" onClick={hidePermanently}>이 화면의 안내 다시 보지 않기</button>
    <button type="button" className="guide-skip" onClick={dismiss}>안내 건너뛰고 직접 둘러보기 <span aria-hidden="true">→</span></button><p className="first-visit-reminder">닫기·건너뛰기는 이번에만 적용돼요. 다시 보지 않기는 이 브라우저에 저장되며, 메뉴의 ‘이용 가이드’는 언제든 열 수 있어요.</p>
  </dialog>;
}
