// Load something, then again every few seconds, one request at a time.
// Writes go through guard(): polls wait while a write is out, and an answer
// that left before the write is dropped, so a slow poll never puts back the
// value the person just changed.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';

export type Poll<T> = {
  data: T | null;
  error: ApiError | null;
  refresh: () => void;
  /** Show a value the page just got (from a write's answer, or optimistically). */
  accept: (value: T) => void;
  /** Run a write; polls pause until it is done. */
  guard: <R>(work: () => Promise<R>) => Promise<R>;
};

function asApiError(error: unknown, fallback: string): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'error', fallback);
}

/** key: what is loaded (null: nothing yet); a new key starts again from empty. */
export function usePoll<T>(key: string | null, load: () => Promise<T>, everyMs: number, fallback: string): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const version = useRef(0);
  const writes = useRef(0);
  const run = useRef<() => void>(() => undefined);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    setData(null);
    setError(null);
    if (key === null) return;
    let live = true;
    let inFlight = false;
    const tick = async () => {
      if (inFlight || writes.current > 0) return;
      inFlight = true;
      const started = version.current;
      try {
        const next = await loadRef.current();
        if (!live || started !== version.current || writes.current > 0) return;
        setData(next);
        setError(null);
      } catch (caught) {
        if (live) setError(asApiError(caught, fallback));
      } finally {
        inFlight = false;
      }
    };
    run.current = () => void tick();
    void tick();
    const timer = window.setInterval(() => void tick(), everyMs);
    return () => {
      live = false;
      run.current = () => undefined;
      window.clearInterval(timer);
    };
  }, [key, everyMs, fallback]);

  const refresh = useCallback(() => run.current(), []);
  const accept = useCallback((value: T) => {
    version.current += 1;
    setData(value);
  }, []);
  const guard = useCallback(async <R,>(work: () => Promise<R>): Promise<R> => {
    writes.current += 1;
    version.current += 1;
    try {
      return await work();
    } finally {
      writes.current -= 1;
    }
  }, []);

  return { data, error, refresh, accept, guard };
}
