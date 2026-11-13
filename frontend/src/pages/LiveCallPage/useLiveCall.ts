// Follows one call for the laptop: the call object for the header, then the
// live stream (GET /api/calls/{id}/events) for everything that happens.
//
// - The stream's events are all named, so each type gets its own listener.
// - It replays the whole call on connect; the reducer skips seqs it has seen.
// - It is closed once nothing more can happen: on `result` (or `scored`),
//   except that a practice keeps it open until the family number is tapped,
//   because `callback.connected` comes after the result. The back end ends the
//   stream itself ten minutes after the call, and a reconnect then gets 204.
// - If the stream errors or does not open within 3 s (through a tunnel, for
//   example), the screen polls the call object every second instead, and
//   rebuilds the whole state from it each time.

import { useEffect, useReducer, useState } from 'react';
import { api, ApiError, callStreamUrl } from '../../api/client';
import type { CallKind, CallStatus } from '../../api/types';
import { STREAM_EVENT_TYPES } from '../../api/types';
import {
  callbackWindowOver, FINAL_STATUSES, initialState, isCallDone, liveReducer, type RawEvent,
} from './liveCallState';

export type Connection = 'connecting' | 'live' | 'polling' | 'done';

const OPEN_TIMEOUT_MS = 3000;
const POLL_MS = 1000;
const BATCH_MS = 40; // a replay arrives as a burst: one render for the lot

export function useLiveCall(callId: string | undefined) {
  const [state, dispatch] = useReducer(liveReducer, initialState);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dispatch({ type: 'reset' });
    setConnection('connecting');
    setError(null);
    if (!callId) return undefined;

    let disposed = false;
    let source: EventSource | null = null;
    let polling = false;
    let opened = false;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    // What the stream has told us so far, to know when to close it.
    let kind: CallKind | null = null;
    let endedAt: string | null = null;
    let scored = false;
    let calledBack = false;
    let finalStatus = false;
    const nothingMoreToCome = () =>
      finalStatus || (scored && (kind === 'welcome' || kind === 'family_line' || calledBack || callbackWindowOver(endedAt)));

    const closeStream = () => {
      source?.close();
      source = null;
    };

    const fail = (err: unknown) => {
      if (err instanceof ApiError && err.status === 404) {
        setError('There is no call with this link. It may have been deleted, or the link is incomplete.');
        closeStream();
        setConnection('done');
        return true;
      }
      return false;
    };

    // ------------------------------------------------------------ the call object

    const loadCall = async () => {
      try {
        const call = await api.getCall(callId);
        if (disposed) return;
        kind = call.kind;
        endedAt = call.ended_at ?? null;
        dispatch({ type: 'snapshot', call, replace: false });
        if (source && nothingMoreToCome()) { // the stream said scored before we knew the kind
          closeStream();
          setConnection('done');
        }
      } catch (err) {
        if (!disposed) fail(err);
      }
    };

    // ------------------------------------------------------------ polling

    const startPolling = () => {
      if (polling || disposed) return;
      polling = true;
      closeStream();
      setConnection('polling');
      const tick = async () => {
        if (disposed) return;
        try {
          const call = await api.getCall(callId);
          if (disposed) return;
          dispatch({ type: 'snapshot', call, replace: true });
          if (isCallDone(call)) {
            setConnection('done');
            return;
          }
        } catch (err) {
          if (disposed || fail(err)) return;
        }
        later(tick, POLL_MS);
      };
      void tick();
    };

    // ------------------------------------------------------------ the stream

    let queue: RawEvent[] = [];
    let flushing = false;
    let refreshHeader = false;
    const flush = () => {
      flushing = false;
      if (disposed || polling || !queue.length) return;
      const events = queue;
      queue = [];
      dispatch({ type: 'events', events });
      if (refreshHeader) {
        refreshHeader = false;
        void loadCall(); // answered_at and ended_at, for the timer
      }
      if (nothingMoreToCome()) {
        closeStream();
        setConnection('done');
      }
    };

    const onEvent = (type: RawEvent['type']) => (message: Event) => {
      const { data, lastEventId } = message as MessageEvent<string>;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const fields = (parsed ?? {}) as Record<string, unknown>;
      if (type === 'call.status') {
        const status = fields.status as CallStatus;
        refreshHeader = true;
        if (status === 'scored') scored = true;
        if (FINAL_STATUSES.includes(status)) finalStatus = true;
      }
      if (type === 'result') scored = true;
      if (type === 'callback.connected') calledBack = true;
      queue.push({ type, data: parsed, seq: Number(lastEventId) });
      if (!flushing) {
        flushing = true;
        later(flush, BATCH_MS);
      }
    };

    void loadCall();

    if (typeof EventSource === 'undefined') {
      startPolling();
    } else {
      const stream = new EventSource(callStreamUrl(callId));
      source = stream;
      for (const type of STREAM_EVENT_TYPES) stream.addEventListener(type, onEvent(type));
      stream.onopen = () => {
        opened = true;
        if (!disposed && !polling) setConnection('live');
      };
      stream.onerror = () => {
        if (disposed || polling || source !== stream) return;
        if (nothingMoreToCome()) {
          closeStream();
          setConnection('done');
          return;
        }
        if (stream.readyState === EventSource.CLOSED) {
          startPolling(); // 204 or a refused connection: the browser will not retry
          return;
        }
        // The browser is reconnecting (with Last-Event-ID); poll if it takes too long.
        opened = false;
        later(() => {
          if (!opened && !disposed && source === stream) startPolling();
        }, OPEN_TIMEOUT_MS);
      };
      later(() => {
        if (!opened && !disposed && source === stream) startPolling();
      }, OPEN_TIMEOUT_MS);
    }

    return () => {
      disposed = true;
      closeStream();
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, [callId]);

  return { state, connection, error };
}
