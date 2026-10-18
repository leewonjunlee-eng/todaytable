import {ReviewIntro} from '@/components/review-intro';
import type { Metadata, Viewport } from 'next';import './globals.css';import './evolution.css';import './mobile.css';
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f7f4ee'};
export const metadata:Metadata={title:'우연한 식탁 | Todaytable',description:'낯선 사람과 나누는 따뜻한 저녁'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body><ReviewIntro/>{children}</body></html>}
