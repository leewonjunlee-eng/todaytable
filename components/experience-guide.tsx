'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useRef} from 'react';
import {guideSteps,type GuideRole} from '@/lib/experience-guide';
import {useSiteLinks} from './site-links';

export function ExperienceGuide({role,step,viewerRole}:{role:GuideRole;step:number;viewerRole:'ADMIN'|'PARTICIPANT'|null}) {
  const router=useRouter(),{participant,operator}=useSiteLinks();
  const steps=guideSteps[role],current=steps[step-1],heading=useRef<HTMLHeadingElement>(null),first=useRef(true);
  useEffect(()=>{if(first.current){first.current=false;return;}heading.current?.focus({preventScroll:true});if(heading.current&&heading.current.getBoundingClientRect().top<0)heading.current.scrollIntoView({block:'start',behavior:'instant'});},[role,step]);
  function go(nextRole:GuideRole,nextStep=1){router.replace(`/guide?role=${nextRole}&step=${nextStep}`,{scroll:false});}
  const destination=(path:string)=>role==='operator'&&operator?new URL(path,operator).href:role==='participant'&&participant!=='/'?new URL(path,participant).href:path;
  const needsLogin=!viewerRole||(role==='operator'&&viewerRole!=='ADMIN');
  return <>
    <header className="guide-topbar"><Link className="guide-brand" href={participant}>우연한 식탁</Link><Link className="guide-exit" href={role==='operator'?destination('/admin'):participant}>{role==='operator'?'운영 화면으로':'사용자 사이트로'} <span aria-hidden="true">↗</span></Link></header>
    <main id="main-content" className="experience-guide">
      <div className="guide-introduction"><p className="guide-label">처음 만나는 식탁, 이용 가이드</p><h1>한 번의 저녁,<br/>두 가지 시선으로.</h1><p>참가자는 만남에 집중하고, 운영자는 그 만남을 준비합니다.<br className="guide-desktop-break"/> 실제 화면 4장으로 원하는 쪽부터 둘러보세요.</p></div>
      <p className="guide-demo-caption">가상 자료로 만든 체험 화면이에요. 실제 결제·예약은 발생하지 않아요.</p>
      <div className="guide-role-picker" role="group" aria-label="둘러볼 역할"><button type="button" aria-pressed={role==='participant'} onClick={()=>go('participant')}><span>참가자로 둘러보기</span><small>취향에서 다음 만남까지</small></button><button type="button" aria-pressed={role==='operator'} onClick={()=>go('operator')}><span>운영자로 둘러보기</span><small>신청부터 예외 처리까지</small></button></div>
      <div className="guide-body"><nav className="guide-step-list" aria-label={`${role==='participant'?'참가자':'운영자'} 체험 단계`}>{steps.map((item,index)=><button key={item.image} type="button" aria-current={index+1===step?'step':undefined} onClick={()=>go(role,index+1)}><span className="guide-step-number" aria-hidden="true">{index+1}</span><span>{item.title}</span></button>)}</nav>
        <section className="guide-stage" aria-labelledby="guide-stage-title"><div className="guide-stage-copy"><p className="guide-step-count">{role==='participant'?'참가자의 여정':'운영자의 하루'} · {step} / {steps.length}</p><h2 id="guide-stage-title" ref={heading} tabIndex={-1}>{current.title}</h2><p>{current.description}</p><dl className="guide-takeaways"><div><dt>이렇게 해보세요</dt><dd>{current.action}</dd></div><div><dt>그다음에는</dt><dd>{current.outcome}</dd></div></dl></div>
          <figure className="guide-screen"><picture><source media="(max-width: 700px)" srcSet={`/guide/${current.image}-mobile.jpg`}/><img key={current.image} src={`/guide/${current.image}.jpg`} width={1240} height={880} alt={current.alt}/></picture><figcaption><span>가상 체험 자료로 촬영한 실제 화면</span><a href={`/guide/${current.image}.jpg`} target="_blank" rel="noreferrer">크게 보기 <span className="sr-only">(새 탭)</span><span aria-hidden="true">↗</span></a></figcaption></figure>
          <div className="guide-step-actions"><button className="button quiet" type="button" disabled={step===1} onClick={()=>go(role,step-1)}>이전 단계</button>{step<steps.length?<button className="button primary" type="button" onClick={()=>go(role,step+1)}>다음 단계 <span aria-hidden="true">→</span></button>:<button className="button primary" type="button" onClick={()=>go(role==='participant'?'operator':'participant')}>{role==='participant'?'운영자 여정도 보기':'참가자 여정도 보기'} <span aria-hidden="true">→</span></button>}</div>
          <div className="guide-try"><div><h3>이제 직접 둘러볼까요?</h3><p>{needsLogin?role==='operator'?'운영 화면으로 이동합니다. 로그인이 필요하면 전달받은 활성 운영팀 계정을 이용해 주세요.':'실제 신청과 내 만남은 로그인 후 이용해요. 계정이 없으면 회원가입부터 시작할 수 있어요.':'아래 화면에서 이어서 확인해 보세요.'}</p><p>계정이 없어도 이 가이드의 모든 화면은 볼 수 있어요.</p></div><a className="button primary" href={destination(current.href)}>{current.link}<span aria-hidden="true">↗</span></a></div>
        </section>
      </div>
      <aside className="guide-disclosure"><strong>안심하고 둘러보세요</strong><p>이 사이트는 서비스 검토용 체험 공간입니다. 참가자·신청·식탁·후기는 가상 자료이며, 결제·환불은 모의 처리로 실제 금액이 이동하지 않습니다. 외부 식당 예약과 이메일·푸시 발송도 이루어지지 않습니다. 가이드 이미지는 촬영 시점의 예시이며 현재 일정·건수와 다를 수 있어요.</p></aside>
      <footer className="guide-footer"><Link href={participant}>사용자 사이트</Link><a href={operator?new URL('/admin/login',operator).href:'/admin/login'}>운영자 로그인</a><Link href="/privacy">개인정보 안내</Link></footer>
    </main>
  </>;
}
