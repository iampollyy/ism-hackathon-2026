import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, RotateCw } from 'lucide-react';
import { api } from '../../../api/client';
import type { NewsView } from '../../../api/types';
import { TacticBadge } from '../../../components/molecules/TacticBadge';
import { plainError } from '../usePhone';

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });

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

/** This week's scam news for the member's family, and their own weekly note. */
export function NewsTab({ familyId, memberId }: { familyId: string; memberId: string }) {
  const [news, setNews] = useState<NewsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.news(familyId).then(setNews, (failure: unknown) =>
      setError(plainError(failure, 'The news could not be loaded. Please try again.')),
    );
  }, [familyId]);

  useEffect(load, [load]);

  if (error) {
    return (
      <div className="phone-tab-state" role="alert">
        <p>{error}</p>
        <button type="button" className="phone-quiet-button" onClick={load}>
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
  const heading = news.fallback ? (news.week ? 'Earlier scam news' : 'Examples of scam calls') : 'Scam calls this week';

  return (
    <div className="phone-news">
      {note && (
        <section className="phone-news__note" aria-label="Your note this week">
          <p>{note.text}</p>
          {day(note.when) && <span>{day(note.when)}</span>}
        </section>
      )}

      <section aria-labelledby="news-patterns">
        <h2 className="phone-section-title" id="news-patterns">
          {heading}
        </h2>
        {news.patterns.length === 0 ? (
          <p className="phone-section-text">No scam news yet. When Callback reads this week’s warnings, they will show here.</p>
        ) : (
          <div className="phone-signs">
            {news.patterns.map((pattern) => (
              <article key={pattern.title} className="phone-sign">
                <header className="phone-sign__head">
                  <h3>{pattern.title}</h3>
                </header>
                <p className="phone-sign__do">{pattern.summary}</p>
                {pattern.tactics.length > 0 && (
                  <div className="phone-result__chips">
                    {pattern.tactics.map((tactic) => (
                      <TacticBadge key={tactic.key} label={tactic.label} />
                    ))}
                  </div>
                )}
                {pattern.sources.length > 0 && (
                  <ul className="phone-news__sources">
                    {pattern.sources.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {host(source.url)}
                          <ExternalLink size={14} aria-hidden="true" />
                        </a>
                        {day(source.date) && <span> · read {day(source.date)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
