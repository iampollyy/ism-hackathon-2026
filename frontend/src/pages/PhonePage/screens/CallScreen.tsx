import { useEffect, useState } from 'react';
import { HeartHandshake, PhoneOff, ShieldCheck, UserRound } from 'lucide-react';
import type { Mode } from '@elevenlabs/client';
import { ShieldLayer, type ShieldState } from './ShieldWarning';

type CallScreenProps = {
  title: string;
  number: string | null;
  variant: 'practice' | 'welcome' | 'family_line';
  startedAt: number;
  connected: boolean;
  mode: Mode | null;
  /** End was tapped while the call was still connecting. */
  ending?: boolean;
  /** Callback Shield, only during a Shield call (null on every drill). */
  shield?: ShieldState | null;
  /** The welcome call records the member's own side: say so, plainly. */
  recording?: boolean;
  /** A plain line under the call, e.g. who answers the practice line. */
  note?: string;
  onCallBack?: (hasNumber: boolean) => void;
  onEnd: () => void;
};

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function useSecondsSince(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  return (now - startedAt) / 1000;
}

/** The in-call screen, for a practice, a welcome call or the family line. */
export function CallScreen({
  title,
  number,
  variant,
  startedAt,
  connected,
  mode,
  ending = false,
  shield = null,
  recording = false,
  note,
  onCallBack,
  onEnd,
}: CallScreenProps) {
  const seconds = useSecondsSince(startedAt);
  const [shieldFolded, setShieldFolded] = useState(false);
  // While the full Shield warning covers the screen, nothing under it can be
  // reached by keyboard or screen reader.
  const covered = Boolean(shield?.warn) && !shieldFolded;
  const status = ending
    ? 'Ending…'
    : !connected
      ? variant === 'family_line'
        ? 'Calling…'
        : 'Connecting…'
      : mode === 'speaking'
        ? 'Speaking'
        : 'Listening';
  const Icon = variant === 'family_line' ? HeartHandshake : variant === 'welcome' ? ShieldCheck : UserRound;

  return (
    <main
      className={`phone-screen phone-dark phone-in-call phone-in-call--${variant}${shield?.warn ? ' is-warned' : ''}`}
    >
      {shield && (
        <ShieldLayer
          shield={shield}
          folded={shieldFolded}
          onFold={setShieldFolded}
          onHangUp={onEnd}
          onCallBack={onCallBack ?? (() => onEnd())}
        />
      )}

      <div className="call-head" inert={covered}>
        <span className="call-avatar call-avatar--small" aria-hidden="true">
          <Icon size={36} strokeWidth={1.6} />
        </span>
        <h1 className="call-title">{title}</h1>
        {number && <p className="call-number">{number}</p>}
        <p className="call-timer" aria-label="Call time">
          {clock(seconds)}
        </p>
        <p className={`call-mode ${connected && mode === 'speaking' ? 'is-speaking' : ''}`} aria-live="polite">
          <span className="call-mode__bars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          {status}
        </p>
      </div>

      {variant === 'welcome' && (
        <section className="call-note" aria-label="About this call" inert={covered}>
          {recording && (
            <p className="call-note__recording" role="status">
              <span className="call-note__dot" aria-hidden="true" />
              Recording your side of the call
            </p>
          )}
          <p className="call-note__text">
            {recording
              ? 'Callback keeps it only if you agreed when you joined and say yes on the call. You can delete it any time.'
              : 'Just talk as you normally would. There are no wrong answers.'}
          </p>
        </section>
      )}

      {variant !== 'welcome' && note && (
        <section className="call-note" aria-label="About this call" inert={covered}>
          <p className="call-note__text">{note}</p>
        </section>
      )}

      <div className="call-buttons call-buttons--single" inert={covered}>
        <div className="call-button">
          <button
            type="button"
            className="round-button round-button--red"
            onClick={onEnd}
            disabled={ending}
            aria-label="End call"
          >
            <PhoneOff size={32} aria-hidden="true" />
          </button>
          <span>End</span>
        </div>
      </div>
    </main>
  );
}
