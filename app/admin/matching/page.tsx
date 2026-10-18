import {requireAdmin} from '@/lib/auth';
import {MatchingStudio} from '@/components/matching-studio';
export const dynamic='force-dynamic';
export default async function Matching(){await requireAdmin();return <MatchingStudio/>;}
