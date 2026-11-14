// The organiser app's frame: the navigation rail on wide screens, a compact
// top bar with a menu drawer on tablets, and on phones (768px and narrower,
// with a family open) a bottom tab bar whose More opens a sheet. The current family is
// the one in the address (/family/:familyId/...), else the last one opened on
// this browser (if it belongs to the logged-in account), else the account's
// first. The landing page (/) is shown on its own, without the app around it.
// A family's pages and the call pages need the organiser's account: logged
// out, they go to the log-in page and come back here after it (not after
// logging out on purpose: on a shared laptop the next person starts afresh).
// While the answer is loading, or the server cannot be reached, nothing
// changes, so a restarting server never logs anyone out.

import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Outlet, matchPath, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Sidebar, familyInitial, pageLabel } from '../components/organisms/Sidebar';
import { forgetFamilyId, saveFamilyId, useStoredFamilyId } from '../pages/FamilySignUpPage/familyStorage';
import { MoreSheet, PhoneTabs } from './PhoneTabs';
import { authPath, useMe, type MeState } from './useMe';
import './DashboardLayout.scss';

/** Pages that show a family's people and calls: only for the logged-in organiser. */
const ACCOUNT_ONLY = ['/family/*', '/calls/*'];
/** Pages that show the phone's bottom tab bar (with a family open). */
const WITH_TABS = ['/family/*', '/families', '/signup'];

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
  // The menu drawer (tablets) or the More sheet (phones); one at a time.
  const [overlay, setOverlay] = useState<'menu' | 'more' | null>(null);
  const menuOpen = overlay !== null;
  const setMenuOpen = (open: boolean) => setOverlay(open ? 'menu' : null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  // Logged in on this page earlier: a later "out" is someone logging out on purpose.
  const wasIn = useRef(false);
  useEffect(() => {
    if (meState.status === 'in') wasIn.current = true;
  }, [meState.status]);

  // The family in the address becomes "the last one opened".
  useEffect(() => {
    if (fromUrl) saveFamilyId(fromUrl);
  }, [fromUrl]);

  // Any navigation closes the menu.
  useEffect(() => setOverlay(null), [location.pathname, location.search]);

  // While the drawer is open: Escape closes it, the page behind does not scroll.
  useEffect(() => {
    if (!overlay) return;
    const button = overlay === 'more' ? moreButton.current : menuButton.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverlay(null);
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
  }, [overlay]);

  if (location.pathname === '/') return <Outlet />;
  // The landing page's "Sign in" still points at the old mock sign-in form,
  // which has made-up details in it; anyone following it gets the real one.
  if (location.pathname === '/signin') return <Navigate to="/login" replace />;
  if (meState.status === 'out' && ACCOUNT_ONLY.some((pattern) => matchPath(pattern, location.pathname))) {
    return <Navigate to={authPath('login', wasIn.current ? null : location.pathname + location.search)} replace />;
  }

  const label = pageLabel(location.pathname, familyId);
  const tabs = Boolean(familyId) && meState.status === 'in' && WITH_TABS.some((pattern) => matchPath(pattern, location.pathname));

  return (
    <div className={`app-shell${tabs ? ' has-tabs' : ''}`}>
      {/* While the phone menu is open everything else is inert, so the keyboard
          and screen readers stay inside the menu, as a dialog promises. */}
      <a className="app-skip" href="#app-main" inert={menuOpen}>
        Skip to the page
      </a>

      <aside className="app-rail" inert={menuOpen}>
        <Sidebar familyId={familyId} familyName={familyName} meState={meState} />
      </aside>

      <header className="app-topbar" inert={menuOpen}>
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
          aria-expanded={overlay === 'menu'}
          aria-controls="app-drawer"
        >
          <Menu size={20} aria-hidden="true" />
          <span>Menu</span>
        </button>
      </header>

      {overlay === 'menu' ? (
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

      <main id="app-main" className="app-main" inert={menuOpen}>
        <div className="app-content">
          {/* Pages load on demand; the navigation stays while one does. */}
          <Suspense fallback={<div className="app-page-loading" aria-busy="true" aria-label="Loading" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {tabs && familyId ? (
        <div className="app-tabs-wrap" inert={menuOpen}>
          <PhoneTabs ref={moreButton} familyId={familyId} moreOpen={overlay === 'more'} onMore={() => setOverlay('more')} />
        </div>
      ) : null}

      {overlay === 'more' && familyId ? (
        <MoreSheet ref={drawer} familyId={familyId} familyName={familyName} meState={meState} onClose={() => setOverlay(null)} />
      ) : null}
    </div>
  );
}
