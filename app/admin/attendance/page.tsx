import {redirect} from 'next/navigation';
import {requireAdmin} from '@/lib/auth';
export default async function PreviousPage(){await requireAdmin();redirect('/admin/matches/past');}
