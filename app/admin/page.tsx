import {requireAdmin} from '@/lib/auth';
import {AdminDashboardView} from '@/components/admin-journey';
export const dynamic='force-dynamic';
export default async function AdminHome(){await requireAdmin();return <><AdminDashboardView/><div className="page"><a className="button-secondary" href="/admin/source-data">참가 설문 관리</a></div></>;}
