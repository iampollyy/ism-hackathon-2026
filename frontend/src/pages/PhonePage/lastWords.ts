// The last requests of a page that is closing (a reload, a pull-to-refresh,
// the tab closed) while a call runs: the events still queued and the end.
//
// The api client's requests are cancelled when the page goes away, so these
// use fetch with `keepalive`, which the browser finishes after the page has
// gone (sendBeacon where that is missing). Browsers allow about 64 KB of
// keepalive bodies in flight, so the small events (tactics, the outcome,
// `revealed`, consent) always go, and as many lines as still fit.

import type { EndedBy, PhoneEvent } from '../../api/types';

const BUDGET_BYTES = 56 * 1024;
const MAX_BATCH = 100; // the back end's limit

export type LastWords = { callId: string; events: PhoneEvent[]; endedBy: EndedBy | null };

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

function postKeepalive(path: string, body: unknown): void {
  const url = `/api${path}`;
  const text = JSON.stringify(body);
  try {
    void fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: text,
    }).catch(() => undefined);
  } catch {
    try {
      navigator.sendBeacon?.(url, new Blob([text], { type: 'application/json' }));
    } catch {
      // Nothing more a closing page can do; the back end times the call out.
    }
  }
}

/** The events that fit in `budget` bytes, in their order. */
function fit(events: PhoneEvent[], budget: number): { kept: PhoneEvent[]; used: number } {
  const sizes = events.map((event) => bytes(JSON.stringify(event)) + 1);
  const keep = events.map((event) => event.type !== 'turn');
  let used = sizes.reduce((sum, size, i) => (keep[i] ? sum + size : sum), 0);
  events.forEach((event, i) => {
    if (keep[i] || used + sizes[i] > budget) return;
    keep[i] = true;
    used += sizes[i];
  });
  return { kept: events.filter((_, i) => keep[i]), used };
}

/** Send each call's queued events, then its end, in a way that survives the
 * page closing. Fire and forget. */
export function sendLastWords(calls: LastWords[]): void {
  let budget = BUDGET_BYTES - calls.length * 200; // room for the ends and the wrappers
  for (const call of calls) {
    const { kept, used } = fit(call.events, Math.max(0, budget));
    budget -= used;
    for (let i = 0; i < kept.length; i += MAX_BATCH) {
      postKeepalive(`/calls/${call.callId}/events`, { events: kept.slice(i, i + MAX_BATCH) });
    }
    if (call.endedBy) postKeepalive(`/calls/${call.callId}/end`, { ended_by: call.endedBy });
  }
}
