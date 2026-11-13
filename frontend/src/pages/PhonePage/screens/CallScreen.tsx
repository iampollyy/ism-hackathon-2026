import { useEffect, useState } from 'react';
import { HeartHandshake, PhoneOff, ShieldCheck, UserRound } from 'lucide-react';
import type { Mode } from '@elevenlabs/client';

type CallScreenProps = {
  title: string;
  number: string | null;
  variant: 'practice' | 'welcome' | 'family_line';
  startedAt: number;
  connected: boolean;
  mode: Mode | null;
  /** End was tapped while the call was still connecting. */
  ending?: boolean;
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
export function CallScreen({ title, number, variant, startedAt, connected, mode, ending = false, onEnd }: CallScreenProps) {
  const seconds = useSecondsSince(startedAt);
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
    <main className={`phone-screen phone-dark phone-in-call phone-in-call--${variant}`}>
      <div className="call-head">
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

      <div className="call-buttons call-buttons--single">
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
