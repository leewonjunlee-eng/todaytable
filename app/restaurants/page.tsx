import {requireUser} from '@/lib/auth';
import {RestaurantCatalog} from '@/components/restaurant-catalog';
export default async function Restaurants(){await requireUser();return <RestaurantCatalog/>;}
