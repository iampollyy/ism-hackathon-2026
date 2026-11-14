// The two sign-up forms: the family waitlist (close) and the bank enquiry.
// Success is shown only after a 2xx; every error says what went wrong and what to do.
import { useId, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { banks, close, errors } from '../copy';
import { emailLooksValid, joinWaitlist, type WaitlistError } from '../api';

type Status = 'idle' | 'sending' | 'done';

function Spinner() {
  return <LoaderCircle size={18} strokeWidth={1.75} className="lp-spin" aria-hidden="true" />;
}

const formError = (code: WaitlistError) =>
  code === 'limit' ? errors.limit : code === 'network' ? errors.network : errors.other;

export function WaitlistForm() {
  const id = useId();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [minH, setMinH] = useState<number | undefined>(undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    const value = email.trim();
    setFormErr(null);
    if (!emailLooksValid(value)) {
      setEmailErr(errors.email);
      inputRef.current?.focus();
      return;
    }
    setEmailErr(null);
    setStatus('sending');
    try {
      await joinWaitlist({ email: value, kind: 'family', source: 'close' });
      setMinH(boxRef.current?.offsetHeight);
      setSentTo(value);
      setStatus('done');
    } catch (err) {
      setStatus('idle');
      const code = err as WaitlistError;
      if (code === 'email') {
        setEmailErr(errors.email);
        inputRef.current?.focus();
      } else setFormErr(formError(code));
    }
  };

  return (
    <div className="lp-form lp-form--dark" ref={boxRef} style={{ minHeight: minH }}>
      {status === 'done' ? (
        <div className="lp-form__success" role="status">
          <p className="lp-form__successtitle">{close.successTitle}</p>
          <p>{close.success(sentTo)}</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="lp-body lp-muted-dark">{close.waitText}</p>
          <div className="lp-field-row">
            <div className="lp-input">
              <label htmlFor={`${id}-email`}>{close.email}</label>
              <input
                ref={inputRef}
                id={`${id}-email`}
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                maxLength={200}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!emailErr || undefined}
                aria-describedby={emailErr ? `${id}-email-err` : undefined}
              />
              {emailErr ? (
                <p className="lp-err" id={`${id}-email-err`} role="alert">
                  {emailErr}
                </p>
              ) : null}
            </div>
            <button type="submit" className="lp-btn lp-btn--light lp-btn--form" disabled={status === 'sending'}>
              {status === 'sending' ? (
                <>
                  <Spinner />
                  {close.sending}
                </>
              ) : (
                close.submit
              )}
            </button>
          </div>
          {formErr ? (
            <p className="lp-err lp-err--form" role="alert">
              {formErr}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

export function BankForm() {
  const id = useId();
  const f = banks.form;
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [orgErr, setOrgErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [sent, setSent] = useState({ email: '', org: '' });
  const emailRef = useRef<HTMLInputElement>(null);
  const orgRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [minH, setMinH] = useState<number | undefined>(undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    const em = email.trim();
    const or = org.trim();
    const msg = message.trim();
    setFormErr(null);
    const eBad = !emailLooksValid(em);
    const oBad = or.length === 0 || or.length > 120;
    setEmailErr(eBad ? errors.email : null);
    setOrgErr(oBad ? errors.org : null);
    if (eBad) {
      emailRef.current?.focus();
      return;
    }
    if (oBad) {
      orgRef.current?.focus();
      return;
    }
    setStatus('sending');
    try {
      await joinWaitlist({ email: em, kind: 'bank', organisation: or, message: msg || undefined, source: 'banks' });
      setMinH(boxRef.current?.offsetHeight);
      setSent({ email: em, org: or });
      setStatus('done');
    } catch (err) {
      setStatus('idle');
      const code = err as WaitlistError;
      if (code === 'email') {
        setEmailErr(errors.email);
        emailRef.current?.focus();
      } else setFormErr(formError(code));
    }
  };

  return (
    <div className="lp-form lp-form--paper" ref={boxRef} style={{ minHeight: minH }}>
      <h3 className="lp-h3 lp-form__title">{f.title}</h3>
      {status === 'done' ? (
        <div className="lp-form__success" role="status">
          <p className="lp-form__successtitle">{f.successTitle(sent.org)}</p>
          <p>{f.success(sent.email)}</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="lp-input">
            <label htmlFor={`${id}-email`}>{f.email}</label>
            <input
              ref={emailRef}
              id={`${id}-email`}
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailErr || undefined}
              aria-describedby={emailErr ? `${id}-email-err` : undefined}
            />
            {emailErr ? (
              <p className="lp-err" id={`${id}-email-err`} role="alert">
                {emailErr}
              </p>
            ) : null}
          </div>
          <div className="lp-input">
            <label htmlFor={`${id}-org`}>{f.org}</label>
            <input
              ref={orgRef}
              id={`${id}-org`}
              type="text"
              autoComplete="organization"
              maxLength={120}
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              aria-invalid={!!orgErr || undefined}
              aria-describedby={orgErr ? `${id}-org-err` : undefined}
            />
            {orgErr ? (
              <p className="lp-err" id={`${id}-org-err`} role="alert">
                {orgErr}
              </p>
            ) : null}
          </div>
          <div className="lp-input">
            <label htmlFor={`${id}-msg`}>{f.message}</label>
            <textarea
              id={`${id}-msg`}
              rows={3}
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-describedby={`${id}-msg-hint`}
            />
            <p className="lp-hintline" id={`${id}-msg-hint`}>
              {f.messageHint}
              {message.length > 800 ? <span className="lp-tnum"> {message.length} / 1000</span> : null}
            </p>
          </div>
          <button type="submit" className="lp-btn lp-btn--dark lp-btn--form" disabled={status === 'sending'}>
            {status === 'sending' ? (
              <>
                <Spinner />
                {f.sending}
              </>
            ) : (
              f.submit
            )}
          </button>
          <p className="lp-small lp-muted">{f.under}</p>
          {formErr ? (
            <p className="lp-err lp-err--form" role="alert">
              {formErr}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
