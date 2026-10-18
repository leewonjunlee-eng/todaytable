import {Suspense} from 'react';
import {SupportWorkspace} from '@/components/support-workspace';
export const dynamic='force-dynamic';
export default function Support(){return <Suspense fallback={<p>문의함을 준비하고 있어요…</p>}><SupportWorkspace/></Suspense>;}
