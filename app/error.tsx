'use client';
import Link from 'next/link';
export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){return <main id="main-content" className="recovery-page"><p className="guide-label">화면을 불러오지 못했어요</p><h1>잠시 후 다시 이어갈게요.</h1><p>일시적인 문제일 수 있어요. 다시 시도하거나 홈에서 이동해 주세요.</p><div className="button-row"><button className="button primary" type="button" onClick={reset}>다시 시도</button><Link className="button quiet" href="/">홈으로 가기</Link><Link className="button quiet" href="/guide">이용 가이드 보기</Link></div></main>;}
