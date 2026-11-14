// The phone page as an installed app, and Web Push call alerts
// (docs/backend.md, "Waking the phone: Web Push").
//
// Push is only a wake-up: a notification whose tap opens this page, which
// then polls phone-state as always. Everything here is optional; the page
// works the same without it, so every failure ends in a plain status.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, api } from '../../api/client';

// ---------------------------------------------------------------- where we are

/** Opened from the Home Screen icon (an installed app), not a browser tab. */
export function isInstalled(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  } catch {
    // no matchMedia: an old browser, so not installed
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone or iPad. iPadOS says it is a Mac, but a Mac has no touch screen. */
export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The home-screen icon opens this member's phone page. index.html points the
 * manifest link at it only when the page loads at /phone/{id}; after the Join
 * tap the page arrives here client-side, so it is set again on mount. */
export function useMemberManifest(memberId: string) {
  useEffect(() => {
    const link = document.getElementById('manifest');
    if (memberId && link instanceof HTMLLinkElement) {
      link.href = `/api/members/${encodeURIComponent(memberId)}/manifest.webmanifest`;
    }
  }, [memberId]);
}

// ---------------------------------------------------------------- installing

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
let installedNow = false;
const installListeners = new Set<() => void>();
const notifyInstall = () => installListeners.forEach((listener) => listener());

/** Called once from main.tsx, before React renders: Chrome may fire
 * beforeinstallprompt before the phone page mounts. Only the member's own
 * pages (join, phone) keep it for their "Install Callback" button; on every
 * other page Chrome's own install hint is left alone. */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!/^\/(phone|join)\//.test(window.location.pathname)) return;
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    notifyInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedNow = true;
    notifyInstall();
  });
}

function subscribeInstall(listener: () => void) {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

const dismissKey = (memberId: string) => `callback.install-dismissed.${memberId}`;

function readDismissed(memberId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(memberId)) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(memberId: string, dismissed: boolean) {
  try {
    if (dismissed) window.localStorage.setItem(dismissKey(memberId), '1');
    else window.localStorage.removeItem(dismissKey(memberId));
  } catch {
    // private mode or blocked storage: the card simply comes back next time
  }
}

/** What to offer: Chrome's own install prompt, the iPhone steps, or nothing
 * (installed already, or a browser that cannot install). */
export type InstallOffer = 'prompt' | 'ios' | 'none';

export function useInstallOffer(memberId: string) {
  const prompt = useSyncExternalStore(subscribeInstall, () => deferredPrompt);
  const justInstalled = useSyncExternalStore(subscribeInstall, () => installedNow);
  const [dismissed, setDismissed] = useState(() => readDismissed(memberId));
  const [installed] = useState(isInstalled);
  const [ios] = useState(isIos);

  const offer: InstallOffer = installed || justInstalled ? 'none' : prompt ? 'prompt' : ios ? 'ios' : 'none';

  const dismiss = useCallback(() => {
    writeDismissed(memberId, true);
    setDismissed(true);
  }, [memberId]);

  const showAgain = useCallback(() => {
    writeDismissed(memberId, false);
    setDismissed(false);
  }, [memberId]);

  const install = useCallback(async () => {
    const event = deferredPrompt;
    if (!event) return;
    // A prompt can be shown once; the browser fires a new event if it may ask again.
    deferredPrompt = null;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === 'accepted') installedNow = true;
    } catch {
      // the browser refused to show it; nothing to do
    }
    notifyInstall();
  }, []);

  return { offer, installed: installed || justInstalled, dismissed, dismiss, showAgain, install };
}

// ---------------------------------------------------------------- call alerts (Web Push)

export type AlertsStatus =
  | 'checking' // finding out what this phone can do
  | 'off' // can be switched on with a tap
  | 'working' // asking, subscribing or saving
  | 'on'
  | 'blocked' // notifications refused; only the phone's settings can change that
  | 'needs_install' // iPhone in a Safari tab: push works only in the installed app
  | 'unsupported'
  | 'server_off' // push is off on the back end (no VAPID keys)
  | 'error';

const SW_TIMEOUT_MS = 10_000;

export const fromB64url = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));

const toB64url = (buffer: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class AlertsError extends Error {}

/** The service worker that shows the notifications (main.tsx registers it on load). */
async function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('/sw.js');
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new AlertsError('not_ready')), SW_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

/** Made for another key (the back end has new VAPID keys): it cannot be used. */
function madeForOtherKey(subscription: PushSubscription, publicKey: string): boolean {
  const key = subscription.options?.applicationServerKey;
  return key != null && toB64url(key) !== publicKey;
}

/** Subscribe this browser (or reuse its subscription) and hand it to the back end.
 * With onlyExisting, nothing new is created: a page load re-syncs what the
 * person already switched on, and never switches it on for them. */
async function syncSubscription(memberId: string, publicKey: string, onlyExisting: boolean): Promise<boolean> {
  const registration = await serviceWorkerReady();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription && onlyExisting) return false;
  if (subscription && madeForOtherKey(subscription, publicKey)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromB64url(publicKey),
  });
  await api.subscribePush(memberId, subscription.toJSON());
  return true;
}

/** Safari before 15 answers requestPermission with a callback, not a promise. */
function requestPermission(): Promise<NotificationPermission> {
  return new Promise((resolve) => {
    const answer = Notification.requestPermission(resolve);
    if (answer) void answer.then(resolve);
  });
}

function plainAlertsError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === 'network'
      ? 'No connection to Callback. Check the internet and try again.'
      : 'Callback could not save this phone for alerts. Please try again.';
  }
  if (error instanceof AlertsError) return 'This page is not ready for alerts yet. Reload it and try again.';
  return 'This browser could not switch on alerts right now. Please try again later.';
}

export function usePushAlerts(memberId: string) {
  const [status, setStatus] = useState<AlertsStatus>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const show = useCallback((next: AlertsStatus, text: string | null = null) => {
    setStatus(next);
    setMessage(text);
  }, []);

  // On load: what can this phone do, and re-sync a subscription it already has.
  useEffect(() => {
    let live = true;
    const set = (next: AlertsStatus, text: string | null = null) => {
      if (live) show(next, text);
    };
    void (async () => {
      if (isIos() && !isInstalled()) return set('needs_install');
      if (!pushSupported()) return set('unsupported');
      let key;
      try {
        key = await api.pushPublicKey();
      } catch (error) {
        return set('error', plainAlertsError(error));
      }
      if (!key.enabled || !key.public_key) return set('server_off');
      keyRef.current = key.public_key;
      if (Notification.permission === 'denied') return set('blocked');
      if (Notification.permission !== 'granted') return set('off');
      try {
        set((await syncSubscription(memberId, key.public_key, true)) ? 'on' : 'off');
      } catch (error) {
        set('error', plainAlertsError(error));
      }
    })();
    return () => {
      live = false;
    };
  }, [memberId, show]);

  /** The tap on "Get call alerts". */
  const switchOn = useCallback(() => {
    if (!pushSupported()) return show('unsupported');
    // Ask first, straight from the tap and before anything awaits: iOS
    // refuses a permission request that does not come from one.
    const asking = requestPermission();
    show('working');
    void (async () => {
      try {
        const permission = await asking;
        if (permission === 'denied') return show('blocked');
        if (permission !== 'granted') return show('off', 'Nothing was changed. Tap again whenever you like.');
        let publicKey = keyRef.current;
        if (!publicKey) {
          const key = await api.pushPublicKey();
          if (!key.enabled || !key.public_key) return show('server_off');
          publicKey = keyRef.current = key.public_key;
        }
        await syncSubscription(memberId, publicKey, false);
        show('on');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') return show('blocked');
        console.warn('Call alerts could not be switched on', error);
        show('error', plainAlertsError(error));
      }
    })();
  }, [memberId, show]);

  /** "Turn off": this browser stops listening, and the back end forgets it. */
  const switchOff = useCallback(() => {
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await api.unsubscribePush(memberId, subscription.endpoint).catch(() => undefined);
          await subscription.unsubscribe();
        }
        show('off', 'Call alerts are off on this phone.');
      } catch (error) {
        show('error', plainAlertsError(error));
      }
    })();
  }, [memberId, show]);

  return { status, message, switchOn, switchOff };
}
