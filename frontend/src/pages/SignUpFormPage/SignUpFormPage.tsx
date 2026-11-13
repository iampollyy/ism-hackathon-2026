import { useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, PhoneCall, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../../components/atoms/Badge';

export function SignUpFormPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate('/dashboard');
  };

  return (
    <div className="auth-shell">
      <div className="auth-grid auth-grid-wide">
        <div className="auth-panel auth-copy-panel">
          <Link to="/" className="back-link">
            <ArrowLeft size={16} />
            Back home
          </Link>

          <Badge tone="accent">Join Callback</Badge>
          <h1>Set up your family safety plan.</h1>
          <p>
            Create a home profile, save your family’s safe word, and train your people to pause before acting on a voice call.
          </p>

          <ul className="feature-list">
            <li>
              <ShieldCheck size={18} />
              <span>Verify every incoming voice call with the agreed family callback.</span>
            </li>
            <li>
              <PhoneCall size={18} />
              <span>Practice scam patterns in a safe training environment with realistic calls.</span>
            </li>
            <li>
              <Sparkles size={18} />
              <span>Track readiness and normalise the habit that keeps your family safe.</span>
            </li>
          </ul>
        </div>

        <div className="auth-card">
          <div className="auth-card-header">
            <div>
              <small>Create account</small>
              <h2>Sign up</h2>
            </div>
            <span className="mini-badge">Family plan</span>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-row two-col">
              <label className="input-stack">
                <span>First name</span>
                <input type="text" defaultValue="Daniel" placeholder="First name" />
              </label>
              <label className="input-stack">
                <span>Last name</span>
                <input type="text" defaultValue="Parker" placeholder="Last name" />
              </label>
            </div>

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
                  placeholder="Create a password"
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

            <label className="input-stack">
              <span>Family code</span>
              <input type="text" defaultValue="MORGAN-24" placeholder="Enter family code" />
            </label>

            <div className="checkbox-row">
              <input id="agree" type="checkbox" defaultChecked />
              <label htmlFor="agree">I agree to keep my family’s safety plan private and share only with trusted family contacts.</label>
            </div>

            <button type="submit" className="button button-primary auth-submit">
              Create account
              <ArrowRight size={16} />
            </button>

            <div className="divider-wrap">
              <span>or</span>
            </div>

            <div className="boxed-callout">
              <div className="boxed-callout-header">
                <LockKeyhole size={16} />
                <span>Family access</span>
              </div>
              <strong>Ready for family review</strong>
              <p>Invite your family group after setup and sync the safe word across all members.</p>
            </div>

            <p className="auth-switch-text">
              Already have an account?
              <Link to="/signin">Sign in</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
