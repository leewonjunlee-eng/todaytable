import {requireUser} from '@/lib/auth';
import {JourneyLayout} from '@/components/journey-ui';
import {ProfileTest} from '@/components/profile-test';
import {loginDestination} from '@/lib/login-destination';
export default async function ProfileTestPage({searchParams}:{searchParams:Promise<{next?:string}>}){await requireUser();const next=loginDestination((await searchParams).next);return <JourneyLayout title="프로필과 매칭 취향" back="/profile" focus><section className="panel"><ProfileTest next={next}/></section></JourneyLayout>;}
