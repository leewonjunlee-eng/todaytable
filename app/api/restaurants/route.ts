import {venueCatalog} from '@/lib/venues';
export const dynamic='force-dynamic';
export async function GET(){return Response.json({venues:await venueCatalog()});}
