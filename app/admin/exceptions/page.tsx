import {requireAdmin} from '@/lib/auth';
import {OperatorExceptions} from '@/components/operator-exceptions';
export default async function ExceptionsPage(){await requireAdmin();return <OperatorExceptions/>;}
