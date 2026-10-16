// @ts-nocheck
import {requireAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import Link from 'next/link';
export const dynamic='force-dynamic';
export default async function AdminNotificationPage() {
  await requireAdmin();
  const rows = (await db.query(`SELECT n.id, n.event_id, n.message, n.status, n.sent_by FROM notifications n ORDER BY n.created_at DESC LIMIT 30`)) as any[] || [];
  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">알림 / 공지 (Step C)</h1>
      <form action="/api/admin/notification" method="POST" className="mb-4 bg-stone-50 p-3 rounded" onSubmit={e => { e.preventDefault(); const fd=new FormData(e.currentTarget); fetch('/api/admin/notification',{method:'POST',body:JSON.stringify({message:fd.get('message'), event_id:fd.get('event_id')||null})}); }}>
        <input name="message" placeholder="공지 내용" className="border px-2 py-1 rounded text-sm w-full mb-2" />
        <input name="event_id" placeholder="event_id (선택)" className="border px-2 py-1 rounded text-sm mr-2" />
        <button type="submit" className="bg-amber-600 text-white px-3 py-1 rounded text-sm">발송</button>
      </form>
      <table className="w-full text-sm border-collapse border"><thead><tr className="bg-stone-100"><th>ID</th><th>이벤트</th><th>내용</th><th>상태</th></tr></thead><tbody>
        {rows.map((r:any)=><tr key={r.id} className="border-b"><td>{r.id.slice(0,8)}</td><td>{r.event_id||'-'}</td><td>{r.message}</td><td>{r.status}</td></tr>)}
      </tbody></table>
      <Link href="/admin/applications" className="text-amber-700 underline">← 운영자 신청/결제 목록</Link>
    </main>
  );
}
