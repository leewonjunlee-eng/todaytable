import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {ExperienceGuide} from '@/components/experience-guide';
export const metadata:Metadata={title:'참가자·운영자 이용 가이드 | 우연한 식탁',description:'실제 화면으로 살펴보는 참가자의 만남 여정과 운영자의 사용 방법'};
export const dynamic='force-dynamic';
export default async function Guide({searchParams}:{searchParams:Promise<{role?:string;step?:string}>}) {
  const params=await searchParams,user=await currentUser();
  const role=params.role==='operator'?'operator':'participant';
  const numeric=Number(params.step??1),step=Number.isInteger(numeric)&&numeric>=1&&numeric<=4?numeric:1;
  return <ExperienceGuide role={role} step={step} viewerRole={user?.role??null}/>;
}
