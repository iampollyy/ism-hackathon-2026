import { ArrowUpRight, LoaderCircle, Radar, RotateCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { LiveStamp } from '../../../components/molecules/LiveStamp';
import { useLiveNews, useNow } from '../../../hooks/useLiveNews';
import { plainError } from '../usePhone';

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

function day(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DAY.format(date);
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/** The scam calls going around now, for the member's family, kept fresh by
 * itself: the server rebuilds the briefing every hour and this tab looks again
 * every couple of minutes while it is open. */
export function NewsTab({ familyId, memberId }: { familyId: string; memberId: string }) {
  const { news, error, fresh, reload } = useLiveNews(familyId);
  const now = useNow();
  const [checking, setChecking] = useState(false);

  const checkNow = async () => {
    setChecking(true);
    await reload();
    setChecking(false);
  };

  if (error && !news) {
    return (
      <div className="phone-tab-state" role="alert">
        <p>{plainError(error, 'The news could not be loaded. Please try again.')}</p>
        <button type="button" className="phone-quiet-button" onClick={() => void checkNow()}>
          <RotateCw size={18} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }
  if (!news) {
    return (
      <div className="phone-tab-state" aria-busy="true">
        <LoaderCircle className="phone-spin" size={22} aria-hidden="true" />
        <p>Loading…</p>
      </div>
    );
  }

  const note = news.notes.find((item) => item.member.id === memberId) ?? null;
  const examples = news.fallback && news.patterns.every((pattern) => pattern.sources.length === 0);
  const sourceHosts = [
    ...new Set(news.patterns.flatMap((pattern) => pattern.sources.filter((s) => isWebLink(s.url)).map((s) => host(s.url)))),
  ];
  const count = news.patterns.length;

  return (
    <div className="phone-news">
      <section className="news-hero" aria-labelledby="news-hero-title">
        <div className="news-hero__radar" aria-hidden="true">
          <span />
          <span />
          <span />
          <Radar size={22} />
        </div>
        <LiveStamp tone="deep" updatedAt={news.updated_at} now={now} stale={news.fallback} />
        <h2 id="news-hero-title" className="news-hero__title">
          {examples ? 'Scam calls to know about' : 'Scam calls going around now'}
        </h2>
        <p className="news-hero__text">
          {count === 0
            ? 'Callback is reading this hour’s public scam warnings. The first briefing shows here in a few minutes.'
            : examples
              ? 'Well-known scam calls, while Callback reads this hour’s warnings.'
              : `${count} ${count === 1 ? 'pattern' : 'patterns'} from public scam warnings, checked every hour.`}
        </p>
        {sourceHosts.length > 0 && (
          <ul className="news-hero__sources" aria-label="Read from">
            {sourceHosts.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="news-hero__check"
          onClick={() => void checkNow()}
          disabled={checking}
          aria-label="Check for news now"
        >
          <RotateCw size={16} className={checking ? 'phone-spin' : undefined} aria-hidden="true" />
        </button>
      </section>

      <div aria-live="polite" className="news-fresh-slot">
        {fresh && (
          <p className="news-fresh">
            <Sparkles size={16} aria-hidden="true" />
            New briefing just in
          </p>
        )}
      </div>

      {note && (
        <section className="phone-news__note" aria-label="Your note this week">
          <p>{note.text}</p>
          {day(note.when) && <span>{day(note.when)}</span>}
        </section>
      )}

      {count === 0 ? (
        <div className="news-cards" aria-busy="true" aria-label="The first briefing is on its way">
          {[0, 1, 2].map((index) => (
            <div key={index} className="news-card news-card--ghost" style={{ ['--i' as string]: index }}>
              <span className="news-ghost news-ghost--short" />
              <span className="news-ghost" />
              <span className="news-ghost news-ghost--mid" />
            </div>
          ))}
        </div>
      ) : (
        <ol className="news-cards" key={news.updated_at ?? 'news'}>
          {news.patterns.map((pattern, index) => {
            const sources = pattern.sources.filter((source) => isWebLink(source.url));
            return (
              <li key={pattern.title} className="news-card" style={{ ['--i' as string]: index }}>
                <span className="news-card__number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="news-card__title">{pattern.title}</h3>
                <p className="news-card__summary">{pattern.summary}</p>
                {pattern.tactics.length > 0 && (
                  <div className="news-card__listen">
                    <span className="news-card__label">Listen for</span>
                    <ul className="news-card__chips">
                      {pattern.tactics.map((tactic) => (
                        <li key={tactic.key}>{tactic.label}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {sources.length > 0 && (
                  <ul className="news-card__sources">
                    {sources.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          {host(source.url)}
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </a>
                        {day(source.date) && <span>{day(source.date)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <p className="news-foot">
        The same briefing for every family on Callback. If a call sounds like one of these: hang up, and call back on
        the number you know.
      </p>
    </div>
  );
}
