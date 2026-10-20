import {loginDestination} from '@/lib/login-destination';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { LoginForm } from '@/components/login-form';
import { siteOrigins } from '@/lib/site-origins';
export const dynamic='force-dynamic';
export default async function OperatorLogin({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const next=loginDestination((await searchParams).next,true);
  const user=await currentUser();
  if(user?.role==='ADMIN')redirect(next??'/admin');
  return <main id="main-content" className="auth-page"><Link className="back-link" href={siteOrigins().participant??'/'}>← 사용자 사이트</Link><div className="auth-card"><div className="brand-mark">식</div><div className="eyebrow">TODAYTABLE OPERATIONS</div><h1>운영자 로그인</h1><p>운영팀 계정으로 로그인하고 만남을 준비하세요.</p>{user&&<p role="status">사용자 계정으로 접속 중입니다. 운영자 계정으로 다시 로그인해 주세요.</p>}<p className="auth-demo-note">가상 자료를 사용하는 운영 체험 공간입니다. 계정은 링크를 전달한 사람에게 확인해 주세요.</p><LoginForm operator next={next}/><Link className="auth-guide-link" href="/guide?role=operator">계정 없이 운영 화면과 사용 방법 살펴보기</Link></div></main>;
}
