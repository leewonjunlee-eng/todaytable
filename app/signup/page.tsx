import Link from 'next/link';
import {currentUser} from '@/lib/auth';
import {redirect} from 'next/navigation';
import {SignupForm} from '@/components/signup-form';
import {loginDestination} from '@/lib/login-destination';
export default async function Signup({searchParams}:{searchParams:Promise<{next?:string}>}){const next=loginDestination((await searchParams).next);if(await currentUser())redirect(next?`/profile/test?next=${encodeURIComponent(next)}`:'/profile/test');return <main id="main-content" className="auth-page"><Link className="back-link" href="/">← 처음으로</Link><div className="auth-card"><div className="brand-mark">식</div><div className="eyebrow">A SEAT FOR YOU</div><h1>새로운 저녁을 시작해요</h1><p>계정을 만들고 관심사와 대화 취향을 알려 주세요.</p><SignupForm next={next}/></div></main>;}
