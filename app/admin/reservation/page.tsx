// @ts-nocheck
import {requireAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import Link from 'next/link';
export const dynamic='force-dynamic';
export default async function AdminReservationPage() {
  await requireAdmin();
  const events = (await db.query(`SELECT id, title, area, status FROM events WHERE status = 'OPEN' ORDER BY starts_at DESC LIMIT 20`)) as any[] || [];
  const venues = (await db.query(`SELECT id, name, area FROM venues WHERE active = true ORDER BY area, name`)) as any[] || [];
  const reservations = (await db.query(`SELECT r.id, r.event_id, r.venue_id, r.status, e.title as etitle FROM reservations r JOIN events e ON r.event_id = e.id ORDER BY r.created_at DESC LIMIT 20`)) as any[] || [];
  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">예약 / 확정 (Step B)</h1>
      <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); fetch('/api/admin/reservation', {method:'POST', body: JSON.stringify({event_id: fd.get('event_id'), venue_id: fd.get('venue_id')})}); }} className="flex gap-2 mb-6 items-end">
        <div>
          <label className="block text-xs">이벤트</label>
          <select name="event_id" className="border px-2 py-1 rounded text-sm"><option value="">선택</option>{events.map((e:any)=><option key={e.id} value={e.id}>{e.title}</option>)}</select>
        </div>
        <div>
          <label className="block text-xs">식당</label>
          <select name="venue_id" className="border px-2 py-1 rounded text-sm"><option value="">선택</option>{venues.map((v:any)=><option key={v.id} value={v.id}>{v.name} ({v.area})</option>)}</select>
        </div>
        <button type="submit" className="bg-amber-600 text-white px-3 py-1 rounded text-sm">확정 예약</button>
      </form>
      <h2 className="font-bold mb-2">확정된 예약</h2>
      <table className="w-full text-sm border-collapse border mb-6"><thead><tr className="bg-stone-100"><th>ID</th><th>이벤트</th><th>식당</th><th>상태</th></tr></thead><tbody>
        {reservations.map((r:any)=><tr key={r.id} className="border-b"><td>{r.id.slice(0,8)}</td><td>{r.etitle}</td><td>{r.venue_id}</td><td>{r.status}</td></tr>)}
      </tbody></table>
      <Link href="/admin/applications" className="text-amber-700 underline">← 운영자 신청/결제 목록</Link>
    </main>
  );
}
