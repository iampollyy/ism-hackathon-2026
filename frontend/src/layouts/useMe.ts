// Who is logged in, shared by the layout and every page that asks. One
// request to GET /api/auth/me at a time; 401 means logged out. The session is
// an HttpOnly cookie (cb_session) the page never sees: same-origin fetch sends
// it, so logging in or out only has to update this store.

import { useEffect, useSyncExternalStore } from 'react';
import { api, ApiError } from '../api/client';
import type { Me } from '../api/types';
import { forgetFamilyId, storedFamilyId } from '../pages/FamilySignUpPage/familyStorage';

export type MeState =
  | { status: 'loading' }
  | { status: 'in'; me: Me }
  | { status: 'out' }
  | { status: 'error'; message: string };

let state: MeState = { status: 'loading' };
let inFlight: Promise<MeState> | null = null;
let retryTimer: number | undefined;
const listeners = new Set<() => void>();

const RETRY_MS = 5000;

function set(next: MeState): MeState {
  state = next;
  listeners.forEach((listener) => listener());
  return next;
}

/** Ask the server again (after creating a family, for example). */
export function refreshMe(): Promise<MeState> {
  if (inFlight) return inFlight;
  window.clearTimeout(retryTimer);
  inFlight = api
    .me()
    .then(
      (me) => set({ status: 'in', me }),
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) return set({ status: 'out' });
        // No answer (a restarting server, no connection): keep what we knew
        // and try again shortly, so nobody is shown as logged out by mistake.
        retryTimer = window.setTimeout(() => void refreshMe(), RETRY_MS);
        if (state.status === 'in') return state;
        return set({
          status: 'error',
          message: error instanceof ApiError ? error.message : 'Callback could not be reached.',
        });
      },
    )
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** After a log-in or a new account: the answer is already the /me body. */
export function setSignedIn(me: Me): void {
  set({ status: 'in', me });
}

/**
 * Log out on the server, then everywhere on the page. The last family opened
 * is forgotten too, whoever it belonged to: on a shared laptop the menu must
 * not keep showing it to the next person.
 */
export async function logOut(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // The cookie may already be gone; the page still forgets the account.
  }
  const stored = storedFamilyId();
  if (stored) forgetFamilyId(stored);
  set({ status: 'out' });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The logged-in account (and its families), or 'out', or still 'loading'. */
export function useMe(): MeState {
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (state.status === 'loading' && !inFlight) void refreshMe();
  }, []);
  return current;
}

/**
 * A return path from ?next=, only if it stays on this site: it must start
 * with one slash (never //host or /\host), so a link cannot send someone away.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}

/** /login or /register with a way back to `next`. */
export function authPath(page: 'login' | 'register', next?: string | null): string {
  const back = safeNext(next);
  return back ? `/${page}?next=${encodeURIComponent(back)}` : `/${page}`;
}

/** Where to go once logged in: the return path, the only family, or the list. */
export function homeAfterLogin(me: Me, next?: string | null): string {
  const back = safeNext(next);
  if (back && back !== '/login' && back !== '/register') return back;
  if (me.families.length === 1) return `/family/${me.families[0].id}`;
  return '/families';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
