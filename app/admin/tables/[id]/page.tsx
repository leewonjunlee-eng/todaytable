import {requireAdmin} from '@/lib/auth';
import {OperatorTableDetail} from '@/components/operator-table-detail';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){await requireAdmin();return <OperatorTableDetail id={(await params).id}/>;}
