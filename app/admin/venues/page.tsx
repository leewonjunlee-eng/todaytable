import {RestaurantCatalog} from '@/components/restaurant-catalog';
import {requireAdmin} from '@/lib/auth';import {VenueForm} from '@/components/admin-forms';
export const dynamic='force-dynamic';export default async function VenuesPage(){await requireAdmin();return <><RestaurantCatalog admin/><section className="page"><details className="panel detail-disclosure"><summary>새 식당 등록</summary><VenueForm/></details></section></>}
