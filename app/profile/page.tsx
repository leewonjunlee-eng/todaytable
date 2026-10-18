import {requireUser} from '@/lib/auth';
import {ProfileHub} from '@/components/profile-hub';
export default async function ProfilePage(){await requireUser();return <ProfileHub/>;}
