import {requireUser} from '@/lib/auth';
import {JourneyLayout} from '@/components/journey-ui';
import {ProfileTest} from '@/components/profile-test';
export default async function ProfileTestPage(){await requireUser();return <JourneyLayout title="프로필과 매칭 취향" back="/profile" focus><section className="panel"><ProfileTest/></section></JourneyLayout>;}
