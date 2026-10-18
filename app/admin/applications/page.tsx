import {requireAdmin} from '@/lib/auth';
import {TopNav} from '@/components/top-nav';
import {db} from '@/lib/db';
import {AdminApplicationTable} from '@/components/admin-application-table';
export const dynamic='force-dynamic';
export default async function ApplicationsPage(){
 const user=await requireAdmin();
 const [applications,options,tables]=await Promise.all([
  db.query<any>(`SELECT a.id,a.status,a.created_at,a.pass_choice,a.amount_cents,a.matching_status,u.email,pr.display_name,pr.birth_year,py.status payment_status FROM applications a JOIN users u ON u.id=a.user_id LEFT JOIN profiles pr ON pr.user_id=u.id JOIN payments py ON py.application_id=a.id ORDER BY a.created_at DESC`),
  db.query<any>(`SELECT o.application_id,e.id,e.area,e.title,e.starts_at FROM application_options o JOIN events e ON e.id=o.event_id ORDER BY e.starts_at,e.area,e.id`),
  db.query<any>(`SELECT tm.application_id,t.id,t.table_number,e.area,e.starts_at,v.name venue_name,v.address venue_address FROM table_members tm JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id LEFT JOIN venues v ON v.id=t.venue_id WHERE tm.status='ACTIVE' ORDER BY e.starts_at,t.table_number,t.id`),
 ]);
 const grouped=new Map<string,number>(),tableNumbers=new Map<string,number>();
 for(const t of tables.rows){if(tableNumbers.has(t.id))continue;const group=`${t.area}:${new Date(t.starts_at).toISOString().slice(0,10)}`,n=(grouped.get(group)??0)+1;grouped.set(group,n);tableNumbers.set(t.id,n);}
 const rows=applications.rows.map(r=>({...r,options:options.rows.filter(o=>o.application_id===r.id),table:tables.rows.filter(t=>t.application_id===r.id).map(t=>({...t,number:tableNumbers.get(t.id)}))[0]??null}));
 const paid=rows.filter(r=>r.payment_status==='PAID');
 return <><TopNav user={user}/><main className="page"><div className="page-heading"><span className="eyebrow">PARTICIPANT REGISTRATIONS</span><h1>참가 등록과 배정 현황</h1><p>결제와 매칭 상태, 가능한 일정과 확정 장소를 정렬해서 확인하세요.</p></div><div className="metrics"><div><small>전체 등록</small><strong>{rows.length}</strong></div><div><small>결제 완료</small><strong>{paid.length}</strong></div><div><small>식탁 확정</small><strong>{rows.filter(r=>r.matching_status==='CONFIRMED').length}</strong></div><div><small>결제액</small><strong>₩{paid.reduce((n,r)=>n+Number(r.amount_cents),0).toLocaleString()}</strong></div></div><section className="panel"><AdminApplicationTable rows={rows}/></section></main></>;
}
