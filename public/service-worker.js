self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function roomUrl(data) {
  return typeof data?.roomId === 'string' && /^[\w-]{1,80}$/.test(data.roomId) ? `/#room=${encodeURIComponent(data.roomId)}` : '/';
}
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json() || {}; } catch { payload = {}; }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 120) : 'Говори';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 240) : 'Новое сообщение в общей беседе';
  const url = roomUrl(payload.data);
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: '/icons/govori-192.png', badge: '/icons/govori.svg',
    tag: `govori:${url}`, data: { url },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = event.notification.data?.url;
  const target = new URL(typeof path === 'string' && /^\/\#room=[\w-]{1,80}$/.test(path) ? path : '/', self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = clients.find(item => new URL(item.url).origin === self.location.origin);
    if (client) { await client.navigate(target); return client.focus(); }
    return self.clients.openWindow(target);
  })());
});
