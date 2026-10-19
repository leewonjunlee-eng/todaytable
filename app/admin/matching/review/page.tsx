import {requireAdmin} from '@/lib/auth';
import {MatchingResults} from '@/components/operator-workspace';
export const dynamic='force-dynamic';
export default async function ReviewPage(){await requireAdmin();return <MatchingResults/>;}
