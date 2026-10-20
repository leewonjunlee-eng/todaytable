import {currentUser} from '@/lib/auth';
import {DiscoverView} from '@/components/meeting-experience';
export const dynamic='force-dynamic';
export default async function Home(){const user=await currentUser();return <DiscoverView loggedIn={Boolean(user)}/>;}
