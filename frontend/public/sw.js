// Callback's service worker. It only shows notifications from Web Push
// (docs/backend.md, "Waking the phone: Web Push"); it caches nothing, so a
// new deploy is always picked up on the next load.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const ringing = data.type === 'incoming_call';
  event.waitUntil(self.registration.showNotification(data.title || 'Callback', {
    body: data.body || '',
    tag: data.tag || 'callback',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    requireInteraction: ringing,
    renotify: ringing,
    vibrate: ringing ? [400, 200, 400, 200, 400] : undefined,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url === url && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
