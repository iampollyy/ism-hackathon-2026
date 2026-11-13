import { ArrowRight, Phone, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';

export function SignUpPage() {
  return (
    <div className="auth-shell auth-shell-landing">
      <div className="auth-hero surface-card">
        <div className="auth-copy">
          <Badge tone="accent">family protection</Badge>
          <h1>Teach the habit that beats AI voice scams.</h1>
          <p>
            Callback helps families practice the one step that matters: hang up, then call the family line or ask for the safe word.
          </p>

          <div className="feature-strip">
            <div><ShieldCheck size={18} /> Consent-based voice practice</div>
            <div><Sparkles size={18} /> AI simulation that always reveals itself</div>
            <div><Phone size={18} /> A family callback your relatives trust</div>
          </div>

          <div className="signup-actions">
            <Link to="/signup" className="button button-primary">Begin setup</Link>
            <Link to="/signin" className="button button-secondary">Sign in</Link>
          </div>
        </div>

        <div className="phone-demo">
          <div className="demo-call">
            <div className="demo-header">
              <span className="call-dot dot-red" />
              <span className="call-dot dot-yellow" />
              <span className="call-dot dot-green" />
            </div>
            <div className="demo-person">
              <div className="demo-avatar">DP</div>
              <div>
                <strong>Daniel Parker</strong>
                <small>Incoming call</small>
              </div>
            </div>
            <div className="demo-signal">New number · urgent request · safe word check</div>
            <div className="demo-tags">
              <span>new number</span>
              <span>urgency</span>
              <span>safe word</span>
            </div>
          </div>
        </div>
      </div>

      <div className="steps-grid container">
        <div className="step-card surface-card">
          <span className="step-number">01</span>
          <h3>Set up the family</h3>
          <p>Invite relatives, agree the safe word, and save the family number.</p>
        </div>
        <div className="step-card surface-card">
          <span className="step-number">02</span>
          <h3>Practice on a safe call</h3>
          <p>Run a consent-based simulation in a loved one’s voice without real pressure or money asks.</p>
        </div>
        <div className="step-card surface-card">
          <span className="step-number">03</span>
          <h3>Build a family habit</h3>
          <p>Track readiness, coach weak spots, and repeat the callback routine every week.</p>
        </div>
      </div>
    </div>
  );
}
