import {requireAdmin} from '@/lib/auth';
import {DeadlineApplications} from '@/components/operator-workspace';
export const dynamic='force-dynamic';
export default async function ApplicationsPage(){await requireAdmin();return <DeadlineApplications/>;}
