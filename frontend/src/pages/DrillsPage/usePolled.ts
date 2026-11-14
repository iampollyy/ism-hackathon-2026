// Load something from the API, then again every few seconds while the page is
// open (one request at a time). The last good answer stays on screen when a
// refresh fails; `error` then says why, and `stale` is true.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';

export type Polled<T> = {
  data: T | null;
  /** A plain sentence, or null. */
  error: string | null;
  /** The API answered 404: what was asked for does not exist. */
  notFound: boolean;
  /** Data is shown, but the latest refresh failed. */
  stale: boolean;
  loading: boolean;
  reload: () => void;
};

export function usePolled<T>(load: () => Promise<T>, key: string, intervalMs: number | null, fallbackError: string): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reloadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let live = true;
    let inFlight = false;
    setData(null);
    setError(null);
    setNotFound(false);
    setLoading(true);
    const run = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await loadRef.current();
        if (!live) return;
        setData(next);
        setError(null);
        setNotFound(false);
      } catch (err) {
        if (!live) return;
        setError(err instanceof ApiError ? err.message : fallbackError);
        setNotFound(err instanceof ApiError && err.status === 404);
      } finally {
        inFlight = false;
        if (live) setLoading(false);
      }
    };
    reloadRef.current = () => void run();
    void run();
    const timer = intervalMs ? window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void run();
    }, intervalMs) : undefined;
    return () => {
      live = false;
      window.clearInterval(timer);
    };
    // `key` names what is loaded; the function itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs]);

  const reload = useCallback(() => reloadRef.current(), []);
  return { data, error, notFound, stale: !!data && !!error, loading, reload };
}
