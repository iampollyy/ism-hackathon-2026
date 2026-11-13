import { House, Phone, UserRound, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useStoredFamilyId } from '../../pages/FamilySignUpPage/familyStorage';

type Item = { label: string; path: string; hash?: string; icon: typeof House };

export function Sidebar() {
  const location = useLocation();
  const familyId = useStoredFamilyId();
  const familyPath = familyId ? `/family/${familyId}` : '/signup';

  // The real pages only. The mock pages (/dashboard, /practice, /result,
  // /settings) are left out: they show sample data.
  const setUp: Item = { label: 'Set up family', path: '/signup', icon: UserRound };
  const familyItems: Item[] = familyId
    ? [
        { label: 'Overview', path: familyPath, icon: House },
        { label: 'Members', path: familyPath, hash: '#members', icon: Users },
        { label: 'Start a practice', path: familyPath, hash: '#practice', icon: Phone },
      ]
    : [setUp];
  const resourceItems: Item[] = familyId ? [setUp] : [];

  const isActive = ({ path, hash }: Item) => {
    if (location.pathname !== path) return false;
    if (hash) return location.hash === hash;
    return !familyItems.some((item) => item.hash && item.path === path && item.hash === location.hash);
  };

  const renderLink = (item: Item) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <Link
        key={item.label}
        to={`${item.path}${item.hash ?? ''}`}
        className={`sidebar-link${active ? ' active' : ''}`}
        aria-current={active ? 'page' : undefined}
      >
        <Icon size={18} />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <aside className="practice-sidebar">
      <div className="brand-row">
        <h2>Callback</h2>
      </div>

      <div className="sidebar-section">
        <span className="sidebar-label">Family</span>
        <nav className="sidebar-nav">{familyItems.map(renderLink)}</nav>
      </div>

      {resourceItems.length > 0 ? (
        <div className="sidebar-section resources">
          <span className="sidebar-label">Resources</span>
          <nav className="sidebar-nav">{resourceItems.map(renderLink)}</nav>
        </div>
      ) : null}

      <Link to={familyPath} className="family-strip">
        <div className="family-avatar">{familyId ? 'F' : '+'}</div>
        <div>
          <strong>{familyId ? 'Your family' : 'No family yet'}</strong>
          <small>{familyId ? 'Open the family page' : 'Set one up'}</small>
        </div>
        <span className="arrow-pill">→</span>
      </Link>
    </aside>
  );
}
