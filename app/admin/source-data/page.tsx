import { requireAdmin } from '@/lib/auth';
import { TopNav } from '@/components/top-nav';
import { SourceDataAdmin } from '@/components/source-data-admin';

export const dynamic = 'force-dynamic';
export default async function SourceDataPage() {
  const user = await requireAdmin();
  return <><TopNav user={user}/><main id="main-content" className="page"><div className="page-heading"><div className="eyebrow">ADMIN · SOURCE DATA</div><h1>제공 설문 원본</h1><p>참가 설문 원본을 확인하고, 선택한 응답을 참가 자료로 연결합니다.</p></div><SourceDataAdmin/></main></>;
}
