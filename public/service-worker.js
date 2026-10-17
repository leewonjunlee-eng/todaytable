self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || '' }; }
  const title = data.title || '오늘의 식탁';
  const options = { body: data.body || data.message || '새로운 안내가 있어요.', data: { url: typeof data.url === 'string' ? data.url : '/' } };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url;
  let url = '/';
  try { const candidate = new URL(target || '/', self.location.origin); if (candidate.origin === self.location.origin) url = candidate.href; } catch { url = self.location.origin + '/'; }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => 'focus' in client);
    if (existing) { existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  }));
});
