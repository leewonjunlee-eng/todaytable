import type {AuthUser} from '@/lib/auth';
import {SiteNav} from './site-nav';
export function TopNav({user}:{user:AuthUser}){return <SiteNav admin={user.role==='ADMIN'}/>;}
