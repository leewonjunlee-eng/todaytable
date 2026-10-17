import {requireUser} from '@/lib/auth';
import {TableView} from '@/components/journey-pages';
export const dynamic='force-dynamic';
export default async function TablePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  return <TableView id={id}/>;
}
