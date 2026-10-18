import {Suspense} from 'react';
import {requireAdmin} from '@/lib/auth';
import {SupportWorkspace} from '@/components/support-workspace';
export const dynamic='force-dynamic';
export default async function Inbox(){await requireAdmin();return <Suspense fallback={<p>공동 문의함을 준비하고 있어요…</p>}><SupportWorkspace admin/></Suspense>;}
