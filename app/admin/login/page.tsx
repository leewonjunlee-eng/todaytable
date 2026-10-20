import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { LoginForm } from '@/components/login-form';
import { siteOrigins } from '@/lib/site-origins';
export const dynamic='force-dynamic';
export default async function OperatorLogin() {
  const user=await currentUser();
  if(user?.role==='ADMIN')redirect('/admin');
  return <main id="main-content" className="auth-page"><Link className="back-link" href={siteOrigins().participant??'/'}>← 사용자 사이트</Link><div className="auth-card"><div className="brand-mark">식</div><div className="eyebrow">TODAYTABLE OPERATIONS</div><h1>운영자 로그인</h1><p>운영팀 계정으로 로그인하고 만남을 준비하세요.</p>{user&&<p role="status">사용자 계정으로 접속 중입니다. 운영자 계정으로 다시 로그인해 주세요.</p>}<LoginForm operator/></div></main>;
}
