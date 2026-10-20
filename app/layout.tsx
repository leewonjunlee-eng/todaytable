import {SiteLinksProvider} from '@/components/site-links';
import {siteOrigins} from '@/lib/site-origins';
import {ReviewIntro} from '@/components/review-intro';
import type { Metadata, Viewport } from 'next';import './globals.css';import './evolution.css';import './mobile.css';import './experience.css';import './guide.css';import './participant-mobile.css';
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#fcfcf8'};
export const metadata:Metadata={title:'우연한 식탁 | Todaytable',description:'낯선 사람과 나누는 따뜻한 저녁'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body><a className="skip-link" href="#main-content">본문으로 바로 가기</a><SiteLinksProvider value={{participant:siteOrigins().participant??'/',operator:siteOrigins().operator??''}}><ReviewIntro/>{children}</SiteLinksProvider></body></html>}
