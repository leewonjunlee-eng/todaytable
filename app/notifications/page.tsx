import {requireUser} from '@/lib/auth';
import {NotificationsView} from '@/components/journey-pages';
export const dynamic='force-dynamic';
export default async function NotificationsPage(){await requireUser(); return <NotificationsView/>;}
