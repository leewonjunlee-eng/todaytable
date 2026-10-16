// @ts-nocheck
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminMatchingPage() {
  await requireAdmin();
  const assignments = await db.query(`SELECT ta.id, ta.event_id, ta.table_name, ta.assigned_user_ids, e.title as event_title FROM table_assignments ta JOIN events e ON ta.event_id = e.id ORDER BY ta.created_at DESC LIMIT 50`) as any;
  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">매칭 / 테이블 할당 (Step A)</h1>
      <form action="/api/admin/matching" method="POST" className="mb-6 flex gap-2">
        <input name="event_id" placeholder="event ID (uuid)" className="border px-3 py-2 rounded" />
        <button type="submit" className="bg-amber-600 text-white px-4 py-2 rounded">매칭 실행 (순차 6명/테이블)</button>
      </form>
      <table className="w-full text-sm border-collapse border">
        <thead><tr className="bg-stone-100"><th>Table</th><th>Event</th><th>Assigned IDs</th><th>Created</th></tr></thead>
        <tbody>
          {(assignments as any[] || []).map((a: any) => (
            <tr key={a.id} className="border-b">
              <td className="px-2 py-1">{a.table_name}</td>
              <td className="px-2 py-1">{a.event_title || a.event_id}</td>
              <td className="px-2 py-1 font-mono text-xs">{a.assigned_user_ids?.slice(0,100) || '-'}</td>
              <td className="px-2 py-1">{a.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-stone-500 text-xs">의도: 신청 제출된 참가자 → 이벤트별 테이블 6명씩 순차 할당. 실제 매칭 엔진(연령/성비/MBTI)은 다음 단계.</p>
      <Link href="/admin/applications" className="text-amber-700 underline">← 운영자 신청/결제 목록</Link>
    </main>
  );
}
