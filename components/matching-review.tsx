'use client';
import Link from 'next/link';
import {useState} from 'react';
import {JourneyLayout,JourneyState,useJourney} from './journey-ui';
const when=(d:string)=>new Date(d).toLocaleString('ko-KR',{month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
export function MatchingReview(){
  const q=useJourney('/api/admin/matching-review',15000);
  const [tab,setTab]=useState('upcoming');
  return <JourneyLayout title="확정된 식탁 현황" eyebrow="ADMIN MATCHING TABLES" description="이미 매칭 완료된 식탁들을 확인합니다.">
    <div className="button-row"><Link className="button quiet" href="/admin/matching">매칭 비중 조정</Link><Link className="button quiet" href="/admin/venues">지역별 식당과 후기</Link></div>
    <JourneyState {...q} onRefresh={q.refresh}>
      <nav className="focus-switcher review-tabs" aria-label="식탁 상태">
        {[['upcoming','다가오는 식탁'],['past','지난 식탁']].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label} {q.data?.[id]?.length??0}</button>)}
      </nav>
      <div className="assigned-tables">
        {q.data?.[tab]?.length?q.data[tab].map((t:any)=><article className="panel" key={t.id}>
          <span className="tag">{t.area} · 식탁 {t.table_number}</span>
          <h2>{when(t.starts_at)}</h2>
          <p>{t.venue_name||'장소 확인 필요'} · {t.member_count}명</p>
          <details className="detail-disclosure">
            <summary>멤버와 추천 이유</summary>
            <div className="curation-keywords">{t.keywords?.map((k:any)=><span className="tag" key={k.label}>{k.label}</span>)}</div>
            <p>{t.explanation}</p>
            <ul>{t.members?.map((m:any)=><li key={m.user_id}>{m.display_name} · {m.mbti}</li>)}</ul>
          </details>
        </article>):<p className="empty-card">{tab==='past'?'지난 식탁이 아직 없어요.':'예정된 식탁이 아직 없어요.'}</p>}
      </div>
    </JourneyState>
  </JourneyLayout>;
}