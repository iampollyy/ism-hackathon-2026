import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BellRing, Check, ChevronRight, CircleAlert, Ear, HandHeart, LoaderCircle, Phone, PhoneCall, Shuffle,
} from 'lucide-react';
import { api } from '../../../api/client';
import type { JoinView, VoiceSampleStatus } from '../../../api/types';
import { Card } from '../../../components/atoms/Card';
import { plainError, type AlertState } from '../usePhone';

// ---------------------------------------------------------------- the welcome call, if missed

export function WelcomeOfferCard({
  busy,
  error,
  onStart,
}: {
  busy: boolean;
  error: string | null;
  onStart: () => void;
}) {
  return (
    <Card className="phone-card phone-offer">
      <h2 className="phone-card__title">Your welcome call</h2>
      <p className="phone-card__text">
        A short, friendly call that explains Callback and checks you are happy to go ahead. It takes about two minutes.
      </p>
      <button type="button" className="phone-big-button phone-big-button--green" onClick={onStart} disabled={busy}>
        {busy ? <LoaderCircle className="phone-spin" size={24} aria-hidden="true" /> : <Phone size={24} aria-hidden="true" />}
        {busy ? 'Starting…' : 'Start my welcome call'}
      </button>
      {error && (
        <p className="phone-inline-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          {error}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- what happens next

export function NextSteps() {
  return (
    <section aria-labelledby="next-steps">
      <h2 className="phone-section-title" id="next-steps">
        What happens next
      </h2>
      <ul className="phone-next">
        <li>
          <Shuffle size={20} aria-hidden="true" />
          <span>
            Practice calls ring at random times. One may sound like someone you love asking for help. It always tells you
            at the end that it was a practice.
          </span>
        </li>
        <li>
          <Ear size={20} aria-hidden="true" />
          <span>Callback Shield listens for the signs of a scam call and warns you while it happens.</span>
        </li>
        <li>
          <PhoneCall size={20} aria-hidden="true" />
          <span>If a call asks for money or a code, hang up and call back on a number you already have.</span>
        </li>
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- "Something's wrong?"

export function AlertFamilyCard({
  alert,
  family,
  onAlert,
  onReset,
}: {
  alert: AlertState;
  family: string | null;
  onAlert: () => void;
  onReset: () => void;
}) {
  const [asking, setAsking] = useState(false);

  if (alert.status === 'sent') {
    return (
      <Card className="phone-card phone-alert phone-alert--sent">
        <p className="phone-alert__done" role="status">
          <Check size={20} aria-hidden="true" />
          Your family has been told.
        </p>
        <p className="phone-card__text">
          {alert.alerted === 1
            ? 'One person in your family has a message asking them to call you.'
            : alert.alerted > 1
              ? `${alert.alerted} people in your family have a message asking them to call you.`
              : 'Nobody else in your family is on Callback yet, so please ring someone you trust.'}
        </p>
        <h3 className="phone-alert__subtitle">What to do now</h3>
        <ul className="phone-alert__steps">
          <li>Don’t send any money, codes or passwords.</li>
          <li>If you are still on a call, hang up. A real relative won’t mind.</li>
          <li>Call your family back on a number you already have, or wait for them to call you.</li>
        </ul>
        <button
          type="button"
          className="phone-quiet-button"
          onClick={() => {
            setAsking(false);
            onReset();
          }}
        >
          Done
        </button>
      </Card>
    );
  }

  const sending = alert.status === 'sending';
  return (
    <Card className="phone-card phone-alert">
      <h2 className="phone-card__title">Something’s wrong?</h2>
      <p className="phone-card__text">
        A call or a message worried you? Let your family know, and they will call you.
      </p>
      {asking || sending ? (
        <div className="phone-alert__confirm">
          <p>Send everyone in {family ?? 'your family'} a message asking them to call you?</p>
          <div className="phone-alert__buttons">
            <button type="button" className="phone-alert__send" onClick={onAlert} disabled={sending}>
              {sending ? <LoaderCircle className="phone-spin" size={20} aria-hidden="true" /> : <BellRing size={20} aria-hidden="true" />}
              {sending ? 'Telling them…' : 'Yes, tell them'}
            </button>
            <button type="button" className="phone-quiet-button" onClick={() => setAsking(false)} disabled={sending}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="phone-alert__open" onClick={() => setAsking(true)}>
          <HandHeart size={20} aria-hidden="true" />
          Tell my family
        </button>
      )}
      {alert.status === 'error' && (
        <p className="phone-inline-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          {alert.message}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- your choices (consent, always visible)

export type Choices = { join: JoinView; voice: VoiceSampleStatus | null };

/** The member's own choices (the invite page's view) and their latest
 * welcome-call voice, for the home tab. */
export function useMemberChoices(memberId: string, refreshKey: string) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.getJoin(memberId), api.memberVoiceSample(memberId).catch(() => null)]).then(
      ([join, voice]) => setChoices({ join, voice }),
      (failure: unknown) => setError(plainError(failure, 'Your choices could not be loaded.')),
    );
  }, [memberId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return { choices, error, reload: load };
}

export function YourChoicesCard({
  memberId,
  choices,
  error,
  onReload,
}: {
  memberId: string;
  choices: Choices | null;
  error: string | null;
  onReload: () => void;
}) {
  const [deleting, setDeleting] = useState<'idle' | 'asking' | 'busy' | 'done'>('idle');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const load = onReload;

  const deleteVoice = () => {
    setDeleting('busy');
    setDeleteError(null);
    api.deleteVoice(memberId).then(
      () => setDeleting('done'),
      (failure: unknown) => {
        setDeleting('asking');
        setDeleteError(plainError(failure, 'Your voice could not be deleted. Please try again.'));
      },
    );
  };

  if (error) {
    return (
      <Card className="phone-card phone-choices">
        <h2 className="phone-card__title">Your choices</h2>
        <p className="phone-card__text">{error}</p>
        <button type="button" className="phone-quiet-button" onClick={load}>
          Try again
        </button>
      </Card>
    );
  }
  if (!choices) {
    return (
      <Card className="phone-card phone-choices phone-choices--loading">
        <h2 className="phone-card__title">Your choices</h2>
        <span className="phone-skeleton" />
        <span className="phone-skeleton phone-skeleton--short" />
      </Card>
    );
  }

  const { join, voice } = choices;
  // A copy made from a welcome call is known; one recorded another way (with
  // the family) is not visible here, so deleting is always on offer: it is
  // harmless when there is none.
  const voiceMade = voice?.state === 'ready';
  return (
    <Card className="phone-card phone-choices">
      <h2 className="phone-card__title">Your choices</h2>
      <dl className="phone-choices__list">
        <div>
          <dt>Practice calls</dt>
          <dd className={join.consents.practice ? 'is-on' : ''}>{join.consents.practice ? 'On' : 'Off'}</dd>
        </div>
        <div>
          <dt>A copy of my voice from the welcome call</dt>
          <dd className={join.consents.clone_from_call ? 'is-on' : ''}>
            {join.consents.clone_from_call ? 'Allowed' : 'Not allowed'}
          </dd>
        </div>
        <div>
          <dt>My phone number for my family</dt>
          <dd>{join.phone_number || 'Not given'}</dd>
        </div>
      </dl>

      {deleting === 'idle' &&
        (voiceMade ? (
          <p className="phone-choices__voice">
            A copy of your voice was made from your welcome call. Only your family’s practice calls use it.{' '}
            <button type="button" className="phone-link-button" onClick={() => setDeleting('asking')}>
              Delete my voice
            </button>
          </p>
        ) : (
          <p className="phone-choices__voice">
            <button type="button" className="phone-link-button" onClick={() => setDeleting('asking')}>
              Delete any copy of my voice
            </button>
          </p>
        ))}
      {(deleting === 'asking' || deleting === 'busy') && (
        <div className="phone-alert__confirm">
          <p>
            {voiceMade ? 'Delete the copy of your voice?' : 'Delete any copy of your voice?'} Practice calls will stop
            using it straight away.
          </p>
          <div className="phone-alert__buttons">
            <button type="button" className="phone-alert__send" onClick={deleteVoice} disabled={deleting === 'busy'}>
              {deleting === 'busy' ? 'Deleting…' : 'Yes, delete it'}
            </button>
            <button type="button" className="phone-quiet-button" onClick={() => setDeleting('idle')} disabled={deleting === 'busy'}>
              Keep it
            </button>
          </div>
          {deleteError && (
            <p className="phone-inline-error" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              {deleteError}
            </p>
          )}
        </div>
      )}
      {deleting === 'done' && (
        <p className="phone-choices__voice" role="status">
          <Check size={16} aria-hidden="true" /> {voiceMade ? 'Your voice copy has been deleted.' : 'Any copy of your voice has been deleted.'}
        </p>
      )}

      <Link className="phone-choices__change" to={`/join/${memberId}`}>
        Change my choices
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </Card>
  );
}
