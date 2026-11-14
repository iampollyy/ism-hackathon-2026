import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { NewsView } from '../../api/types';
import { shortDate } from '../LearnPage/shared';

type Pattern = NewsView['patterns'][number];

type PatternItemProps = {
  pattern: Pattern;
  familyId: string;
  /** The title of the closest practice story, when it is known. */
  scenarioTitle: string | null;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isWebLink(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** One scam pattern from the digest, set like an item in a briefing. */
export function PatternItem({ pattern, familyId, scenarioTitle }: PatternItemProps) {
  const sources = pattern.sources.filter((source) => isWebLink(source.url));

  return (
    <article className="np-pattern">
      <h2 className="np-pattern__title">{pattern.title}</h2>
      <p className="np-pattern__summary">{pattern.summary}</p>

      {pattern.tactics.length > 0 ? (
        <div className="np-pattern__row">
          <h3 className="np-label">Listen for</h3>
          <ul className="np-chips">
            {pattern.tactics.map((tactic) => (
              <li key={tactic.key}>
                <Link
                  to={`/family/${familyId}/learn#tactic-${tactic.key}`}
                  className="np-chip"
                  title={`What "${tactic.label}" sounds like, and what to do`}
                >
                  {tactic.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <footer className="np-pattern__foot">
        {sources.length > 0 ? (
          <div className="np-sources">
            <h3 className="np-label">{sources.length === 1 ? 'Source' : 'Sources'}</h3>
            <ul>
              {sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="np-source">
                    {hostOf(source.url)}
                    <ArrowUpRight size={14} aria-hidden />
                    <span className="rd-sr"> (opens in a new tab)</span>
                  </a>
                  {source.date ? <span className="np-source__date">read {shortDate(source.date)}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {pattern.closest_scenario ? (
          <Link to={`/family/${familyId}#practice`} className="np-practise">
            <span>
              Closest practice call
              <strong>{scenarioTitle ?? 'Practise this with the family'}</strong>
            </span>
            <ArrowRight size={16} aria-hidden />
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
