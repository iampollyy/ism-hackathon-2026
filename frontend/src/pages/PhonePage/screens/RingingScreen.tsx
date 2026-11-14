import { Phone, PhoneOff, UserRound } from 'lucide-react';
import type { IncomingCall } from '../../../api/types';

type RingingScreenProps = {
  call: IncomingCall;
  onAnswer: () => void;
  onDecline: () => void;
};

/** Looks like the phone's own incoming-call screen. Only the caller's label
 * and number: never whose voice it is. */
export function RingingScreen({ call, onAnswer, onDecline }: RingingScreenProps) {
  return (
    <main className="phone-screen phone-dark phone-ringing" aria-live="assertive">
      <div className="call-head">
        <p className="call-kicker">Incoming call</p>
        <h1 className="call-title">{call.caller.label}</h1>
        {call.caller.number && <p className="call-number">{call.caller.number}</p>}
      </div>

      <div className="call-rings" aria-hidden="true">
        <span className="call-rings__wave" />
        <span className="call-rings__wave" />
        <span className="call-rings__wave" />
        <span className="call-avatar">
          <UserRound size={52} strokeWidth={1.6} />
        </span>
      </div>

      <div className="call-buttons">
        <div className="call-button">
          <button type="button" className="round-button round-button--red" onClick={onDecline} aria-label="Decline">
            <PhoneOff size={32} aria-hidden="true" />
          </button>
          <span>Decline</span>
        </div>
        <div className="call-button">
          <button type="button" className="round-button round-button--green round-button--nudge" onClick={onAnswer} aria-label="Answer">
            <Phone size={32} aria-hidden="true" />
          </button>
          <span>Answer</span>
        </div>
      </div>
    </main>
  );
}
