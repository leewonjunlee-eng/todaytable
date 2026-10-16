import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
export default async function AdminHome() { await requireAdmin(); redirect('/admin/applications'); }
