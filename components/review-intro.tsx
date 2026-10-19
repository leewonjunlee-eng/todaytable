'use client';

import {useEffect, useRef, useState} from 'react';

export function ReviewIntro() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const dismiss = () => {
    try { sessionStorage.setItem('todaytable-review-intro-v1', 'seen'); } catch {}
    setOpen(false);
  };
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem('todaytable-review-intro-v1') === 'seen'; } catch {}
    if (!seen) setOpen(true);
  }, []);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);
  if (!open) return null;
  return <dialog ref={dialog} className="review-intro" aria-labelledby="review-intro-title" aria-describedby="review-intro-description" onCancel={dismiss} onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); dialog.current?.querySelector('button')?.focus(); } }}>
    <div className="eyebrow">WELCOME TO TODAYTABLE</div>
    <h2 id="review-intro-title">우연한 식탁을 둘러보세요</h2>
    <p id="review-intro-description">이 사이트는 서비스 검토를 위한 체험 공간입니다. 참가자·식탁·문의·후기는 구성된 자료이며, 실제 모집이나 예약을 뜻하지 않습니다. 결제·환불은 가상으로 처리되며 실제 금액이 이동하지 않습니다. 이메일 발송과 외부 식당 예약은 이루어지지 않습니다.</p>
    <p>참가자의 만남 준비부터 운영팀의 문의 응대까지, 하나의 서비스로 이어지는 흐름을 살펴보세요.</p>
    <button className="button primary full" onClick={dismiss} autoFocus>확인하고 시작하기 →</button>
  </dialog>;
}
