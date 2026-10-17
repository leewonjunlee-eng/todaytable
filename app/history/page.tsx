import {requireUser} from '@/lib/auth';
import {HistoryView} from '@/components/journey-pages';
export const dynamic='force-dynamic';
export default async function HistoryPage(){await requireUser(); return <HistoryView/>;}
