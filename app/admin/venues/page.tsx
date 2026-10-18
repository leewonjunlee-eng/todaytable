import {Suspense} from 'react';
import {RestaurantCatalog} from '@/components/restaurant-catalog';
import {requireAdmin} from '@/lib/auth';
import {VenueForm} from '@/components/admin-forms';
export const dynamic='force-dynamic';
export default async function VenuesPage(){
  await requireAdmin();
  return (
    <>
      <Suspense fallback={<p className="muted">식당 목록을 불러오는 중…</p>}>
        <RestaurantCatalog admin/>
      </Suspense>
      <section className="page">
        <details className="panel detail-disclosure">
          <summary>새 식당 등록</summary>
          <VenueForm/>
        </details>
      </section>
    </>
  );
}
