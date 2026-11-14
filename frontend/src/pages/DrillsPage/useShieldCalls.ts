// Which drills are Shield demo calls, and how many people the Shield alerted.
// The drills list (GET /api/families/{id}/drills) does not say, so a drill's
// call is read (GET /api/calls/{id}, its `shield`) once it has left
// `scheduled`. A call's `shield` is set from the moment it is created, so
// "is it a Shield call" is remembered for the session after one read. While a
// Shield call is still ringing, live or being scored, its `alerted` count can
// still grow, so it is read again on each refresh of the list until the call
// is over. Three requests at a time; a failed read is tried again on the next
// refresh of the list.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { DrillView } from './reviewWords';

export type ShieldInfo = { alerted: number; alertedAt: string | null };

// Once a call is in one of these, nothing about its Shield changes any more
// (a late risk check may still alert while a call is `ended` and being scored).
const OVER = ['scored', 'declined', 'missed', 'failed'];

/** call_id -> true for a Shield call, false for an ordinary drill. */
const isShield = new Map<string, boolean>();
/** call_id -> the latest Shield answer, for Shield calls. */
const info = new Map<string, ShieldInfo>();
/** Shield calls whose answer is final. */
const settled = new Set<string>();
const reading = new Set<string>();
const listeners = new Set<() => void>();

function needsReading(drill: DrillView): boolean {
  if (drill.status === 'scheduled') return false;
  const known = isShield.get(drill.call_id);
  if (known === undefined) return true;
  return known && !settled.has(drill.call_id);
}

async function readAll(ids: string[]): Promise<void> {
  const queue = ids.filter((id) => !reading.has(id));
  if (!queue.length) return;
  queue.forEach((id) => reading.add(id));
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const call = await api.getCall(id);
        isShield.set(id, !!call.shield);
        if (call.shield) {
          info.set(id, { alerted: call.shield.alerted, alertedAt: call.shield.alerted_at ?? null });
          if (OVER.includes(call.status)) settled.add(id);
        }
      } catch {
        // Not known yet: the next refresh of the list asks again.
      } finally {
        reading.delete(id);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  // Every page using the hook hears it, also one whose own read was skipped
  // because this one was already asking.
  listeners.forEach((listener) => listener());
}

export function useShieldCalls(drills: DrillView[] | null | undefined): Map<string, ShieldInfo> {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // `drills` is a new list on every refresh, so this runs again each time:
  // live Shield calls are read again, and failed reads are retried.
  useEffect(() => {
    const ids = (drills ?? []).filter(needsReading).map((drill) => drill.call_id);
    if (ids.length) void readAll(ids);
  }, [drills]);

  return useMemo(() => {
    const found = new Map<string, ShieldInfo>();
    for (const drill of drills ?? []) {
      const shield = isShield.get(drill.call_id) ? info.get(drill.call_id) : undefined;
      if (shield) found.set(drill.call_id, shield);
    }
    return found;
    // `version` says the cache has changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drills, version]);
}
