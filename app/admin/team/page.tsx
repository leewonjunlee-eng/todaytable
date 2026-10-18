import {requireAdmin} from '@/lib/auth';
import {OperatorSettings} from '@/components/operator-settings';
export const dynamic='force-dynamic';
export default async function Team(){await requireAdmin();return <OperatorSettings/>;}
