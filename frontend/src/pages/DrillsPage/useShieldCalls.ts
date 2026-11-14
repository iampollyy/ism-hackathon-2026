// Which drills were Shield demo calls, and how many people the Shield alerted.
// The drills list (GET /api/families/{id}/drills) does not say, so each
// finished drill's call is read once (GET /api/calls/{id}, its `shield`) and
// remembered for the session: once a call is over its Shield answer never
// changes. Three requests at a time; a failed read is tried again on the next
// refresh of the list.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { DrillView } from './reviewWords';

export type ShieldInfo = { alerted: number; alertedAt: string | null };

// Read once nothing more can change (a late risk check may still alert while
// a call is `ended` and being scored).
const OVER = ['scored', 'declined', 'missed', 'failed'];

/** call_id -> its Shield, or null for an ordinary drill. */
const known = new Map<string, ShieldInfo | null>();
const reading = new Set<string>();

async function readAll(ids: string[]): Promise<void> {
  const queue = ids.filter((id) => !known.has(id) && !reading.has(id));
  queue.forEach((id) => reading.add(id));
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const call = await api.getCall(id);
        known.set(id, call.shield ? { alerted: call.shield.alerted, alertedAt: call.shield.alerted_at ?? null } : null);
      } catch {
        // Not known yet: the next refresh asks again.
      } finally {
        reading.delete(id);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

export function useShieldCalls(drills: DrillView[] | null | undefined): Map<string, ShieldInfo> {
  const [version, setVersion] = useState(0);
  const unknown = (drills ?? [])
    .filter((drill) => OVER.includes(drill.status) && !known.has(drill.call_id))
    .map((drill) => drill.call_id);
  const key = unknown.join(',');

  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    void readAll(key.split(',')).then(() => {
      if (live) setVersion((value) => value + 1);
    });
    return () => {
      live = false;
    };
  }, [key]);

  return useMemo(() => {
    const found = new Map<string, ShieldInfo>();
    for (const drill of drills ?? []) {
      const shield = known.get(drill.call_id);
      if (shield) found.set(drill.call_id, shield);
    }
    return found;
    // `version` says the cache has grown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drills, version]);
}
