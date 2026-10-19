import {requireUser} from '@/lib/auth';
import {AccountData} from '@/components/account-data';
export default async function AccountDataPage(){await requireUser();return <AccountData/>;}
