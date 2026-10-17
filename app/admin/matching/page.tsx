import {requireAdmin} from '@/lib/auth';
import {AdminMatchingView} from '@/components/admin-journey';
export const dynamic='force-dynamic';
export default async function AdminMatchingPage(){await requireAdmin();return <AdminMatchingView/>;}
