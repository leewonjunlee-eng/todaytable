import {requireUser} from '@/lib/auth';
import {FeedbackView} from '@/components/journey-pages';
export const dynamic='force-dynamic';
export default async function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  return <FeedbackView id={id}/>;
}
