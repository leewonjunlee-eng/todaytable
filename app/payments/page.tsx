import {requireUser} from '@/lib/auth';
import {PaymentHistory} from '@/components/payment-history';
export default async function Page(){await requireUser();return <PaymentHistory/>;}
