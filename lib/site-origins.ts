/** Explicit public origins only; never build redirects from an untrusted Host. */
export function siteOrigins() {
  const parse = (value?: string) => {
    if (!value) return undefined;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Site URLs must be HTTP(S) origins without paths or credentials.');
    }
    return url.origin;
  };
  const participant = parse(process.env.APP_URL);
  const operator = parse(process.env.ADMIN_APP_URL);
  if (operator && operator === participant) throw new Error('ADMIN_APP_URL must differ from APP_URL.');
  return { participant, operator };
}

export function configuredRequestOrigin(headers: Pick<Headers, 'get'>, requestUrl?: string) {
  const { participant, operator } = siteOrigins();
  const origins = [participant, operator].filter((value): value is string => Boolean(value));
  // Railway terminates HTTPS before forwarding to the application.
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? (requestUrl ? new URL(requestUrl).host : null);
  return origins.find(origin => new URL(origin).host === host);
}

export function isOperatorHost(headers: Pick<Headers, 'get'>, requestUrl?: string) {
  const { operator } = siteOrigins();
  return Boolean(operator && configuredRequestOrigin(headers, requestUrl) === operator);
}
