import {requireAdmin} from '@/lib/auth';
import {VenueBookings} from '@/components/venue-bookings';
export const dynamic='force-dynamic';
export default async function Bookings({searchParams}:{searchParams:Promise<{tableId?:string;proposalId?:string}>}){await requireAdmin();const params=await searchParams;return <VenueBookings initialTableId={params.tableId} initialProposalId={params.proposalId}/>;}
