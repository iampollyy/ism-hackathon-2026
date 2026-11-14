// The organiser app on a phone (768px and narrower): a bottom tab bar with
// the family's four main screens and More, and the More sheet (News, Plan,
// Your families, a new family plan, the account and Log out). The layout
// shows it only while a family is open and the organiser is logged in.

import { forwardRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BadgeEuro, ChevronRight, GraduationCap, LayoutDashboard, LogOut, MoreHorizontal, Newspaper, PhoneCall,
  Plus, Users, X,
} from 'lucide-react';
import { activeSection } from '../components/organisms/Sidebar';
import { logOut, type MeState } from './useMe';

const TABS = [
  { key: 'overview', label: 'Overview', suffix: '', icon: LayoutDashboard },
  { key: 'drills', label: 'Drills', suffix: '/drills', icon: PhoneCall },
  { key: 'activity', label: 'Activity', suffix: '/activity', icon: Activity },
  { key: 'learn', label: 'Learn', suffix: '/learn', icon: GraduationCap },
];

/** Sections that live under More. */
const IN_MORE = ['news', 'plan'];

type TabsProps = {
  familyId: string;
  moreOpen: boolean;
  onMore: () => void;
};

export const PhoneTabs = forwardRef<HTMLButtonElement, TabsProps>(function PhoneTabs({ familyId, moreOpen, onMore }, moreRef) {
  const location = useLocation();
  const active = activeSection(location.pathname, familyId);
  const moreActive = moreOpen || IN_MORE.includes(active ?? '') || location.pathname === '/families' || location.pathname === '/signup';

  return (
    <nav className="app-tabs" aria-label="Family screens">
      {TABS.map(({ key, label, suffix, icon: Icon }) => {
        const current = active === key;
        return (
          <Link
            key={key}
            to={`/family/${familyId}${suffix}`}
            className={`app-tab${current ? ' active' : ''}`}
            aria-current={current ? 'page' : undefined}
          >
            <span className="app-tab-icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
      <button
        ref={moreRef}
        type="button"
        className={`app-tab${moreActive ? ' active' : ''}`}
        onClick={onMore}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        aria-controls="app-more"
      >
        <span className="app-tab-icon" aria-hidden="true">
          <MoreHorizontal size={20} />
        </span>
        <span>More</span>
      </button>
    </nav>
  );
});

type SheetProps = {
  familyId: string;
  familyName: string | null;
  meState: MeState;
  onClose: () => void;
};

export const MoreSheet = forwardRef<HTMLDivElement, SheetProps>(function MoreSheet({ familyId, familyName, meState, onClose }, ref) {
  const location = useLocation();
  const navigate = useNavigate();
  const active = activeSection(location.pathname, familyId);
  const me = meState.status === 'in' ? meState.me : null;
  const base = `/family/${familyId}`;

  const links = [
    { to: `${base}/news`, label: 'News', note: "This week's scams", icon: Newspaper, current: active === 'news' },
    { to: `${base}/plan`, label: 'Plan', note: 'Your plan and billing', icon: BadgeEuro, current: active === 'plan' },
    {
      to: '/families',
      label: 'Your families',
      note: me && me.families.length > 1 ? `${me.families.length} families · switch here` : 'Every family you look after',
      icon: Users,
      current: location.pathname === '/families',
    },
    { to: '/signup', label: 'New family plan', note: 'Set up another family', icon: Plus, current: location.pathname === '/signup' },
  ];

  const leave = async () => {
    onClose();
    await logOut(); // also forgets the last family opened
    navigate('/login');
  };

  return (
    <div className="app-sheet-layer">
      <div className="app-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        id="app-more"
        className="app-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-more-title"
        tabIndex={-1}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('a')) onClose();
        }}
      >
        <div className="app-sheet-head">
          <div>
            <h2 id="app-more-title">More</h2>
            {familyName ? <small>{familyName}</small> : null}
          </div>
          <button type="button" className="app-sheet-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <ul className="app-sheet-links">
          {links.map(({ to, label, note, icon: Icon, current }) => (
            <li key={to}>
              <Link to={to} className={current ? 'active' : undefined} aria-current={current ? 'page' : undefined}>
                <span className="app-sheet-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="app-sheet-text">
                  <strong>{label}</strong>
                  <small>{note}</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" className="app-sheet-chevron" />
              </Link>
            </li>
          ))}
        </ul>

        {me ? (
          <div className="app-sheet-account">
            <span className="app-sheet-text">
              <strong>{me.account.name}</strong>
              <small>{me.account.email}</small>
            </span>
            <button type="button" className="app-sheet-logout" onClick={() => void leave()}>
              <LogOut size={18} aria-hidden="true" /> Log out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});
