import { ago, nextCheck } from '../../hooks/useLiveNews';
import './LiveStamp.scss';

type LiveStampProps = {
  updatedAt: string | null;
  now: number;
  /** The briefing is examples or carried over, not this hour's news. */
  stale?: boolean;
  tone?: 'light' | 'deep';
};

/** "● Live · updated 8 min ago · next check at 14:05", with a calm pulse. */
export function LiveStamp({ updatedAt, now, stale = false, tone = 'light' }: LiveStampProps) {
  const when = ago(updatedAt, now);
  return (
    <span className={`live-stamp live-stamp--${tone} ${stale ? 'is-stale' : ''}`}>
      <span className="live-stamp__pill">
        <span className="live-stamp__dot" aria-hidden="true" />
        {stale ? 'Updating' : 'Live'}
      </span>
      <span className="live-stamp__text">
        {when ? <>Updated {when}</> : 'Reading the warnings'}
        <span aria-hidden="true"> · </span>
        next check {nextCheck(stale ? null : updatedAt, now)}
      </span>
    </span>
  );
}
