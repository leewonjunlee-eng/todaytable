import {requireUser} from '@/lib/auth';
import {ApplicationsView} from '@/components/journey-pages';
export const dynamic='force-dynamic';
export default async function ApplicationsPage(){await requireUser();return <ApplicationsView/>;}