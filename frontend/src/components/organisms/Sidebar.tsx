// The organiser app's navigation: the current family's sections, the
// account's families, and the account itself. The layout shows it as a rail
// on wide screens and inside the menu drawer on phones; it decides which
// family is current (the address, else the last one opened).

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BadgeEuro, Check, ChevronsUpDown, GraduationCap, LayoutDashboard, LogIn, LogOut, Newspaper, PhoneCall,
  Plus, Users, X,
} from 'lucide-react';
import { forgetFamilyId } from '../../pages/FamilySignUpPage/familyStorage';
import { logOut, type MeState } from '../../layouts/useMe';
import './Sidebar.scss';

type Section = { key: string; label: string; suffix: string; icon: typeof Activity };

export const FAMILY_SECTIONS: Section[] = [
  { key: 'overview', label: 'Overview', suffix: '', icon: LayoutDashboard },
  { key: 'drills', label: 'Drills', suffix: '/drills', icon: PhoneCall },
  { key: 'activity', label: 'Activity', suffix: '/activity', icon: Activity },
  { key: 'learn', label: 'Learn', suffix: '/learn', icon: GraduationCap },
  { key: 'news', label: 'News', suffix: '/news', icon: Newspaper },
  { key: 'plan', label: 'Plan', suffix: '/plan', icon: BadgeEuro },
];

/** Which family section the address is in, if any. Calls count as drills. */
export function activeSection(pathname: string, familyId: string | null): string | null {
  if (pathname.startsWith('/calls/')) return 'drills';
  if (!familyId) return null;
  const base = `/family/${familyId}`;
  if (pathname === base || pathname === `${base}/` || pathname.startsWith(`${base}/members/`)) return 'overview';
  const found = FAMILY_SECTIONS.find((section) => section.suffix && pathname.startsWith(`${base}${section.suffix}`));
  return found?.key ?? null;
}

/** A short name for the page, for the phone's top bar. */
export function pageLabel(pathname: string, familyId: string | null): string {
  const section = activeSection(pathname, familyId);
  if (pathname.startsWith('/calls/')) return 'Call';
  if (pathname.includes('/members/')) return 'Member';
  if (section) return FAMILY_SECTIONS.find((item) => item.key === section)?.label ?? '';
  if (pathname === '/families') return 'Your families';
  if (pathname === '/signup') return 'New family plan';
  return '';
}

export function familyInitial(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter((word) => !/^the$/i.test(word));
  return (words[0]?.[0] ?? 'F').toUpperCase();
}

function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Props = {
  familyId: string | null;
  familyName: string | null;
  meState: MeState;
  /** Shown in the drawer: closes it. */
  onClose?: () => void;
};

export function Sidebar({ familyId, familyName, meState, onClose }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const active = activeSection(location.pathname, familyId);
  const me = meState.status === 'in' ? meState.me : null;
  const families = me?.families ?? [];

  useEffect(() => setSwitching(false), [location.pathname, familyId]);

  // Switching family keeps the section: from one family's drills to the other's.
  const sectionSuffix = FAMILY_SECTIONS.find((section) => section.key === active)?.suffix ?? '';

  const leave = async () => {
    await logOut();
    if (familyId) forgetFamilyId(familyId); // a shared laptop should not keep showing the family
    navigate('/login');
  };

  return (
    <div className="sb">
      <div className="sb-top">
        <Link to={me ? '/families' : '/'} className="sb-brand">
          <img src="/icon-192.png" alt="" width={30} height={30} />
          <span>Callback</span>
        </Link>
        {onClose ? (
          <button type="button" className="sb-close" onClick={onClose} aria-label="Close the menu">
            <X size={20} />
          </button>
        ) : null}
      </div>

      {familyId ? (
        <section className="sb-family" aria-label="This family">
          {me ? (
            <button
              type="button"
              className="sb-switch"
              aria-expanded={switching}
              aria-controls="sb-family-list"
              onClick={() => setSwitching((open) => !open)}
            >
              <span className="sb-family-mark" aria-hidden="true">{familyInitial(familyName)}</span>
              <span className="sb-family-text">
                <small>Family plan</small>
                <strong>{familyName ?? 'Your family'}</strong>
              </span>
              <ChevronsUpDown size={16} className="sb-switch-icon" aria-hidden="true" />
            </button>
          ) : (
            <div className="sb-switch static">
              <span className="sb-family-mark" aria-hidden="true">{familyInitial(familyName)}</span>
              <span className="sb-family-text">
                <small>Family plan</small>
                <strong>{familyName ?? 'Your family'}</strong>
              </span>
            </div>
          )}

          {switching ? (
            <div className="sb-family-list" id="sb-family-list">
              {families.map((family) => (
                <Link key={family.id} to={`/family/${family.id}${sectionSuffix}`} className="sb-family-option">
                  <span className="sb-family-mark small" aria-hidden="true">{familyInitial(family.name)}</span>
                  <span>{family.name}</span>
                  {family.id === familyId ? <Check size={16} aria-label="Open now" /> : null}
                </Link>
              ))}
              <Link to="/signup" className="sb-family-option add">
                <Plus size={16} aria-hidden="true" />
                <span>Create a family plan</span>
              </Link>
            </div>
          ) : null}

          <nav className="sb-nav" aria-label="Family sections">
            {FAMILY_SECTIONS.map((section) => {
              const Icon = section.icon;
              const current = active === section.key;
              return (
                <Link
                  key={section.key}
                  to={`/family/${familyId}${section.suffix}`}
                  className={`sb-link${current ? ' active' : ''}`}
                  aria-current={current ? 'page' : undefined}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{section.label}</span>
                </Link>
              );
            })}
          </nav>
        </section>
      ) : location.pathname === '/signup' || location.pathname === '/families' ? null : (
        <div className="sb-start">
          <strong>No family plan open</strong>
          <p>Set one up, then invite everyone with their own link.</p>
          <Link to="/signup" className="button button-primary sb-start-button">
            <Plus size={16} aria-hidden="true" /> Set up a family
          </Link>
        </div>
      )}

      <nav className="sb-nav sb-nav-account" aria-label="Your account">
        <span className="sb-label">Account</span>
        <Link
          to="/families"
          className={`sb-link${location.pathname === '/families' ? ' active' : ''}`}
          aria-current={location.pathname === '/families' ? 'page' : undefined}
        >
          <Users size={18} aria-hidden="true" />
          <span>Your families</span>
          {me && families.length > 0 ? <span className="sb-count">{families.length}</span> : null}
        </Link>
        {familyId ? (
          <Link
            to="/signup"
            className={`sb-link${location.pathname === '/signup' ? ' active' : ''}`}
            aria-current={location.pathname === '/signup' ? 'page' : undefined}
          >
            <Plus size={18} aria-hidden="true" />
            <span>New family plan</span>
          </Link>
        ) : null}
      </nav>

      <div className="sb-account">
        {meState.status === 'in' ? (
          <div className="sb-person">
            <span className="sb-avatar" aria-hidden="true">{personInitials(meState.me.account.name)}</span>
            <span className="sb-person-text">
              <strong>{meState.me.account.name}</strong>
              <small>{meState.me.account.email}</small>
            </span>
            <button type="button" className="sb-logout" onClick={() => void leave()} aria-label="Log out" title="Log out">
              <LogOut size={18} />
            </button>
          </div>
        ) : meState.status === 'out' ? (
          <div className="sb-guest">
            <Link
              to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
              className="button button-secondary sb-guest-login"
            >
              <LogIn size={16} aria-hidden="true" /> Log in
            </Link>
            <Link to="/register" className="sb-guest-register">Create an account</Link>
          </div>
        ) : meState.status === 'error' ? (
          <p className="sb-offline">Callback can’t be reached right now. Trying again…</p>
        ) : (
          <div className="sb-person loading" aria-hidden="true">
            <span className="sb-avatar" />
            <span className="sb-person-text">
              <i />
              <i />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
