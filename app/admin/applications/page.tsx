import { requireAdmin } from '@/lib/auth';
import { TopNav } from '@/components/top-nav';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
type PaymentSummary = { status: string; count: number; amount: number };
type JobSummary = { status: string; count: number };
type ApplicationRow = {
  id: string; created_at: string; pass_choice: string; amount_cents: number;
  matching_status: string; email: string; display_name: string | null; birth_year: number | null;
  payment_status: string; event_titles: (string | null)[]; areas: (string | null)[];
};

export default async function ApplicationsPage() {
  const user = await requireAdmin();
  const [applications, payments, jobs] = await Promise.all([
    db.query<ApplicationRow>(
      `SELECT a.id,a.created_at,a.pass_choice,a.amount_cents,a.matching_status,u.email,
              pr.display_name,pr.birth_year,py.status payment_status,
              array_agg(e.title) event_titles,array_agg(DISTINCT e.area) areas
       FROM applications a JOIN users u ON u.id=a.user_id
       LEFT JOIN profiles pr ON pr.user_id=u.id JOIN payments py ON py.application_id=a.id
       LEFT JOIN application_options o ON o.application_id=a.id LEFT JOIN events e ON e.id=o.event_id
       GROUP BY a.id,u.email,pr.display_name,pr.birth_year,py.status ORDER BY a.created_at DESC`,
      [],
      `SELECT a.id,a.created_at,a.pass_choice,a.amount_cents,a.matching_status,u.email,
              pr.display_name,pr.birth_year,py.status payment_status,
              json_group_array(e.title) event_titles,json_group_array(DISTINCT e.area) areas
       FROM applications a JOIN users u ON u.id=a.user_id
       LEFT JOIN profiles pr ON pr.user_id=u.id JOIN payments py ON py.application_id=a.id
       LEFT JOIN application_options o ON o.application_id=a.id LEFT JOIN events e ON e.id=o.event_id
       GROUP BY a.id,u.email,pr.display_name,pr.birth_year,py.status ORDER BY a.created_at DESC`,
    ),
    db.query<PaymentSummary>('SELECT status,count(*)::int count,coalesce(sum(amount_cents),0)::int amount FROM payments GROUP BY status'),
    db.query<JobSummary>('SELECT status,count(*)::int count FROM scheduled_jobs GROUP BY status'),
  ]);
  const labels:Record<string,string>={SINGLE:'1회권',THREE_PASS:'3회권',EXISTING_PASS:'보유 이용권',PAID:'결제 완료',REFUNDED:'환불 완료',REFUND_REQUESTED:'환불 요청',REFUND_PROCESSING:'환불 처리 중',FAILED:'실패',WAITING:'배정 대기',CONFIRMED:'확정',NO_MATCH:'일정 조정',REALLOCATING:'재배정 중',PENDING:'대기',RUNNING:'처리 중',DONE:'완료',DEAD:'확인 필요',CANCELED:'취소',CANCELLED:'취소'};
  const paid = payments.rows.find((row: PaymentSummary) => row.status === 'PAID');
  const jobCount = jobs.rows.reduce((sum: number, row: JobSummary) => sum + Number(row.count), 0);

  return (
    <>
      <TopNav user={user} />
      <main className="page">
        <div className="page-heading">
          <div className="eyebrow">ADMIN · OVERVIEW</div>
          <h1>신청과 결제</h1>
          <p>참가자 정보와 결제 상태를 확인해요.</p>
        </div>
        <div className="metrics">
          <div><small>신청</small><strong>{applications.rowCount}</strong></div>
          <div><small>결제 완료</small><strong>{paid?.count ?? 0}</strong></div>
          <div><small>결제액</small><strong>₩{Number(paid?.amount ?? 0).toLocaleString()}</strong></div>
          <div><small>예약 작업</small><strong>{jobCount}</strong></div>
        </div>
        <section className="panel">
          <div className="section-title"><h2>신청 목록</h2><span className="status-pill">전체 신청</span></div>
          {applications.rows.length === 0 ? <div className="empty-card">아직 신청이 없어요.</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>신청자</th><th>일정</th><th>참가권</th><th>결제</th><th>매칭</th><th>신청일</th></tr></thead>
                <tbody>{applications.rows.map((row: ApplicationRow) => (
                  <tr key={row.id}>
                    <td><strong>{row.display_name ?? '프로필 미작성'}</strong><small>신청 {row.id.slice(0,8)} · {row.birth_year ? new Date().getFullYear() - Number(row.birth_year) : '—'}세</small></td>
                    <td>{(row.event_titles ?? []).filter(Boolean).join(', ') || '—'}<small>{(row.areas ?? []).filter(Boolean).join(' · ')}</small></td>
                    <td>{labels[row.pass_choice]??row.pass_choice}<small>₩{Number(row.amount_cents).toLocaleString()}</small></td>
                    <td><span className={`status-pill ${row.payment_status === 'PAID' ? 'green' : ''}`}>{labels[row.payment_status]??row.payment_status}</span></td>
                    <td><span className="status-pill">{labels[row.matching_status]??row.matching_status}</span></td>
                    <td>{new Date(row.created_at).toLocaleDateString('ko-KR')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel">
          <h2>결제 상태 합계</h2>
          <div className="list-stack">{payments.rows.map((row: PaymentSummary) => <div className="list-row" key={row.status}><strong>{labels[row.status]??row.status}</strong><span>{row.count}건 · ₩{Number(row.amount).toLocaleString()}</span></div>)}</div>
          <h2 className="section-spaced">예약 작업</h2>
          <div className="list-stack">{jobs.rows.map((row: JobSummary) => <div className="list-row" key={row.status}><strong>{labels[row.status]??row.status}</strong><span>{row.count}건</span></div>)}</div>
        </section>
      </main>
    </>
  );
}
