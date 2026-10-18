import {requireUser} from '@/lib/auth';
import {JourneyLayout} from '@/components/journey-ui';
import {ProfileForm} from '@/components/profile-form';
export default async function EditProfile(){await requireUser();return <JourneyLayout title="내 프로필" back="/profile" focus><section className="panel"><ProfileForm/></section></JourneyLayout>;}
