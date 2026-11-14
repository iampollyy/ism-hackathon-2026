// The invite page, /join/:memberId: a relative opens the link their family
// sent, reads in plain words what Callback will do, makes their two choices
// and joins. The Join tap also unlocks sound and the microphone and moves to
// their phone page in the same document, so the welcome call that starts on
// its first poll rings out loud (PhonePage/audioUnlock.ts).
//
// Never asks for or shows the family word: only whether one is set.

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Check, CircleAlert, KeyRound, Link2Off, LoaderCircle, LogOut, Mic, Phone, PhoneCall, RotateCw, ShieldCheck, Shuffle,
} from 'lucide-react';
import { ApiError, api } from '../../api/client';
import type { JoinView } from '../../api/types';
import { unlockAudioInTap } from '../PhonePage/audioUnlock';
import './JoinPage.scss';

type Load =
  | { status: 'loading' }
  | { status: 'error'; notFound: boolean; message: string }
  | { status: 'ready'; view: JoinView };

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });

/** The back end's rule: an optional +, then digits and spaces, 6 to 20 in all. */
function phoneProblem(value: string): string | null {
  if (!value) return null;
  if (!/^\+?[0-9 ]+$/.test(value)) return 'Please use only numbers and spaces, with a + at the start if you like.';
  if (value.length < 6) return 'That number looks too short. Please check it.';
  if (value.length > 20) return 'That number looks too long. Please check it.';
  return null;
}

function joinedOn(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE.format(date);
}

export function JoinPage() {
  const { memberId = '' } = useParams<{ memberId: string }>();
  return <Join key={memberId} memberId={memberId} />;
}

function Join({ memberId }: { memberId: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchView = useCallback(() => {
    setLoad({ status: 'loading' });
    api.getJoin(memberId).then(
      (view) => setLoad({ status: 'ready', view }),
      (error: unknown) =>
        setLoad({
          status: 'error',
          notFound: error instanceof ApiError && error.status === 404,
          message: error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
        }),
    );
  }, [memberId]);

  useEffect(fetchView, [fetchView]);

  // Fetch the phone page (and its call library) now, so the move after
  // Join is instant and the welcome call can ring at once.
  useEffect(() => {
    void import('../PhonePage/PhonePage').catch(() => undefined);
  }, []);

  useEffect(() => {
    const before = document.title;
    if (load.status === 'ready') document.title = `Join ${load.view.family.name} on Callback`;
    return () => {
      document.title = before;
    };
  }, [load]);

  return (
    <div className="join-page">
      <header className="join-top">
        <span className="join-brand">
          <ShieldCheck size={20} aria-hidden="true" />
          Callback
        </span>
      </header>
      {load.status === 'loading' && <JoinSkeleton />}
      {load.status === 'error' && <JoinProblem notFound={load.notFound} message={load.message} onRetry={fetchView} />}
      {load.status === 'ready' && (
        <JoinReady
          memberId={memberId}
          view={load.view}
          onChanged={(view) => setLoad({ status: 'ready', view })}
          onOptedOut={fetchView}
        />
      )}
    </div>
  );
}

function JoinReady({
  memberId,
  view,
  onChanged,
  onOptedOut,
}: {
  memberId: string;
  view: JoinView;
  onChanged: (view: JoinView) => void;
  onOptedOut: () => void;
}) {
  const navigate = useNavigate();
  const { family, organiser, member } = view;

  if (view.opted_out) {
    return (
      <main className="join-main join-main--single">
        <section className="join-intro">
          <h1 className="join-title">You’ve left Callback, {member.name}</h1>
          <p className="join-lead">
            No practice calls will come, and nothing more is recorded. If you would like to come back,
            {organiser ? ` ask ${organiser.name}` : ' ask your family'} to add you to {family.name} again.
          </p>
        </section>
      </main>
    );
  }

  const openPhone = () => {
    // The tap itself unlocks sound and the microphone for the phone page.
    unlockAudioInTap();
    navigate(view.phone_link, { state: { fromJoin: false } });
  };

  return (
    <main className={`join-main ${view.joined ? 'join-main--joined' : ''}`}>
      <section className="join-intro" aria-labelledby="join-title">
        {view.joined ? (
          <>
            <span className="join-done-mark" aria-hidden="true">
              <Check size={28} strokeWidth={2.4} />
            </span>
            <h1 className="join-title" id="join-title">
              You’re in, {member.name}
            </h1>
            <p className="join-lead">
              You joined {family.name}
              {joinedOn(view.joined_at) ? ` on ${joinedOn(view.joined_at)}` : ''}. Open your Callback phone and keep it
              open with the screen on, so calls can reach you.
            </p>
            <button type="button" className="join-button join-button--go" onClick={openPhone}>
              <Phone size={22} aria-hidden="true" />
              Open my Callback phone
            </button>
          </>
        ) : (
          <>
            <h1 className="join-title" id="join-title">
              Hello {member.name}
            </h1>
            <p className="join-lead">
              {organiser ? <strong>{organiser.name}</strong> : 'Your family'} has invited you to join{' '}
              <strong>{family.name}</strong> on Callback: a family plan against phone scams that copy the voice of
              someone you love.
            </p>
          </>
        )}

        <ol className="join-how" aria-label="How Callback works">
          <li>
            <span className="join-how__icon" aria-hidden="true">
              <PhoneCall size={22} />
            </span>
            <div>
              <h2>A short welcome call{view.joined ? '' : ', right now'}</h2>
              <p>
                About two minutes. A friendly voice explains Callback and asks a few easy questions. Only if you say yes,
                your side of the call is used to make a copy of your voice.
              </p>
            </div>
          </li>
          <li>
            <span className="join-how__icon" aria-hidden="true">
              <Shuffle size={22} />
            </span>
            <div>
              <h2>Practice calls, at random times</h2>
              <p>
                Now and then a call may sound like someone you love asking for help. It is always a practice, and at
                the end it always tells you so, with one tip and a button to call your family.
              </p>
            </div>
          </li>
          <li>
            <span className="join-how__icon" aria-hidden="true">
              <ShieldCheck size={22} />
            </span>
            <div>
              <h2>Callback Shield</h2>
              <p>If a call ever sounds like a scam, your phone warns you while it happens, and your family is told.</p>
            </div>
          </li>
        </ol>

        <p className="join-word">
          <KeyRound size={20} aria-hidden="true" />
          <span>
            {family.safe_word_set
              ? `${family.name} have a family word. Callback never asks for it and never stores it: keep it for real calls.`
              : 'Agree a family word with your family, one only you know. Callback never asks for it.'}
          </span>
        </p>
      </section>

      <JoinForm memberId={memberId} view={view} onChanged={onChanged} onOptedOut={onOptedOut} />
    </main>
  );
}

function JoinForm({
  memberId,
  view,
  onChanged,
  onOptedOut,
}: {
  memberId: string;
  view: JoinView;
  onChanged: (view: JoinView) => void;
  onOptedOut: () => void;
}) {
  const navigate = useNavigate();
  const ids = useId();
  // A first visit starts unticked: the choice is theirs, not the organiser's.
  const [practice, setPractice] = useState(view.joined ? view.consents.practice : false);
  const [voice, setVoice] = useState(view.joined ? view.consents.clone_from_call : false);
  const [phone, setPhone] = useState(view.phone_number ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const number = phone.trim();
    const problem = phoneProblem(number);
    setPhoneError(problem);
    if (problem) {
      document.getElementById(`${ids}-phone`)?.focus();
      return;
    }
    // Still inside the tap: sound and the microphone for the welcome call.
    if (!view.joined) unlockAudioInTap();
    setBusy(true);
    setError(null);
    setSaved(false);
    api.join(memberId, { consent_practice: practice, consent_clone_from_call: voice, phone_number: number || null }).then(
      (joined) => {
        if (!view.joined) {
          navigate(joined.phone_link, { state: { fromJoin: true } });
          return;
        }
        setBusy(false);
        setSaved(true);
        onChanged({
          ...view,
          consents: { practice, clone_from_call: voice },
          phone_number: number || null,
        });
      },
      (failure: unknown) => {
        setBusy(false);
        if (failure instanceof ApiError && failure.code === 'opted_out') {
          onOptedOut();
          return;
        }
        setError(
          failure instanceof ApiError && failure.code === 'invalid_request'
            ? 'Please check your phone number: only numbers and spaces, with a + at the start if you like.'
            : failure instanceof ApiError
              ? failure.message
              : 'Something went wrong. Please try again.',
        );
      },
    );
  };

  return (
    <form className="join-form" onSubmit={submit} noValidate aria-labelledby={`${ids}-title`}>
      <h2 className="join-form__title" id={`${ids}-title`}>
        Your choices
      </h2>

      <label className={`join-tick ${practice ? 'is-on' : ''}`}>
        <input type="checkbox" checked={practice} onChange={(event) => setPractice(event.target.checked)} />
        <span className="join-tick__box" aria-hidden="true">
          <Check size={18} strokeWidth={3} />
        </span>
        <span className="join-tick__text">I agree to receive practice calls without knowing when.</span>
      </label>
      {!practice && (
        <p className="join-hint join-hint--tick">Without this, Callback won’t ring you for practice. You can change it later.</p>
      )}

      <label className={`join-tick ${voice ? 'is-on' : ''}`}>
        <input type="checkbox" checked={voice} onChange={(event) => setVoice(event.target.checked)} />
        <span className="join-tick__box" aria-hidden="true">
          <Check size={18} strokeWidth={3} />
        </span>
        <span className="join-tick__text">
          Callback may make a copy of my voice from my welcome call, for practice calls to my family only. I can delete it
          any time.
        </span>
      </label>

      <div className="join-field">
        <label htmlFor={`${ids}-phone`}>
          Your phone number <span>(optional)</span>
        </label>
        <input
          id={`${ids}-phone`}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+44 7700 900123"
          value={phone}
          maxLength={24}
          aria-invalid={phoneError ? true : undefined}
          aria-describedby={`${ids}-phone-hint${phoneError ? ` ${ids}-phone-error` : ''}`}
          onChange={(event) => {
            setPhone(event.target.value);
            if (phoneError) setPhoneError(null);
          }}
        />
        <p className="join-hint" id={`${ids}-phone-hint`}>
          So your family can call you back if Callback warns you about a call. Only your family sees it.
        </p>
        {phoneError && (
          <p className="join-error" id={`${ids}-phone-error`} role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            {phoneError}
          </p>
        )}
      </div>

      {view.joined ? (
        <button type="submit" className="join-button join-button--save" disabled={busy}>
          {busy ? <LoaderCircle className="join-spin" size={22} aria-hidden="true" /> : <Check size={22} aria-hidden="true" />}
          {busy ? 'Saving…' : 'Save my choices'}
        </button>
      ) : (
        <>
          <button type="submit" className="join-button join-button--go" disabled={busy}>
            <span className="join-button__label">
              {busy ? (
                <LoaderCircle className="join-spin join-button__icon" size={24} aria-hidden="true" />
              ) : (
                <Phone className="join-button__icon" size={24} aria-hidden="true" />
              )}
              {busy ? 'Joining…' : 'Join and start my welcome call'}
            </span>
          </button>
          <p className="join-hint join-hint--center">
            <span>
              <Mic className="join-hint__icon" size={16} aria-hidden="true" />
              Your phone rings in a few seconds. If it asks, allow the microphone so you can talk.
            </span>
          </p>
        </>
      )}

      {saved && (
        <p className="join-saved" role="status">
          <Check size={18} aria-hidden="true" />
          Saved. Your choices are up to date.
        </p>
      )}
      {error && (
        <p className="join-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          {error}
        </p>
      )}

      <p className="join-small">You can change these choices, delete your voice or leave Callback at any time.</p>
      {view.joined && <LeaveCallback memberId={memberId} familyName={view.family.name} onLeft={onOptedOut} />}
    </form>
  );
}

/** Leaving is always one calm step away, with a plain question first. */
function LeaveCallback({ memberId, familyName, onLeft }: { memberId: string; familyName: string; onLeft: () => void }) {
  const [step, setStep] = useState<'idle' | 'asking' | 'busy'>('idle');
  const [error, setError] = useState<string | null>(null);

  const leave = () => {
    setStep('busy');
    setError(null);
    api.optOut(memberId).then(onLeft, (failure: unknown) => {
      setStep('asking');
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Please try again.');
    });
  };

  if (step === 'idle') {
    return (
      <button type="button" className="join-leave__open" onClick={() => setStep('asking')}>
        <LogOut size={18} aria-hidden="true" />
        Leave Callback
      </button>
    );
  }
  return (
    <div className="join-leave" role="group" aria-labelledby={`${memberId}-leave`}>
      <p className="join-leave__question" id={`${memberId}-leave`}>
        Leave {familyName} on Callback? Practice calls stop, and any copy of your voice is deleted.
      </p>
      <div className="join-leave__buttons">
        <button type="button" className="join-leave__yes" onClick={leave} disabled={step === 'busy'}>
          {step === 'busy' ? 'Leaving…' : 'Yes, leave'}
        </button>
        <button type="button" className="join-leave__no" onClick={() => setStep('idle')} disabled={step === 'busy'}>
          Stay
        </button>
      </div>
      {error && (
        <p className="join-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

function JoinSkeleton() {
  return (
    <main className="join-main" aria-busy="true" aria-label="Loading your invitation">
      <section className="join-intro">
        <span className="join-skeleton join-skeleton--title" />
        <span className="join-skeleton" />
        <span className="join-skeleton join-skeleton--short" />
        <span className="join-skeleton join-skeleton--block" />
      </section>
      <div className="join-form">
        <span className="join-skeleton join-skeleton--block" />
        <span className="join-skeleton join-skeleton--block" />
      </div>
    </main>
  );
}

function JoinProblem({ notFound, message, onRetry }: { notFound: boolean; message: string; onRetry: () => void }) {
  return (
    <main className="join-main join-main--single">
      <section className="join-problem">
        <span className="join-problem__icon" aria-hidden="true">
          {notFound ? <Link2Off size={28} /> : <CircleAlert size={28} />}
        </span>
        <h1 className="join-title">{notFound ? 'This invite link doesn’t work' : 'Callback couldn’t be reached'}</h1>
        <p className="join-lead">
          {notFound ? 'Check that the whole link was copied, or ask your family to send it again.' : message}
        </p>
        {!notFound && (
          <button type="button" className="join-button join-button--quiet" onClick={onRetry}>
            <RotateCw size={20} aria-hidden="true" />
            Try again
          </button>
        )}
      </section>
    </main>
  );
}
