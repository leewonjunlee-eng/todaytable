import { requireAdmin } from '@/lib/auth';
import { TopNav } from '@/components/top-nav';
import { SourceDataAdmin } from '@/components/source-data-admin';

export const dynamic = 'force-dynamic';
export default async function SourceDataPage() {
  const user = await requireAdmin();
  return <><TopNav user={user}/><main className="page"><div className="page-heading"><div className="eyebrow">ADMIN · SOURCE DATA</div><h1>제공 설문 원본</h1><p>가명 설문 원본을 검토하고, 선택한 응답만 명시적 가정과 함께 synthetic demo 데이터로 변환합니다.</p></div><SourceDataAdmin/></main></>;
}
