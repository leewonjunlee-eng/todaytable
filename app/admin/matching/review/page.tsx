import {requireAdmin} from '@/lib/auth';
import {MatchingReview} from '@/components/matching-review';
export const dynamic='force-dynamic';
export default async function ReviewPage(){await requireAdmin();return <MatchingReview/>;}
