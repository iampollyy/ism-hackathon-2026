// The organiser app's frame: the navigation rail on wide screens, a compact
// top bar with a menu drawer on phones, and the page. The current family is
// the one in the address (/family/:familyId/...), else the last one opened on
// this browser (if it belongs to the logged-in account), else the account's
// first. The landing page (/) is shown on its own, without the app around it.

import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, matchPath, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Sidebar, familyInitial, pageLabel } from '../components/organisms/Sidebar';
import { forgetFamilyId, saveFamilyId, useStoredFamilyId } from '../pages/FamilySignUpPage/familyStorage';
import { useMe, type MeState } from './useMe';
import './DashboardLayout.scss';

function currentFamilyId(fromUrl: string | null, stored: string | null, meState: MeState): string | null {
  if (fromUrl) return fromUrl;
  if (meState.status === 'in') {
    const families = meState.me.families;
    if (stored && families.some((family) => family.id === stored)) return stored;
    return families[0]?.id ?? null;
  }
  return stored;
}

/** The family's name: from the account when it is theirs, else from the family itself. */
function useFamilyName(familyId: string | null, meState: MeState): string | null {
  const fromAccount =
    meState.status === 'in' ? meState.me.families.find((family) => family.id === familyId)?.name ?? null : null;
  const [fetched, setFetched] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!familyId || fromAccount || meState.status === 'loading') return;
    if (fetched?.id === familyId) return;
    let live = true;
    api.getFamily(familyId).then(
      (family) => live && setFetched({ id: family.id, name: family.name }),
      (error) => {
        // A family that no longer exists should not stay in the menu.
        if (live && error instanceof ApiError && error.status === 404) forgetFamilyId(familyId);
      },
    );
    return () => {
      live = false;
    };
  }, [familyId, fromAccount, meState.status, fetched?.id]);

  if (fromAccount) return fromAccount;
  return fetched && fetched.id === familyId ? fetched.name : null;
}

export function DashboardLayout() {
  const location = useLocation();
  const meState = useMe();
  const stored = useStoredFamilyId();
  const fromUrl = matchPath('/family/:familyId/*', location.pathname)?.params.familyId ?? null;
  const familyId = currentFamilyId(fromUrl, stored, meState);
  const familyName = useFamilyName(familyId, meState);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  // The family in the address becomes "the last one opened".
  useEffect(() => {
    if (fromUrl) saveFamilyId(fromUrl);
  }, [fromUrl]);

  // Any navigation closes the menu.
  useEffect(() => setMenuOpen(false), [location.pathname, location.search]);

  // While the drawer is open: Escape closes it, the page behind does not scroll.
  useEffect(() => {
    if (!menuOpen) return;
    const button = menuButton.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    drawer.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      button?.focus();
    };
  }, [menuOpen]);

  if (location.pathname === '/') return <Outlet />;

  const label = pageLabel(location.pathname, familyId);

  return (
    <div className="app-shell">
      <a className="app-skip" href="#app-main">
        Skip to the page
      </a>

      <aside className="app-rail">
        <Sidebar familyId={familyId} familyName={familyName} meState={meState} />
      </aside>

      <header className="app-topbar">
        <Link to={meState.status === 'in' ? '/families' : '/'} className="app-topbar-logo" aria-label="Callback">
          <img src="/icon-192.png" alt="" width={32} height={32} />
        </Link>
        <div className="app-topbar-title">
          {fromUrl ? (
            <>
              <span className="app-topbar-mark" aria-hidden="true">{familyInitial(familyName)}</span>
              <span className="app-topbar-text">
                <strong>{familyName ?? 'Your family'}</strong>
                {label ? <small>{label}</small> : null}
              </span>
            </>
          ) : (
            <span className="app-topbar-text">
              <strong>Callback</strong>
              {label ? <small>{label}</small> : null}
            </span>
          )}
        </div>
        <button
          ref={menuButton}
          type="button"
          className="app-menu-button"
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          aria-controls="app-drawer"
        >
          <Menu size={20} aria-hidden="true" />
          <span>Menu</span>
        </button>
      </header>

      {menuOpen ? (
        <div className="app-drawer-layer">
          <div className="app-drawer-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div
            ref={drawer}
            id="app-drawer"
            className="app-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            onClickCapture={(event) => {
              // A link to the page already open changes nothing, so close here too.
              if ((event.target as HTMLElement).closest('a')) setMenuOpen(false);
            }}
          >
            <Sidebar
              familyId={familyId}
              familyName={familyName}
              meState={meState}
              onClose={() => setMenuOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <main id="app-main" className="app-main">
        <div className="app-content">
          {/* Pages load on demand; the navigation stays while one does. */}
          <Suspense fallback={<div className="app-page-loading" aria-busy="true" aria-label="Loading" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
