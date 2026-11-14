// /login: POST /api/auth/login, which sets the cb_session cookie. Then the
// return path (?next=), the only family, or the list of families.

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CircleAlert, LoaderCircle, LogOut } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { authPath, firstName, homeAfterLogin, logOut, setSignedIn, useMe } from '../../layouts/useMe';
import { useDocumentTitle } from '../../layouts/useDocumentTitle';
import { AuthField, AuthShell, PasswordInput, looksLikeEmail } from './AuthShell';

type Errors = { email?: string; password?: string };

export function LoginPage() {
  useDocumentTitle('Log in');
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = params.get('next');
  const meState = useMe();
  const prefill = (location.state as { email?: string } | null)?.email ?? '';

  const [email, setEmail] = useState(prefill);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [alert, setAlert] = useState<ReactNode>(null);
  const [sending, setSending] = useState(false);
  const leaving = useRef(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: Errors = {};
    if (!looksLikeEmail(email)) found.email = 'Enter the email address you registered with.';
    if (!password) found.password = 'Enter your password.';
    setErrors(found);
    setAlert(null);
    if (found.email || found.password) return;

    setSending(true);
    try {
      const me = await api.login({ email: email.trim(), password });
      leaving.current = true;
      setSignedIn(me);
      navigate(homeAfterLogin(me, next), { replace: true });
    } catch (error) {
      setSending(false);
      if (!(error instanceof ApiError)) {
        setAlert('Something went wrong. Please try again.');
      } else if (error.code === 'wrong_login') {
        setAlert('That email and password don’t match an account. Check both and try again.');
        setPassword('');
      } else if (error.code === 'too_many_attempts') {
        setAlert(error.message);
      } else if (error.code === 'invalid_request') {
        setErrors({ email: 'Check the email address.' });
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
          <h1>You’re already logged in</h1>
          <p>
            As {me.account.name} ({me.account.email}).
          </p>
        </div>
        <div className="auth-signed-in">
          <button
            type="button"
            className="button button-primary"
            onClick={() => navigate(homeAfterLogin(me, next), { replace: true })}
          >
            Continue as {firstName(me.account.name)} <ArrowRight size={18} />
          </button>
          <button type="button" className="button button-secondary" onClick={() => void logOut()}>
            <LogOut size={17} /> Log in as someone else
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="auth-heading">
        <h1>Welcome back</h1>
        <p>Log in to see your family’s drills, progress and invites.</p>
      </div>

      <form className="auth-fields" onSubmit={submit} noValidate>
        {alert ? (
          <div className="auth-alert" role="alert">
            <CircleAlert size={17} aria-hidden="true" />
            <span>{alert}</span>
          </div>
        ) : null}

        <AuthField label="Email" htmlFor="login-email" error={errors.email}>
          <input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus={!prefill}
            value={email}
            maxLength={200}
            onChange={(event) => {
              setEmail(event.target.value);
              setErrors(({ email: _, ...rest }) => rest);
            }}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
          />
        </AuthField>

        <AuthField label="Password" htmlFor="login-password" error={errors.password}>
          <PasswordInput
            id="login-password"
            autoFocus={Boolean(prefill)}
            value={password}
            autoComplete="current-password"
            onChange={(value) => {
              setPassword(value);
              setErrors(({ password: _, ...rest }) => rest);
            }}
            invalid={Boolean(errors.password)}
            describedBy={errors.password ? 'login-password-error' : undefined}
          />
        </AuthField>

        <button type="submit" className="button button-primary auth-submit-button" disabled={sending}>
          {sending ? (
            <>
              <LoaderCircle size={18} className="auth-spin" aria-hidden="true" /> Logging in…
            </>
          ) : (
            <>
              Log in <ArrowRight size={18} aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <p className="auth-switch">
        New to Callback? <Link to={authPath('register', next)}>Create an organiser account</Link>
      </p>
    </AuthShell>
  );
}
