import {requireAdmin} from '@/lib/auth';
import {MatchingResults} from '@/components/operator-workspace';
export const dynamic='force-dynamic';
export default async function PastMatches(){await requireAdmin();return <MatchingResults past/>;}
