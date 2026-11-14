import { CircleCheck } from 'lucide-react';
import type { Drill } from './shared';

/** What the person did on a practice call, said kindly: a safe outcome by name,
 * otherwise "a tip for next time", and "review on its way" while it is scored.
 * Styled by .rd-outcome in readingShared.scss. */
export function DrillOutcome({ drill, className = '' }: { drill: Drill; className?: string }) {
  const classes = `rd-outcome ${className}`.trim();
  if (drill.safe && drill.outcome_label) {
    return (
      <span className={`${classes} is-safe`}>
        <CircleCheck size={14} aria-hidden /> {drill.outcome_label}
      </span>
    );
  }
  if (drill.outcome) return <span className={classes}>A tip for next time</span>;
  return <span className={classes}>Review on its way</span>;
}
