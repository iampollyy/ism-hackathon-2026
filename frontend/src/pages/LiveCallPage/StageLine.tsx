import type { Stage } from './liveCallState';

type StageLineProps = {
  stages: Stage[];
  /** The call is going on: the furthest stage pulses. */
  live: boolean;
  stopped: Stage | null;
  targetName: string;
};

/** The scam's stages as a small progress line, from what actually happened. */
export function StageLine({ stages, live, stopped, targetName }: StageLineProps) {
  let current = -1;
  stages.forEach((stage, index) => {
    if (stage.reached) current = index;
  });

  return (
    <section className="lc-card lc-stages" aria-label="The scam's stages">
      <div className="lc-stages__top">
        <span className="small-label">The scam’s stages</span>
        {stopped ? (
          <span className="lc-stages__stopped">{targetName} stopped it at “{stopped.label}”</span>
        ) : null}
      </div>
      <ol className="lc-stages__line">
        {stages.map((stage, index) => {
          const classes = ['lc-stage'];
          if (stage.reached) classes.push('is-reached');
          if (index === current && live) classes.push('is-current');
          if (stage.key === 'reveal') classes.push('is-reveal');
          if (stopped?.key === stage.key) classes.push('is-stopped');
          if (index < current && !stage.reached) classes.push('is-skipped');
          return (
            <li key={stage.key} className={classes.join(' ')}>
              <span className="lc-stage__dot" aria-hidden />
              <span className="lc-stage__label">{stage.label}</span>
              <span className="sr-only">{stage.reached ? 'reached' : 'not reached'}</span>
            </li>
          );
        })}
      </ol>
      <p className="lc-stages__note">Worked out from the caller’s lines, the tactics it marked and the risk check.</p>
    </section>
  );
}
