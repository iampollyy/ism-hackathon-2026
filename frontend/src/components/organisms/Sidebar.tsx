import {
  BookText,
  House,
  ListChecks,
  Phone,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const familyItems = [
  { label: 'Overview', to: '/dashboard', icon: House },
  { label: 'Members', to: '/dashboard#members', icon: Users },
  { label: 'Practice calls', to: '/practice', icon: Phone },
  { label: 'Progress', to: '/result', icon: ListChecks },
];

const resourceItems = [
  { label: 'Safety guide', to: '/dashboard', icon: BookText },
  { label: 'Settings', to: '/settings', icon: Settings },
  { label: 'Set up family', to: '/signup', icon: UserRound },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="practice-sidebar">
      <div className="brand-row">
        <h2>Callback</h2>
      </div>

      <div className="sidebar-section">
        <span className="sidebar-label">Family</span>
        <nav className="sidebar-nav">
          {familyItems.map(({ label, to, icon: Icon }) => (
            <Link
              key={label}
              to={to}
              className={`sidebar-link${location.pathname === '/dashboard' && (label === 'Members' ? location.hash === '#members' : label === 'Overview' && location.hash !== '#members') || location.pathname === to && location.hash === '' && label !== 'Safety guide' ? ' active' : ''}`}
              aria-current={
                location.pathname === '/dashboard' && (label === 'Members' ? location.hash === '#members' : label === 'Overview' && location.hash !== '#members') ||
                location.pathname === to && location.hash === '' && label !== 'Safety guide'
                  ? 'page'
                  : undefined
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </div>

      <div className="sidebar-section resources">
        <span className="sidebar-label">Resources</span>
        <nav className="sidebar-nav">
          {resourceItems.map(({ label, to, icon: Icon }) => (
            <Link
              key={label}
              to={to}
              className={`sidebar-link${label !== 'Safety guide' && location.pathname === to ? ' active' : ''}`}
              aria-current={label !== 'Safety guide' && location.pathname === to ? 'page' : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </div>

      <div className="family-strip">
        <div className="family-avatar">MF</div>
        <div>
          <strong>Morgan Family</strong>
          <small>Family admin</small>
        </div>
        <span className="arrow-pill">→</span>
      </div>
    </aside>
  );
}
