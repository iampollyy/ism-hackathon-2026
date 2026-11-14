// /register: POST /api/auth/register makes the organiser's account and logs
// it in (cb_session cookie). Then the return path, or straight into setting
// up the family plan.

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CircleAlert, LoaderCircle, LogOut } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { authPath, firstName, homeAfterLogin, logOut, safeNext, setSignedIn, useMe } from '../../layouts/useMe';
import { useDocumentTitle } from '../../layouts/useDocumentTitle';
import { AuthField, AuthShell, PasswordInput, looksLikeEmail } from '../LoginPage/AuthShell';

const MIN_PASSWORD = 8;

type Errors = { name?: string; email?: string; password?: string };

export function RegisterPage() {
  useDocumentTitle('Create your account');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const meState = useMe();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [alert, setAlert] = useState<ReactNode>(null);
  const [sending, setSending] = useState(false);
  const leaving = useRef(false);

  const clear = (field: keyof Errors) => setErrors(({ [field]: _, ...rest }) => rest);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: Errors = {};
    if (!name.trim()) found.name = 'Add your name, so your family knows who invited them.';
    if (!looksLikeEmail(email)) found.email = 'Enter an email address, like jon@example.com.';
    if (password.length < MIN_PASSWORD) found.password = `Use at least ${MIN_PASSWORD} characters.`;
    setErrors(found);
    setAlert(null);
    if (Object.keys(found).length > 0) return;

    setSending(true);
    try {
      const me = await api.register({ name: name.trim(), email: email.trim(), password });
      leaving.current = true;
      setSignedIn(me);
      navigate(safeNext(next) ?? '/signup', { replace: true });
    } catch (error) {
      setSending(false);
      if (!(error instanceof ApiError)) {
        setAlert('Something went wrong. Please try again.');
      } else if (error.code === 'email_taken') {
        setAlert(
          <>
            There’s already an account with this email.{' '}
            <Link to={authPath('login', next)} state={{ email: email.trim() }}>
              Log in instead
            </Link>
          </>,
        );
      } else if (error.code === 'password_too_short') {
        setErrors({ password: `Use at least ${MIN_PASSWORD} characters.` });
      } else if (error.code === 'invalid_request') {
        setAlert('Check your name and email address, then try again.');
      } else {
        setAlert(error.message);
      }
    }
  };

  if (meState.status === 'in' && !leaving.current) {
    const { me } = meState;
    return (
      <AuthShell>
        <div className="auth-heading">
          <h1>You already have an account</h1>
          <p>
            You’re logged in as {me.account.name} ({me.account.email}).
          </p>
        </div>
        <div className="auth-signed-in">
          <button
            type="button"
            className="button button-primary"
            onClick={() => navigate(safeNext(next) ?? homeAfterLogin(me), { replace: true })}
          >
            Continue as {firstName(me.account.name)} <ArrowRight size={18} />
          </button>
          <button type="button" className="button button-secondary" onClick={() => void logOut()}>
            <LogOut size={17} /> Log out and make a new account
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="auth-heading">
        <h1>Create your organiser account</h1>
        <p>You set up the family plan and invite everyone. It takes about five minutes, and the first 30 days are free.</p>
      </div>

      <form className="auth-fields" onSubmit={submit} noValidate>
        {alert ? (
          <div className="auth-alert" role="alert">
            <CircleAlert size={17} aria-hidden="true" />
            <span>{alert}</span>
          </div>
        ) : null}

        <AuthField label="Your name" htmlFor="register-name" error={errors.name}>
          <input
            id="register-name"
            type="text"
            autoComplete="name"
            autoFocus
            value={name}
            maxLength={60}
            onChange={(event) => {
              setName(event.target.value);
              clear('name');
            }}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'register-name-error' : undefined}
          />
        </AuthField>

        <AuthField label="Email" htmlFor="register-email" error={errors.email}>
          <input
            id="register-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            maxLength={200}
            onChange={(event) => {
              setEmail(event.target.value);
              clear('email');
            }}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'register-email-error' : undefined}
          />
        </AuthField>

        <AuthField
          label="Password"
          htmlFor="register-password"
          error={errors.password}
          hint={`At least ${MIN_PASSWORD} characters.`}
        >
          <PasswordInput
            id="register-password"
            value={password}
            autoComplete="new-password"
            onChange={(value) => {
              setPassword(value);
              clear('password');
            }}
            invalid={Boolean(errors.password)}
            describedBy={errors.password ? 'register-password-error' : 'register-password-hint'}
          />
        </AuthField>

        <button type="submit" className="button button-primary auth-submit-button" disabled={sending}>
          {sending ? (
            <>
              <LoaderCircle size={18} className="auth-spin" aria-hidden="true" /> Creating your account…
            </>
          ) : (
            <>
              Create account <ArrowRight size={18} aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <p className="auth-switch">
        Already have an account? <Link to={authPath('login', next)}>Log in</Link>
      </p>
    </AuthShell>
  );
}
