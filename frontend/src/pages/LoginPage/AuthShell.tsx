// The frame around /login and /register: the brand on a navy panel (with the
// moment Callback is built around, the reveal at the end of a practice call)
// and the form on the right. On a phone the panel shrinks to a header.

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, PhoneCall, ShieldCheck, UsersRound } from 'lucide-react';
import './AuthShell.scss';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <aside className="auth-brand">
        <Link to="/" className="auth-logo" aria-label="Callback home">
          <img src="/icon-192.png" alt="" width={36} height={36} />
          <span>Callback</span>
        </Link>

        <div className="auth-brand-body">
          <h2>Practise the scam call before a real one comes.</h2>
          <p>
            Callback rings your family in a relative&rsquo;s voice, with everyone&rsquo;s consent, and always says at
            the end that it was practice. What stays is one habit: hang up and call back.
          </p>

          <figure className="auth-reveal" aria-label="How every practice call ends">
            <div className="auth-reveal-top">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Practice call, now revealed</span>
            </div>
            <strong>That was Callback, not a real call.</strong>
            <p>A new number and a hurry are the two signs. Hang up and ring back on the number you know.</p>
            <span className="auth-reveal-action">
              <PhoneCall size={16} aria-hidden="true" /> Call back on a number you know
            </span>
          </figure>
        </div>

        <ul className="auth-promises">
          <li>
            <UsersRound size={16} aria-hidden="true" /> Everyone agrees first, and can change their mind
          </li>
          <li>
            <KeyRound size={16} aria-hidden="true" /> We never ask for your family word
          </li>
        </ul>
      </aside>

      <main className="auth-main">
        <div className="auth-form-wrap">{children}</div>
      </main>
    </div>
  );
}

type FieldProps = {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor: string;
};

export function AuthField({ label, error, hint, children, htmlFor }: FieldProps) {
  return (
    <div className={`auth-field${error ? ' invalid' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <small className="auth-field-error" id={`${htmlFor}-error`}>
          {error}
        </small>
      ) : hint ? (
        <small className="auth-field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </small>
      ) : null}
    </div>
  );
}

type PasswordProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  invalid: boolean;
  describedBy?: string;
  autoFocus?: boolean;
};

export function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy, autoFocus }: PasswordProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="auth-password">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        spellCheck={false}
        maxLength={200}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="auth-password-toggle"
        onClick={() => setShown((value) => !value)}
        aria-label={shown ? 'Hide the password' : 'Show the password'}
        aria-pressed={shown}
      >
        {shown ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

/** A plain email check before sending; the server has the last word. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
