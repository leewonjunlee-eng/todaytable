import Link from 'next/link';
import {requireUser} from '@/lib/auth';
import {JourneyLayout} from '@/components/journey-ui';
import {ApplicationForm} from '@/components/application-form';
export default async function ApplyPage({searchParams}:{searchParams:Promise<{eventId?:string}>}){const {eventId}=await searchParams;await requireUser();return <JourneyLayout title="저녁 신청하기" back="/applications" focus><section className="panel"><ApplicationForm initialEventId={eventId}/></section><p className="fineprint">4~6명이 함께하는 소규모 저녁 모임입니다. <Link href="/profile/edit">프로필과 동의 항목</Link>을 먼저 확인해 주세요.</p></JourneyLayout>;}
