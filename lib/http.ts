export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const expected = new URL(process.env.APP_URL ?? request.url);
    return new URL(origin).origin === expected.origin;
  } catch {
    return false;
  }
}
