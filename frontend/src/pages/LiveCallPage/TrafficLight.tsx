import { CheckCheck, Ear } from 'lucide-react';
import type { RiskLevel, RiskPointView } from '../../api/types';

const HEADINGS: Record<RiskLevel, string> = {
  green: 'Nothing worrying yet',
  yellow: 'Be careful',
  red: 'Warning signs',
};

const LAMPS: readonly RiskLevel[] = ['red', 'yellow', 'green'];

type TrafficLightProps = {
  risk: RiskPointView | null;
  /** Signals the caller marked as tactics too. */
  callerMarked: Set<string>;
  /** The caller is talking now and nothing has been read yet. */
  listening: boolean;
  /** The call is over: the light holds its last reading. */
  over: boolean;
  /** The panel's name (default "Risk check"). */
  title?: string;
};

/** The live risk check: an independent read of the caller's words. */
export function TrafficLight({ risk, callerMarked, listening, over, title = 'Risk check' }: TrafficLightProps) {
  const level: RiskLevel = risk?.level ?? 'green';
  const reason = risk?.reason?.trim();
  const showReason = !!reason && reason.toLowerCase() !== HEADINGS[level].toLowerCase();
  const chips = (risk?.labels ?? []).map((label, index) => ({ label, signal: risk?.signals[index] ?? '' }));
  const agreed = chips.some((chip) => callerMarked.has(chip.signal));

  return (
    <section className={`lc-card lc-light lc-light--${level}`} aria-labelledby="lc-light-title">
      <div className="lc-light__top">
        <span className="small-label" id="lc-light-title">{title}</span>
        {listening ? (
          <span className="lc-light__state"><Ear size={14} /> Listening to the caller</span>
        ) : over ? (
          <span className="lc-light__state">Final reading</span>
        ) : null}
      </div>

      <div className="lc-light__body">
        <div className="lc-light__housing" role="img" aria-label={`Risk light: ${level}`}>
          {LAMPS.map((lamp) => (
            <span key={lamp} className={`lc-lamp lc-lamp--${lamp}${lamp === level ? ' is-on' : ''}`}>
              {lamp === level ? <span key={`${lamp}-${risk?.turn_index ?? 'start'}`} className="lc-lamp__burst" /> : null}
            </span>
          ))}
        </div>

        <div className="lc-light__text" role="status" aria-live="polite">
          <strong key={level} className="lc-light__heading">{HEADINGS[level]}</strong>
          {showReason ? <p className="lc-light__reason">{reason}</p> : null}
          {chips.length ? (
            <div className="lc-light__chips">
              {chips.map(({ label, signal }) => (
                <span
                  key={label}
                  className={`lc-signal${callerMarked.has(signal) ? ' is-agreed' : ''}`}
                  title={callerMarked.has(signal) ? 'The caller marked this tactic too' : undefined}
                >
                  {callerMarked.has(signal) ? <CheckCheck size={13} aria-hidden /> : null}
                  {label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <p className="lc-light__note">
        An independent check that reads only what the caller says, never the tactics it marks.
        {agreed ? <> <CheckCheck size={12} aria-hidden /> means the caller marked the same tactic.</> : null}
      </p>
    </section>
  );
}
