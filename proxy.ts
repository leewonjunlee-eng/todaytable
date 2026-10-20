import { NextResponse, type NextRequest } from 'next/server';
import { configuredRequestOrigin, siteOrigins } from './lib/site-origins';

export function proxy(request: NextRequest) {
  const { participant, operator } = siteOrigins();
  const headers=new Headers(request.headers);
  headers.set('x-todaytable-path',request.nextUrl.pathname+request.nextUrl.search);
  const next=()=>NextResponse.next({request:{headers}});
  if (!participant || !operator) return next();
  const origin = configuredRequestOrigin(request.headers, request.url);
  const path = request.nextUrl.pathname;
  let destination: string | undefined;
  if (origin === participant && (path === '/admin' || path.startsWith('/admin/'))) {
    destination = new URL(path + request.nextUrl.search, operator).href;
  } else if (origin === operator) {
    if (path === '/') destination = new URL('/admin', operator).href;
    else if (path === '/login') destination = new URL('/admin/login', operator).href;
    else if (path !== '/admin' && !path.startsWith('/admin/')) destination = new URL(path + request.nextUrl.search, participant).href;
  }
  return destination ? NextResponse.redirect(destination, 307) : next();
}

export const config = {
  matcher: ['/((?!api(?:/|$)|_next(?:/|$)|favicon.ico|manifest.webmanifest|sw.js|.*\\.[^/]+$).*)'],
};
