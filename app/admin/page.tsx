import {requireAdmin} from '@/lib/auth';
import {OperationsAnalytics} from '@/components/operations-analytics';
export const dynamic='force-dynamic';
export default async function AdminHome(){await requireAdmin();return <OperationsAnalytics/>;}
