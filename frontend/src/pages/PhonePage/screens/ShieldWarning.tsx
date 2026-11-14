import { useEffect, useRef, useState } from 'react';
import { BellRing, ChevronUp, Ear, Phone, PhoneOff, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { PhoneState } from '../../../api/types';

export type ShieldState = NonNullable<PhoneState['shield']>;

type ShieldProps = {
  shield: ShieldState;
  onHangUp: () => void;
  /** hasNumber: the tel: link opens the dialler; without it, the family line. */
  onCallBack: (hasNumber: boolean) => void;
};

/** Callback Shield on the in-call screen, only during a Shield call
 * (phone-state.shield is null on every practice drill). Green: a quiet
 * "listening" chip. Yellow: a softer banner. Warn: the full-screen warning,
 * which can be folded into a red banner to keep talking. */
export function ShieldLayer({ shield, onHangUp, onCallBack }: ShieldProps) {
  const [folded, setFolded] = useState(false);

  if (shield.warn && !folded) {
    return <ShieldWarning shield={shield} onHangUp={onHangUp} onCallBack={onCallBack} onFold={() => setFolded(true)} />;
  }
  if (shield.warn) {
    return (
      <button type="button" className="shield-banner shield-banner--red" onClick={() => setFolded(false)}>
        <ShieldAlert size={20} aria-hidden="true" />
        <span className="shield-banner__text">
          <strong>This sounds like a scam</strong>
          <span>Tap to see what to do</span>
        </span>
        <ChevronUp size={18} aria-hidden="true" />
      </button>
    );
  }
  if (shield.level === 'yellow') {
    return (
      <div className="shield-banner shield-banner--yellow" role="status">
        <TriangleAlert size={20} aria-hidden="true" />
        <span className="shield-banner__text">
          <strong>Be careful</strong>
          <span>{shield.reason}</span>
        </span>
      </div>
    );
  }
  return (
    <p className="shield-chip" role="status">
      <Ear size={15} aria-hidden="true" />
      Callback Shield is listening
    </p>
  );
}

function ShieldWarning({ shield, onHangUp, onCallBack, onFold }: ShieldProps & { onFold: () => void }) {
  const hangUpRef = useRef<HTMLButtonElement>(null);
  // The warning takes the focus, so a screen reader reads it at once.
  useEffect(() => {
    hangUpRef.current?.focus();
  }, []);

  const contact = shield.call_back ?? null;
  const number = contact?.phone_number?.replace(/\s+/g, '') || null;
  const message = shield.message || 'This sounds like a scam. Hang up and call your family on a number you know.';

  return (
    <div className="shield-warning" role="alertdialog" aria-modal="true" aria-labelledby="shield-warning-title">
      <div className="shield-warning__top">
        <p className="shield-warning__source">
          <ShieldAlert size={22} aria-hidden="true" />
          Callback Shield
        </p>
        <h2 className="shield-warning__title" id="shield-warning-title">
          {message}
        </h2>
        {shield.labels.length > 0 && (
          <div className="shield-warning__signs">
            <span className="shield-warning__signs-label">What we heard</span>
            <ul>
              {shield.labels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        )}
        {contact && (
          <p className="shield-warning__told">
            <BellRing size={18} aria-hidden="true" />
            Your family has been told.
          </p>
        )}
      </div>

      <div className="shield-warning__actions">
        <button ref={hangUpRef} type="button" className="shield-button shield-button--hang-up" onClick={onHangUp}>
          <PhoneOff size={24} aria-hidden="true" />
          Hang up
        </button>
        {contact &&
          (number ? (
            <a className="shield-button shield-button--call" href={`tel:${number}`} onClick={() => onCallBack(true)}>
              <Phone size={22} aria-hidden="true" />
              Call {contact.name}
            </a>
          ) : (
            <button type="button" className="shield-button shield-button--call" onClick={() => onCallBack(false)}>
              <Phone size={22} aria-hidden="true" />
              Hang up and call {contact.name}
            </button>
          ))}
        <button type="button" className="shield-warning__fold" onClick={onFold}>
          Back to the call
        </button>
      </div>
    </div>
  );
}
