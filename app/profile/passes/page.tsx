import {requireUser} from '@/lib/auth';
import {PassesView} from '@/components/profile-hub';
export default async function Passes(){await requireUser();return <PassesView/>;}
