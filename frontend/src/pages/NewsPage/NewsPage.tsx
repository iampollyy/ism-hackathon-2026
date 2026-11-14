// The news page (/family/:familyId/news): this week's scam patterns (the
// weekly digest, shared by every family) and each member's latest weekly note,
// from GET /api/families/{id}/news. "Refresh news" asks for a new digest
// (POST …/news/refresh); it is allowed at most every few minutes for everyone
// together, so the button waits for next_refresh_at and every answer that did
// not build is explained politely. Old or built-in news is labelled as such.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, BookOpen, LoaderCircle, Newspaper, RefreshCw, RotateCcw } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { NewsRefreshed, NewsView } from '../../api/types';
import { dayAndTime, timeOrDay, useFamilyDrills, useFamilyName, type Drill } from '../LearnPage/shared';
import { NotesPanel } from './NotesPanel';
import { PatternItem } from './PatternItem';
import '../LearnPage/readingShared.scss';
import './NewsPage.scss';

/** After "too soon", look again once a build someone else started may be done. */
const RECHECK_MS = 60_000;

type Kind = 'none' | 'this-week' | 'earlier' | 'examples';
const TITLES: Record<Kind, string> = {
  none: "This week's scam calls",
  'this-week': "This week's scam calls",
  earlier: 'Recent scam calls',
  examples: 'Scam calls to know about',
};
type Notice = { tone: 'good' | 'calm' | 'warn'; text: string };
type LoadError = { notFound: boolean; message: string };

function kindOf(news: NewsView): Kind {
  if (news.patterns.length === 0) return 'none';
  if (!news.fallback) return 'this-week';
  return news.patterns.every((pattern) => pattern.sources.length === 0) ? 'examples' : 'earlier';
}

/** "2026-W46" -> "week 46". */
function weekWords(week: string | null): string | null {
  const match = week?.match(/W(\d{1,2})$/);
  return match ? `week ${Number(match[1])}` : null;
}

/** What to say after a refresh; null when the briefing's own note already says it. */
function noticeFor(answer: NewsRefreshed): Notice | null {
  if (answer.refreshed) return { tone: 'good', text: "Updated just now from this week's warnings." };
  // Nothing to show at all: never point at "the latest briefing".
  if (kindOf(answer) === 'none') {
    if (answer.reason === 'too_soon') {
      return { tone: 'calm', text: "A briefing is already being written. We'll look again in a minute." };
    }
    return {
      tone: answer.reason === 'failed' ? 'warn' : 'calm',
      text: "Callback couldn't write the briefing just now. Please try again in a few minutes.",
    };
  }
  switch (answer.reason) {
    case 'too_soon':
      return {
        tone: 'calm',
        text: "The briefing was refreshed a few minutes ago and may still be on its way. We'll look again in a minute.",
      };
    case 'fresh':
      return { tone: 'calm', text: 'This is already the latest briefing: it was updated a few minutes ago.' };
    case 'no_new_digest':
      // Examples or an earlier week: the note at the top of the briefing explains it.
      if (kindOf(answer) !== 'this-week') return null;
      return {
        tone: 'calm',
        text: "Callback couldn't write a new briefing just now, so this is the latest one we have. Please try again later.",
      };
    default:
      return {
        tone: 'warn',
        text: 'Something went wrong while reading the warnings. This is the latest briefing we have; please try again later.',
      };
  }
}

export function NewsPage() {
  const { familyId = '' } = useParams();
  const family = useFamilyName(familyId);

  const [news, setNews] = useState<NewsView | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [scenarioTitles, setScenarioTitles] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const recheck = useRef<number | undefined>(undefined);
  const live = useRef(true);
  const { drills } = useFamilyDrills(familyId);

  // Who in the family already had each kind of call: each person's latest
  // practice of that scenario, newest first (the list comes newest first).
  const practisedByScenario = useMemo(() => {
    const map = new Map<string, Drill[]>();
    for (const drill of drills ?? []) {
      if (!drill.scenario) continue;
      const list = map.get(drill.scenario) ?? [];
      if (!list.some((item) => item.member.id === drill.member.id)) list.push(drill);
      map.set(drill.scenario, list);
    }
    return map;
  }, [drills]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      window.clearTimeout(recheck.current);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await api.news(familyId);
      if (!live.current) return null;
      setNews(next);
      setLoadError(null);
      return next;
    } catch (error) {
      if (!live.current) return null;
      setLoadError({
        notFound: error instanceof ApiError && error.status === 404,
        message: error instanceof ApiError ? error.message : 'The news could not be loaded.',
      });
      return null;
    }
  }, [familyId]);

  useEffect(() => {
    setNews(null);
    setLoadError(null);
    setNotice(null);
    void load();
  }, [load]);

  // The closest practice story's title, for the "practise this" link.
  const wantsScenarios = Boolean(news?.patterns.some((pattern) => pattern.closest_scenario));
  useEffect(() => {
    if (!wantsScenarios) return;
    let active = true;
    api.scenarios().then(
      (list) => active && setScenarioTitles(Object.fromEntries(list.map((item) => [item.key, item.title]))),
      () => undefined, // the link still works without the title
    );
    return () => {
      active = false;
    };
  }, [wantsScenarios]);

  // Re-enable the button when the wait is over.
  const nextAt = news?.next_refresh_at ? Date.parse(news.next_refresh_at) : null;
  const waiting = nextAt !== null && nextAt > now;
  useEffect(() => {
    if (!waiting || nextAt === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(nextAt - Date.now() + 250, 60_000));
    return () => window.clearTimeout(timer);
  }, [waiting, nextAt, now]);

  const refresh = async () => {
    setRefreshing(true);
    setNotice(null);
    window.clearTimeout(recheck.current);
    try {
      const answer = await api.refreshNews(familyId);
      if (!live.current) return;
      const before = news?.updated_at ?? null;
      setNews(answer);
      setNow(Date.now());
      setNotice(noticeFor(answer));
      if (answer.reason === 'too_soon') {
        recheck.current = window.setTimeout(async () => {
          const later = await load();
          if (!live.current) return;
          setNow(Date.now());
          if (later && later.updated_at && later.updated_at !== before) {
            setNotice({ tone: 'good', text: 'The new briefing is in.' });
          }
        }, RECHECK_MS);
      }
    } catch (error) {
      if (!live.current) return;
      setNotice({
        tone: 'warn',
        text: error instanceof ApiError ? error.message : 'The news could not be refreshed. Please try again.',
      });
    } finally {
      if (live.current) setRefreshing(false);
    }
  };

  const kind = news ? kindOf(news) : 'none';
  const week = weekWords(news?.week ?? null);
  const notFound = Boolean(loadError?.notFound) || family.notFound;
  const title = TITLES[kind];

  if (notFound) {
    return (
      <div className="rd-page np-page">
        <header className="rd-head">
          <h1>Scam news</h1>
        </header>
        <section className="rd-empty" role="alert">
          <Newspaper size={28} aria-hidden />
          <h2>We couldn't find this family</h2>
          <p>The link may be from another server, or the family was removed.</p>
          <Link to="/families" className="button button-primary">
            Open your families
          </Link>
        </section>
      </div>
    );
  }

  const refreshButton = (
    <button
      type="button"
      className="button button-secondary np-refresh"
      onClick={() => void refresh()}
      disabled={refreshing || waiting || !news}
      aria-describedby="np-refresh-status"
    >
      {refreshing ? <LoaderCircle size={16} className="np-spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
      {refreshing ? 'Reading the warnings…' : 'Refresh news'}
    </button>
  );

  const refreshStatus = refreshing
    ? 'This can take up to a minute.'
    : waiting && news?.next_refresh_at
      ? `Shared by every family, so it can be refreshed again from ${timeOrDay(news.next_refresh_at)}.`
      : null;

  return (
    <div className="rd-page np-page">
      <header className="rd-head">
        <nav className="rd-crumbs" aria-label="Breadcrumb">
          <Link to={`/family/${familyId}`}>{family.name ?? 'Family page'}</Link>
          <span aria-hidden>/</span>
          <span aria-current="page">Scam news</span>
        </nav>
        <div className="rd-head__row">
          <div className="rd-head__text">
            <h1>{title}</h1>
            {news && kind !== 'none' ? (
              <p className="rd-meta">
                {kind === 'this-week' ? <span className="rd-tag rd-tag--good">This week</span> : null}
                {kind === 'earlier' ? <span className="rd-tag">{week ? `From ${week}` : 'Earlier'}</span> : null}
                {kind === 'examples' ? <span className="rd-tag">Examples</span> : null}
                {news.updated_at ? <span>Updated {dayAndTime(news.updated_at)}</span> : null}
              </p>
            ) : null}
            <p className="rd-lede">
              A short, calm briefing for the family: what's going around, the pressure each call leans on, and where we
              read about it.
            </p>
          </div>
          {news && kind !== 'none' ? (
            <div className="np-refresh-wrap">
              {refreshButton}
              <p id="np-refresh-status" className="np-refresh-status">
                {refreshStatus}
              </p>
            </div>
          ) : null}
        </div>
        <div aria-live="polite" className="np-notice-slot">
          {notice ? <p className={`np-notice np-notice--${notice.tone}`}>{notice.text}</p> : null}
        </div>
      </header>

      {loadError && !news ? (
        <section className="rd-empty" role="alert">
          <Newspaper size={28} aria-hidden />
          <h2>Can't reach Callback</h2>
          <p>{loadError.message}</p>
          <button type="button" className="button button-primary" onClick={() => void load()}>
            <RotateCcw size={16} aria-hidden /> Try again
          </button>
        </section>
      ) : !news ? (
        <NewsSkeleton />
      ) : (
        <div className="np-layout">
          <div className="np-main">
            {kind === 'none' ? (
              <section className="rd-empty np-empty" aria-labelledby="np-empty-title">
                <Newspaper size={28} aria-hidden />
                <h2 id="np-empty-title">No briefing yet</h2>
                <p>
                  Each week, Callback reads public scam warnings and turns them into a short briefing for the family.
                  There isn't one yet. Get it now: it can take up to a minute.
                </p>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void refresh()}
                  disabled={refreshing || waiting}
                >
                  {refreshing ? <LoaderCircle size={16} className="np-spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
                  {refreshing ? 'Reading the warnings…' : "Get this week's briefing"}
                </button>
                {refreshStatus ? <p className="np-empty__status">{refreshStatus}</p> : null}
              </section>
            ) : (
              <section className="np-paper" aria-label="The briefing">
                {kind === 'examples' ? (
                  <p className="np-fallback">
                    These are well-known scam calls, not this week's news: Callback couldn't read this week's warnings
                    yet. Refresh to try again.
                  </p>
                ) : null}
                {kind === 'earlier' ? (
                  <p className="np-fallback">
                    This briefing is from {week ?? 'an earlier week'}. This week's isn't ready yet; refresh to try again.
                  </p>
                ) : null}
                {news.patterns.map((pattern) => (
                  <PatternItem
                    key={pattern.title}
                    pattern={pattern}
                    familyId={familyId}
                    scenarioTitle={pattern.closest_scenario ? (scenarioTitles[pattern.closest_scenario] ?? null) : null}
                    practised={
                      drills === null || !pattern.closest_scenario
                        ? null
                        : (practisedByScenario.get(pattern.closest_scenario) ?? [])
                    }
                  />
                ))}
              </section>
            )}
          </div>

          <aside className="np-aside">
            <NotesPanel notes={news.notes} />
            <section className="np-panel np-about" aria-labelledby="np-about-title">
              <h2 id="np-about-title">Where this comes from</h2>
              <p>
                Each week, Callback reads public scam-warning pages and sums up the patterns in plain words. Each one
                links to where we read it. The briefing is the same for every family on Callback.
              </p>
              <Link to={`/family/${familyId}/learn`} className="np-about__link">
                <BookOpen size={16} aria-hidden /> How each tactic works <ArrowRight size={15} aria-hidden />
              </Link>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function NewsSkeleton() {
  return (
    <div className="np-layout" aria-busy="true" aria-label="Loading the news">
      <div className="rd-shimmer np-skeleton__paper" />
      <div className="rd-shimmer np-skeleton__aside" />
    </div>
  );
}
