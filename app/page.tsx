import {currentUser} from '@/lib/auth';
import {OperationsAnalytics} from '@/components/operations-analytics';
import {DiscoverView} from '@/components/meeting-experience';
export const dynamic='force-dynamic';
export default async function Home(){const user=await currentUser();return user?.role==='ADMIN'?<OperationsAnalytics/>:<DiscoverView loggedIn={Boolean(user)}/>;}
