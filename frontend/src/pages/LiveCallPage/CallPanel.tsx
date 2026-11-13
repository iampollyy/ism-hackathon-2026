import { useEffect, useState } from 'react';
import { Phone, PhoneCall, PhoneIncoming, PhoneOff } from 'lucide-react';
import type { CallStatus, CallView, EndedBy } from '../../api/types';
import { clock, possessive } from './format';
import { parseTime } from './liveCallState';
import type { Connection } from './useLiveCall';

const STATUS_PILL: Record<CallStatus, { text: string; tone: 'good' | 'warn' | 'accent' | 'neutral' }> = {
  scheduled: { text: 'Scheduled', tone: 'neutral' },
  ringing: { text: 'Ringing', tone: 'accent' },
  in_progress: { text: 'In call', tone: 'accent' },
  ended: { text: 'Call ended', tone: 'neutral' },
  scored: { text: 'Finished', tone: 'good' },
  declined: { text: 'Declined', tone: 'neutral' },
  missed: { text: 'Not answered', tone: 'neutral' },
  failed: { text: 'Could not connect', tone: 'warn' },
};

function statusLine(status: CallStatus, target: string, endedBy: EndedBy | null): string {
  switch (status) {
    case 'scheduled': return `This practice will ring ${possessive(target)} phone soon.`;
    case 'ringing': return `${possessive(target)} phone is ringing.`;
    case 'in_progress': return `${target} is on the call.`;
    case 'ended': return endedBy === 'error' ? 'The voice could not connect. Wrapping up the call…' : 'The call has ended. Working out the result…';
    case 'scored': return endedBy === 'error' ? 'The call is over. The voice could not connect.' : 'The call is over.';
    case 'declined': return `${target} declined the call. That’s fine: no practice this time.`;
    case 'missed': return `${target} didn’t answer in time. No practice this time.`;
    case 'failed': return 'The call could not connect.';
    default: return '';
  }
}

/** Seconds since answered, ticking while the call is on. */
function useCallSeconds(answeredAt: string | null | undefined, endedAt: string | null | undefined, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);
  const start = parseTime(answeredAt);
  if (start === null) return running ? 0 : null;
  const end = running ? now : parseTime(endedAt);
  return end === null ? null : Math.max(0, (end - start) / 1000);
}

type CallPanelProps = {
  call: CallView;
  status: CallStatus;
  endedBy: EndedBy | null;
  connection: Connection;
};

/** The call itself: who is called, in whose voice, its state and its length. */
export function CallPanel({ call, status, endedBy, connection }: CallPanelProps) {
  const target = call.target.name || 'them';
  const running = status === 'in_progress';
  const seconds = useCallSeconds(call.answered_at, call.ended_at, running);
  const ringing = status === 'ringing' || status === 'scheduled';
  const answered = !ringing && !['declined', 'missed'].includes(status);
  const pill = STATUS_PILL[status];
  const unanswered = ['declined', 'missed', 'failed'].includes(status);
  const Icon = status === 'ringing' ? PhoneIncoming : running ? PhoneCall : unanswered ? PhoneOff : Phone;
  const connectionText = connection === 'live'
    ? 'Live'
    : connection === 'polling'
      ? 'Updating every second'
      : connection === 'connecting' && status !== 'scored' && !unanswered ? 'Connecting…' : '';

  let voiceLine: string | null = null;
  if (call.kind === 'practice' && answered) {
    // Whose voice it is shows only once the call is answered, never while it rings.
    voiceLine = call.voice_of
      ? `In ${possessive(call.voice_of.name)} voice, with ${possessive(call.voice_of.name)} permission`
      : 'In a voice from the library';
  }

  return (
    <section className={`call-stage lc-call lc-call--${status}`} aria-label="The call">
      <div className="lc-call__top">
        <span className={`status-pill ${pill.tone}`}>{pill.text}</span>
        {connectionText ? <span className={`lc-connection lc-connection--${connection}`}>{connectionText}</span> : null}
      </div>

      <div className="lc-call__main">
        <div className={`lc-call__icon${ringing || running ? ' is-active' : ''}${status === 'ringing' ? ' is-ringing' : ''}`} aria-hidden>
          <Icon size={30} />
        </div>
        <div className="call-meta lc-call__meta">
          <span className="small-label">{call.kind === 'family_line' ? 'Family line for' : 'Calling'}</span>
          <h2>{target}</h2>
          {voiceLine ? <p className="lc-call__voice">{voiceLine}</p> : null}
          {call.kind === 'practice' && call.caller_label ? (
            <p className="lc-call__caller">On {possessive(target)} phone: “{call.caller_label}”</p>
          ) : null}
        </div>
      </div>

      <div className="call-footer-row lc-call__footer">
        {unanswered && seconds === null ? null : (
          <div className="duration-block">
            <span>{running ? 'In call for' : 'Call length'}</span>
            <strong>{seconds === null ? (status === 'ringing' ? 'Ringing…' : status === 'scheduled' ? 'Not yet' : '–') : clock(seconds)}</strong>
          </div>
        )}
        <p className="lc-call__status">{statusLine(status, target, endedBy)}</p>
      </div>
    </section>
  );
}
