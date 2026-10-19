import {requireUser} from '@/lib/auth';
import {ChatsView} from '@/components/meeting-experience';
export default async function Page(){await requireUser();return <ChatsView/>;}
