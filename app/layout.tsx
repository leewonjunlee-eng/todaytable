import type { Metadata } from 'next';import './globals.css';
export const metadata:Metadata={title:'우연한 식탁 | Todaytable',description:'낯선 사람과 나누는 따뜻한 저녁'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
