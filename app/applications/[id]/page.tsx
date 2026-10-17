import {requireUser} from '@/lib/auth';
import {ApplicationResolutionView} from '@/components/journey-pages';
export const dynamic='force-dynamic';
export default async function ApplicationResolutionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  return <ApplicationResolutionView id={id}/>;
}
