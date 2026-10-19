import {requireAdmin} from '@/lib/auth';
import {OperationsSettings} from '@/components/operations-settings';
export default async function SettingsPage(){await requireAdmin();return <OperationsSettings/>;}
