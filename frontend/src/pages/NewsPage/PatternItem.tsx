import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { NewsView } from '../../api/types';
import { DrillOutcome } from '../LearnPage/DrillOutcome';
import { shortDate, type Drill } from '../LearnPage/shared';

type Pattern = NewsView['patterns'][number];

/** At most this many people under one pattern; the drills page has the rest. */
const SHOWN_PEOPLE = 3;

type PatternItemProps = {
  pattern: Pattern;
  familyId: string;
  /** The title of the closest practice story, when it is known. */
  scenarioTitle: string | null;
  /** Each person's latest practice of the closest story; null while unknown. */
  practised: Drill[] | null;
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

/** One scam pattern from the digest, set like an item in a briefing, with
 * where the family stands on it: who already had this kind of practice call. */
export function PatternItem({ pattern, familyId, scenarioTitle, practised }: PatternItemProps) {
  const sources = pattern.sources.filter((source) => isWebLink(source.url));
  const shown = practised?.slice(0, SHOWN_PEOPLE) ?? [];
  const more = (practised?.length ?? 0) - shown.length;

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

      {pattern.closest_scenario ? (
        <div className="np-family">
          {practised === null ? null : shown.length > 0 ? (
            <div className="np-family__body">
              <h3 className="np-label">Practised in the family</h3>
              <ul className="np-family__list">
                {shown.map((drill) => (
                  <li key={drill.call_id}>
                    <Link to={`/calls/${drill.call_id}`} className="np-family__drill" title="Open the replay">
                      <span className="np-family__who">
                        <strong>{drill.member.name}</strong>
                        <time dateTime={drill.ended_at ?? drill.created_at}>
                          {shortDate(drill.ended_at ?? drill.created_at)}
                        </time>
                      </span>
                      <DrillOutcome drill={drill} />
                      <ArrowRight size={14} className="np-family__go" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              {more > 0 ? (
                <Link to={`/family/${familyId}/drills`} className="np-family__more">
                  {more === 1 ? 'And one more person' : `And ${more} more people`}
                </Link>
              ) : null}
            </div>
          ) : (
            <p className="np-family__none">Nobody in the family has had this practice call yet.</p>
          )}

          <Link to={`/family/${familyId}#practice`} className="np-practise">
            <span>
              Practise this one
              <strong>{scenarioTitle ?? 'Choose who and when'}</strong>
            </span>
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
      ) : null}

      {sources.length > 0 ? (
        <footer className="np-pattern__foot">
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
        </footer>
      ) : null}
    </article>
  );
}
