import {requireAdmin} from '@/lib/auth';
import {InsightsView} from '@/components/insights-view';
export const dynamic='force-dynamic';
export default async function Insights(){await requireAdmin();return <InsightsView/>;}
