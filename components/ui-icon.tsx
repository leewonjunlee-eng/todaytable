import type {CSSProperties} from 'react';
const paths:Record<string,React.ReactNode>={
 home:<><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></>,
 table:<><circle cx="12" cy="12" r="7"/><path d="M3 4v5m-2-5v5m4-5v5M1 9h4M3 9v11M21 4c-3 2-3 7 0 8v8M21 4v8"/></>,
 plus:<path d="M12 5v14M5 12h14"/>,
 message:<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1V11.5a8.5 8.5 0 1 1 18 0ZM8 10h8M8 14h5"/>,
 user:<><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
 bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
 arrow:<path d="m9 5-7 7 7 7M3 12h18"/>,
 chevron:<path d="m9 5 7 7-7 7"/>,
 calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6M17 2v6M3 11h18M7 15h3M14 15h3"/></>,
 pin:<><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
 leaf:<><path d="M20 3C7 2 2 7 5 14s13 5 15-11ZM4 21 16 8"/></>,
};
export function UiIcon({name,size=20,style}:{name:string;size?:number;style?:CSSProperties}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]??paths.chevron}</svg>;}
