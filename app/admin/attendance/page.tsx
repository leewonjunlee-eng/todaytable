// @ts-nocheck
import {requireAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import Link from 'next/link';
export const dynamic='force-dynamic';
export default async function AdminAttendancePage() {
  await requireAdmin();
  const rows = (await db.query(`SELECT a.id, a.application_id, a.event_id, a.status FROM attendance_records a ORDER BY a.created_at DESC LIMIT 30`)) as any[] || [];
  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">참석 / 피드백 (Step D)</h1>
      <table className="w-full text-sm border-collapse border"><thead><tr className="bg-stone-100"><th>ID</th><th>신청</th><th>이벤트</th><th>상태</th></tr></thead><tbody>
        {rows.map((r:any)=><tr key={r.id} className="border-b"><td>{r.id.slice(0,8)}</td><td>{r.application_id}</td><td>{r.event_id}</td><td>{r.status}</td></tr>)}
      </tbody></table>
      <p className="mt-4 text-xs text-stone-500">참석 체크 + 1~5점 피드백은 운영자가 기록함.</p>
      <Link href="/admin/reservation" className="text-amber-700 underline">← 예약/확정</Link>
    </main>
  );
}
