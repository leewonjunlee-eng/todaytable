import {requireAdmin} from '@/lib/auth';
import {AdminDashboardView} from '@/components/admin-journey';
export const dynamic='force-dynamic';
export default async function AdminAttendance(){await requireAdmin();return <AdminDashboardView section="attendance"/>;}