import { configuredRequestOrigin, siteOrigins } from './site-origins';

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const expected = new URL(configuredRequestOrigin(request.headers, request.url) ?? siteOrigins().participant ?? request.url);
    return new URL(origin).origin === expected.origin;
  } catch {
    return false;
  }
}

export function publicRequestOrigin(request: Request) {
  return configuredRequestOrigin(request.headers, request.url) ?? siteOrigins().participant ?? new URL(request.url).origin;
}
