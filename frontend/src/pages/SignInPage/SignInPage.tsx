import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../../components/atoms/Badge';
import { useAuth } from '../../contexts/AuthContext';

export function SignInPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    signIn();
    navigate('/dashboard');
  };

  return (
    <div className="auth-shell">
      <div className="auth-grid">
        <div className="auth-panel auth-copy-panel">
          <Link to="/" className="back-link">
            <ArrowLeft size={16} />
            Back home
          </Link>

          <Badge tone="good">Welcome back</Badge>
          <h1>Sign in to your family account.</h1>
          <p>
            Keep the safety plan front and center. Review your family’s readiness, practice the next scam script, and call the family line when it matters.
          </p>

          <div className="mini-checklist">
            <div>
              <CheckCircle2 size={16} />
              <span>Access your family dashboard</span>
            </div>
            <div>
              <ShieldCheck size={16} />
              <span>Review active safety tasks</span>
            </div>
            <div>
              <CheckCircle2 size={16} />
              <span>Jump into the next live practice</span>
            </div>
          </div>
        </div>

        <div className="auth-card">
          <div className="auth-card-header">
            <div>
              <small>Welcome</small>
              <h2>Sign in</h2>
            </div>
            <span className="mini-badge">Secure</span>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="input-stack">
              <span>Email</span>
              <input type="email" defaultValue="daniel@callback.family" placeholder="you@example.com" />
            </label>

            <label className="input-stack">
              <span>Password</span>
              <div className="password-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  defaultValue="family-safe-2026"
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <div className="inline-row">
              <label className="remember-row">
                <input type="checkbox" defaultChecked />
                <span>Keep me signed in</span>
              </label>
              <Link to="/settings" className="text-link">Need help?</Link>
            </div>

            <button type="submit" className="button button-primary auth-submit">
              Sign in
              <ArrowRight size={16} />
            </button>

            <div className="divider-wrap">
              <span>or</span>
            </div>

            <div className="simple-account-box">
              <span>New here?</span>
              <Link to="/signup">Create an account</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
