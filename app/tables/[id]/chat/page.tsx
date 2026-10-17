import {requireUser} from '@/lib/auth';
import {ChatView} from '@/components/journey-pages';
export const dynamic='force-dynamic';
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  return <ChatView id={id}/>;
}
