// The family's scam news, kept fresh while it is on screen. The server
// rebuilds the briefing by itself every hour (backend/app/services/news.py,
// keep_fresh_forever); this hook looks again every couple of minutes, at once
// when the page comes back to the front, and more often while the very first
// briefing is still being written. It notices when a new briefing lands, so
// the screen can say so.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { NewsView } from '../api/types';

/** How often to look again while the news is on screen. */
const POLL_MS = 120_000;
/** While there is no briefing yet, look more often: the first one is on its way. */
const POLL_EMPTY_MS = 20_000;
/** How long "New briefing just in" stays up. */
const FRESH_MS = 8_000;
/** The server's own rhythm (settings.news_auto_refresh_seconds). */
export const NEWS_EVERY_MS = 3_600_000;

export type LiveNews = {
  news: NewsView | null;
  error: unknown;
  /** True for a few seconds after a newer briefing arrived while watching. */
  fresh: boolean;
  /** Look again now (re-reads; it does not ask the server to rebuild). */
  reload: () => Promise<NewsView | null>;
  /** Replace what is shown, e.g. with the answer of a refresh. */
  setNews: (news: NewsView) => void;
};

export function useLiveNews(familyId: string): LiveNews {
  const [news, setNewsState] = useState<NewsView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [fresh, setFresh] = useState(false);
  const shownAt = useRef<string | null | undefined>(undefined);
  const freshTimer = useRef<number | undefined>(undefined);
  const live = useRef(true);

  const accept = useCallback((next: NewsView) => {
    const before = shownAt.current;
    shownAt.current = next.updated_at;
    // Something was shown already and a newer briefing replaced it.
    if (before !== undefined && next.updated_at && next.updated_at !== before && next.patterns.length > 0) {
      setFresh(true);
      window.clearTimeout(freshTimer.current);
      freshTimer.current = window.setTimeout(() => live.current && setFresh(false), FRESH_MS);
    }
    setNewsState(next);
    setError(null);
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await api.news(familyId);
      if (live.current) accept(next);
      return next;
    } catch (failure) {
      if (live.current) setError(failure);
      return null;
    }
  }, [familyId, accept]);

  useEffect(() => {
    live.current = true;
    shownAt.current = undefined;
    setNewsState(null);
    setError(null);
    void reload();
    return () => {
      live.current = false;
      window.clearTimeout(freshTimer.current);
    };
  }, [reload]);

  // Look again on a timer while visible, and at once when the page returns.
  const empty = news !== null && news.patterns.length === 0;
  useEffect(() => {
    const every = empty ? POLL_EMPTY_MS : POLL_MS;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, every);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [empty, reload]);

  return { news, error, fresh, reload, setNews: accept };
}

/** A clock that ticks every `ms`, for "updated 5 min ago" style words. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

/** "just now", "12 min ago", "2 h ago", "yesterday", "3 days ago". */
export function ago(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** When the server will look at the warnings again: "at 14:05", or "in a few minutes". */
export function nextCheck(iso: string | null | undefined, now: number): string {
  const then = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(then)) return 'in a few minutes';
  const next = then + NEWS_EVERY_MS;
  return next - now < 5 * 60_000 ? 'in a few minutes' : `at ${CLOCK.format(new Date(next))}`;
}
