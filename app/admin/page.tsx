import {requireAdmin} from '@/lib/auth';
import {AdminDashboardView} from '@/components/admin-journey';
export const dynamic='force-dynamic';
export default async function AdminHome(){await requireAdmin();return <><AdminDashboardView/><div className="page"><a className="button-secondary" href="/admin/source-data">제공 설문 원본 검토 및 데모 변환</a></div></>;}
