import {requireUser} from '@/lib/auth';
import {JourneyLayout} from '@/components/journey-ui';
import {PreferencesPanel} from '@/components/preferences-panel';
export default async function Preferences(){await requireUser();return <JourneyLayout title="다음 만남 선호" back="/profile" focus><PreferencesPanel showTitle={false}/></JourneyLayout>;}
