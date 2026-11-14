// Callback Shield on a shield call: a simulated real scam call during which
// the person is not in training mode. The Shield listens; once the call
// sounds like a scam their phone shows a warning and the family is alerted by
// itself, with no tap (docs/full-app/protection.md). This panel shows that
// moment: live from the `shield.alert` stream event, or from call.shield
// when the call is replayed or the screen polls.

import { BellRing, CircleCheck, Radar, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { CallStatus } from '../../api/types';
import { clock, possessive } from './format';
import type { ShieldAlert } from './liveCallState';

type ShieldPanelProps = {
  target: string;
  status: CallStatus;
  alert: ShieldAlert | null;
  /** The latest risk reading is one the Shield acts on. */
  warning: boolean;
  /** Whose voice the caller copied, if a relative's. */
  voiceOf: string | null;
};

function peopleWords(count: number): string {
  return count === 1 ? '1 family member' : `${count} family members`;
}

export function ShieldPanel({ target, status, alert, warning, voiceOf }: ShieldPanelProps) {
  const live = status === 'in_progress';
  const over = status === 'ended' || status === 'scored';

  if (alert) {
    const when = alert.t !== null ? ` at ${clock(alert.t)}` : '';
    return (
      <section className="lc-card lc-shield is-alerted" role="status" aria-live="assertive" aria-labelledby="lc-shield-title">
        <div className="lc-shield__top">
          <span className="lc-shield__name"><ShieldCheck size={15} aria-hidden /> Callback Shield</span>
          {alert.t !== null ? <span className="lc-shield__time">{clock(alert.t)}</span> : null}
        </div>
        <div className="lc-shield__main">
          <span className="lc-shield__bell" aria-hidden><BellRing size={26} /></span>
          <h2 id="lc-shield-title">
            {alert.alerted > 0 ? `Shield alerted the family${when}` : `Shield warned ${target}${when}`}
          </h2>
        </div>
        <p className="lc-shield__text">
          {alert.alerted > 0
            ? <>{peopleWords(alert.alerted)} {alert.alerted === 1 ? 'was' : 'were'} told straight away, with no tap from anyone.{voiceOf ? <> {voiceOf}, whose voice the caller copied, heard that someone is pretending to be them.</> : null}</>
            : 'There was nobody else in the family to alert.'}
        </p>
        <ul className="lc-shield__steps">
          <li><CircleCheck size={16} aria-hidden /> Scam warning on {possessive(target)} phone</li>
          {alert.alerted > 0 ? <li><CircleCheck size={16} aria-hidden /> {alert.alerted === 1 ? '1 family alert sent' : `${alert.alerted} family alerts sent`}</li> : null}
        </ul>
      </section>
    );
  }

  if (live && warning) {
    return (
      <section className="lc-card lc-shield is-warning" role="status" aria-live="polite">
        <div className="lc-shield__top">
          <span className="lc-shield__name"><ShieldCheck size={15} aria-hidden /> Callback Shield</span>
        </div>
        <div className="lc-shield__main">
          <span className="lc-shield__bell" aria-hidden><TriangleAlert size={24} /></span>
          <h2>Warning signs: alerting the family…</h2>
        </div>
      </section>
    );
  }

  let heading: string;
  let text: string;
  if (live) {
    heading = 'Shield is listening';
    text = `If the caller starts to sound like a scam, ${possessive(target)} phone shows a warning straight away and the family is alerted by itself. Nobody has to tap anything.`;
  } else if (over) {
    heading = 'No alert was needed';
    text = 'The call never sounded like a scam to the Shield, so nobody was alerted.';
  } else if (status === 'scheduled' || status === 'ringing') {
    heading = 'Ready to listen';
    text = `A simulated scam call. When ${target} answers, Callback Shield listens along and steps in if it hears a scam.`;
  } else {
    heading = 'The Shield didn’t run';
    text = 'The call never connected, so there was nothing to listen to.';
  }

  return (
    <section className={`lc-card lc-shield${live ? ' is-listening' : ' is-quiet'}`} aria-live="polite">
      <div className="lc-shield__top">
        <span className="lc-shield__name"><ShieldCheck size={15} aria-hidden /> Callback Shield</span>
      </div>
      <div className="lc-shield__main">
        <span className="lc-shield__radar" aria-hidden><Radar size={22} /></span>
        <h2>{heading}</h2>
      </div>
      <p className="lc-shield__text">{text}</p>
    </section>
  );
}
