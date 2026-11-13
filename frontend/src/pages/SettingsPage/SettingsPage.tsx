import { Bell, ChevronRight, Lock, MoonStar, ShieldCheck, Sparkles, UserCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const settingsRows = [
  { icon: UserCircle2, label: 'Profile details', description: 'Name, email, family role', tone: 'neutral' },
  { icon: Bell, label: 'Notifications', description: 'Practice reminders and call alerts', tone: 'accent' },
  { icon: MoonStar, label: 'Appearance', description: 'Dark or light viewing mode', tone: 'neutral' },
  { icon: Lock, label: 'Privacy & security', description: 'Safeguards for call verification', tone: 'good' },
];

export function SettingsPage() {
  return (
    <div className="settings-main">
      <header className="settings-header">
        <div>
          <span className="eyebrow">Account settings</span>
          <h1>Personal settings</h1>
        </div>
        <Link to="/dashboard" className="button button-secondary">Back to dashboard</Link>
      </header>

      <div className="settings-grid">
        <section className="settings-card profile-card">
          <div className="user-row">
            <div className="avatar avatar-lg" style={{ background: 'linear-gradient(135deg, #e7c7d7, #d8b7a4)' }}>DP</div>
            <div>
              <h2>Daniel Parker</h2>
              <p>Family admin · Morgan household</p>
            </div>
          </div>

          <div className="profile-badges">
            <span className="mini-badge">Safe word: Sunset Stag</span>
            <span className="mini-badge neutral">2-factor verification on</span>
          </div>
        </section>

        <section className="settings-card settings-list-card">
          {settingsRows.map(({ icon: Icon, label, description, tone }) => (
            <button key={label} className="settings-row" type="button">
              <div className={`icon-bubble ${tone}`}>
                <Icon size={18} />
              </div>
              <div className="settings-copy">
                <strong>{label}</strong>
                <small>{description}</small>
              </div>
              <ChevronRight size={18} />
            </button>
          ))}
        </section>

        <section className="settings-card preference-card">
          <div className="section-heading-row compact">
            <div>
              <span className="eyebrow">Family habits</span>
              <h3>Daily safety preferences</h3>
            </div>
            <Sparkles size={18} />
          </div>

          <div className="toggle-list">
            <label className="toggle-item">
              <div>
                <strong>Practice reminder</strong>
                <small>Weekly family call drill</small>
              </div>
              <span className="switch on" />
            </label>
            <label className="toggle-item">
              <div>
                <strong>Safeguard checks</strong>
                <small>Verify callback prompts before acting</small>
              </div>
              <span className="switch on" />
            </label>
            <label className="toggle-item">
              <div>
                <strong>Data sharing</strong>
                <small>Share call notes with your trusted family group</small>
              </div>
              <span className="switch" />
            </label>
          </div>
        </section>

        <section className="settings-card security-card">
          <div className="section-heading-row compact">
            <div>
              <span className="eyebrow">Security</span>
              <h3>Protection snapshot</h3>
            </div>
            <ShieldCheck size={18} />
          </div>

          <div className="security-metrics">
            <div>
              <strong>94%</strong>
              <small>Ready for the next scam pattern</small>
            </div>
            <div>
              <strong>3</strong>
              <small>Family members synced</small>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
