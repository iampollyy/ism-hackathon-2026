// Callback's service worker. It only shows notifications from Web Push
// (docs/backend.md, "Waking the phone: Web Push") and opens the phone page
// when one is tapped. It caches nothing and has no fetch handler, so a new
// deploy is always picked up on the next load.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const BODY_MAX = 180;
const text = (value, fallback) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
const short = (value) => (value.length <= BODY_MAX ? value : `${value.slice(0, BODY_MAX - 1).trimEnd()}…`);

/** Only a page of this site: a payload must never send a tap elsewhere. */
function sameSiteUrl(value) {
  const home = new URL('/', self.location.origin).href;
  try {
    const url = new URL(typeof value === 'string' && value ? value : '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : home;
  } catch {
    return home;
  }
}

/** The push as an object. Anything else (plain text, bad JSON, nothing) still
 * becomes a notification: a push that shows none is held against the site. */
function readPush(event) {
  if (!event.data) return {};
  try {
    const data = event.data.json();
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    return typeof data === 'string' ? { body: data } : {};
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

self.addEventListener('push', (event) => {
  const data = readPush(event);
  const ringing = data.type === 'incoming_call';
  const title = text(data.title, ringing ? 'Incoming call' : 'Callback');
  const body = short(text(data.body, ringing ? 'Open Callback to answer.' : 'Open Callback to see what is new.'));
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: text(data.tag, ringing ? 'callback-call' : 'callback'),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    requireInteraction: ringing,
    renotify: ringing,
    vibrate: ringing ? [400, 200, 400, 200, 400] : undefined,
    data: { url: sameSiteUrl(data.url), type: text(data.type, 'unknown') },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(sameSiteUrl(event.notification.data && event.notification.data.url));
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // The phone page already open (in a tab or the installed app): bring it
    // forward. It polls phone-state, so a ringing call is already on it.
    const open = windows.find((client) => new URL(client.url).pathname === target.pathname);
    if (open) return open.focus();
    const opened = await self.clients.openWindow(target.href);
    if (opened) return opened;
    // Some browsers refuse a new window here: send a page of ours there instead.
    const other = windows.find((client) => 'navigate' in client);
    if (!other) return undefined;
    const moved = await other.navigate(target.href);
    return moved ? moved.focus() : undefined;
  })());
});
