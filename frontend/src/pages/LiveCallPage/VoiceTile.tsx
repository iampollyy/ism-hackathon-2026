// On a welcome call: what became of the person's own side of the call, the
// recording their voice for family drills may be made from after a spoken yes
// (GET /api/calls/{id}/voice-sample/status, docs/full-app/voice-from-call.md).
// Polled every two seconds until the voice is ready or could not be made, or
// for a few minutes after the call when nothing is coming.

import { useEffect, useState } from 'react';
import { AudioLines, LoaderCircle, Mic, MicOff } from 'lucide-react';
import { api } from '../../api/client';
import type { CallStatus, VoiceSampleStatus } from '../../api/types';
import { duration } from './format';
import { parseTime } from './liveCallState';

const POLL_MS = 2000;
/** After the call, how long a recording may still arrive from the phone. */
const QUIET_AFTER_MS = 3 * 60 * 1000;
/** The back end's words while no recording has arrived (services/voice_sample.py
 * NO_RECORDING). Any other reason with state "none" is a refusal, such as no
 * consent to a voice from the call, and is final. */
const NO_RECORDING = 'No recording from this call yet.';

type VoiceTileProps = {
  callId: string;
  target: string;
  status: CallStatus;
  endedAt: string | null | undefined;
};

export function VoiceTile({ callId, target, status, endedAt }: VoiceTileProps) {
  const [sample, setSample] = useState<VoiceSampleStatus | null>(null);
  const settled = sample?.state === 'ready' || sample?.state === 'failed';
  const ended = parseTime(endedAt);
  // Read on every render: each poll renders again, so this turns true by itself.
  const windowPassed = ended !== null && Date.now() - ended > QUIET_AFTER_MS;
  const quiet = ['declined', 'missed', 'failed'].includes(status) || (status === 'scored' && windowPassed);

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const next = await api.voiceSampleStatus(callId);
        if (!live) return;
        setSample(next);
        if (next.state === 'ready' || next.state === 'failed') return;
      } catch {
        // Keep the last answer and try again.
      }
      if (live && !quiet) timer = window.setTimeout(tick, POLL_MS);
    };
    if (!settled) void tick();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // Restart only when the call or the reason to keep asking changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, quiet]);

  if (!sample) return null;

  let tone = '';
  let icon = <Mic size={22} aria-hidden />;
  let text: string;
  let detail: string | null = null;
  switch (sample.state) {
    case 'ready':
      tone = ' is-safe';
      icon = <AudioLines size={22} aria-hidden />;
      text = `${target}’s voice is ready for family drills`;
      detail = sample.speech_seconds
        ? `Made from ${duration(sample.speech_seconds)} of ${target}’s own side of this call, after a spoken yes.`
        : `Made from ${target}’s own side of this call, after a spoken yes.`;
      break;
    case 'cloning':
      icon = <LoaderCircle size={20} className="lc-spin" aria-hidden />;
      text = `Making ${target}’s voice…`;
      detail = `${target} said yes, so the recording from this call is being turned into a voice for family drills.`;
      break;
    case 'waiting_for_consent':
      text = `Waiting for ${target}’s spoken yes`;
      detail = `The phone recorded only ${target}’s side. Without a yes on the call, it is deleted and no voice is made.`;
      break;
    case 'failed':
      tone = ' is-unsafe';
      icon = <MicOff size={22} aria-hidden />;
      text = 'No voice was made from this call';
      detail = sample.reason ?? null;
      break;
    case 'none':
    default:
      icon = <MicOff size={22} aria-hidden />;
      if (status === 'in_progress' || status === 'ringing' || status === 'scheduled') {
        text = 'Nothing recorded yet';
        detail = `If ${target} agreed when joining, the phone sends only ${target}’s side once the call ends. A voice is made only after a spoken yes.`;
      } else if (sample.reason === NO_RECORDING && (status === 'ended' || status === 'scored') && !windowPassed) {
        // The phone uploads its recording only after the call has ended, so
        // for a few minutes this is "not here yet", not "not made".
        icon = <LoaderCircle size={20} className="lc-spin" aria-hidden />;
        text = `Waiting for the recording from ${target}’s phone…`;
        detail = `The phone sends only ${target}’s own side, once the call has ended. A voice is made only after a spoken yes.`;
      } else {
        text = 'Not made from this call';
        detail = sample.reason === NO_RECORDING
          ? `No recording arrived from ${target}’s phone, so nothing was made.`
          : sample.reason ?? null;
      }
      break;
  }

  return (
    <section className={`lc-card lc-tile lc-tile--voice${tone}`} aria-live="polite">
      <span className="small-label">Voice for family drills</span>
      <div className="lc-tile__value" key={sample.state}>
        {icon}
        <strong>{text}</strong>
      </div>
      {detail ? <p className="lc-tile__detail">{detail}</p> : null}
    </section>
  );
}
