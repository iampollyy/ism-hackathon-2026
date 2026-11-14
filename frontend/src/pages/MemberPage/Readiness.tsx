// Readiness before and now, as segmented meters: one segment per point,
// light green for what they had at the welcome call, full green for what they
// gained since, and an outline for a point they had then and not now.

import type { ReadinessView } from '../../api/types';

type Segment = 'had' | 'gained' | 'dropped' | 'empty';

function segments(before: number, now: number, max: number): Segment[] {
  return Array.from({ length: Math.max(0, max) }, (_, index) => {
    if (index < Math.min(before, now)) return 'had';
    if (index < now) return 'gained';
    if (index < before) return 'dropped';
    return 'empty';
  });
}

function Meter({ before, now, max, label, big = false }: { before: number; now: number; max: number; label: string; big?: boolean }) {
  return (
    <span className={`rv-meter${big ? ' rv-meter--big' : ''}`} role="img" aria-label={`${label}: ${before} before, ${now} now, out of ${max}`}>
      {segments(before, now, max).map((segment, index) => (
        <i key={index} className={`rv-meter__seg is-${segment}`} style={{ animationDelay: `${index * 50}ms` }} />
      ))}
    </span>
  );
}

export function Readiness({ readiness, name }: { readiness: ReadinessView; name: string }) {
  const { before, now, max, items } = readiness;
  const gained = now - before;
  const nothingYet = before === 0 && now === 0;
  return (
    <section className="rv-panel rv-readiness" aria-labelledby="readiness-title">
      <div className="rv-panel__head">
        <h2 id="readiness-title">Readiness</h2>
        <ul className="rv-readiness__legend" aria-label="Key">
          <li><i className="is-had" aria-hidden /> At the welcome call</li>
          <li><i className="is-gained" aria-hidden /> Gained since</li>
        </ul>
      </div>

      <div className="rv-readiness__total">
        <p className="rv-readiness__score">
          <span className="rv-readiness__before">{before}</span>
          <span className="rv-readiness__arrow" aria-hidden>→</span>
          <strong>{now}</strong>
          <small>out of {max}</small>
        </p>
        <Meter before={before} now={now} max={max} label="Readiness" big />
        <p className="rv-readiness__sentence">
          {nothingYet
            ? `Nothing to show yet. The welcome call sets ${possessiveName(name)} starting point, and every drill moves it.`
            : gained > 0
              ? `${name} has gained ${gained} ${gained === 1 ? 'point' : 'points'} since the welcome call.`
              : gained === 0
                ? `The same as at the welcome call. The next drills show where to grow.`
                : `A little lower than at the welcome call: a good moment for a chat about the family word.`}
        </p>
      </div>

      <ul className="rv-readiness__items">
        {items.map((item) => (
          <li key={item.key}>
            <span className="rv-readiness__label">{item.label}</span>
            <Meter before={item.before} now={item.now} max={item.max} label={item.label} />
            <span className="rv-readiness__value">
              {item.before} <span aria-hidden>→</span> <strong>{item.now}</strong>
              <small> / {item.max}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function possessiveName(name: string): string {
  return `${name}’s`;
}
