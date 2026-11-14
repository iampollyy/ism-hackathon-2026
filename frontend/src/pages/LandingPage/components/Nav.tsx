import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { nav, SIGNIN, SIGNUP } from '../copy';
import { SoundToggle } from './SoundToggle';

/** Anchor links work on the landing page; elsewhere (the pricing page) they lead back to it. */
export function NavLinkItem({ href, label, onHome, onClick }: { href: string; label: string; onHome: boolean; onClick?: () => void }) {
  if (href === '#pricing' && !onHome)
    return (
      <Link to="/pricing" onClick={onClick}>
        {label}
      </Link>
    );
  return onHome ? (
    <a href={href} onClick={onClick}>
      {label}
    </a>
  ) : (
    <Link to={`/${href}`} onClick={onClick}>
      {label}
    </Link>
  );
}

export function Nav({ onHome = true, initialTheme = 'dark', showSound = true }: { onHome?: boolean; initialTheme?: 'dark' | 'light'; showSound?: boolean }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(initialTheme);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // The nav takes the theme of the section under it.
  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-theme]'));
    if (sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setTheme((e.target as HTMLElement).dataset.theme === 'light' ? 'light' : 'dark');
        }
      },
      { rootMargin: '-28px 0px -95% 0px' },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:24px;left:0;width:1px;height:1px;pointer-events:none;';
    document.body.appendChild(sentinel);
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    io.observe(sentinel);
    return () => {
      io.disconnect();
      sentinel.remove();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}${open ? ' is-open' : ''}`} data-nav-theme={theme}>
      <a className="lp-skip" href="#content">
        {nav.skip}
      </a>
      <div className="lp-wrap lp-nav__bar">
        {onHome ? (
          <a href="#top" className="lp-brand" aria-label="Callback, back to the top">
            <img src="/icon-192.png" alt="" width={28} height={28} />
            <span>{nav.brand}</span>
          </a>
        ) : (
          <Link to="/" className="lp-brand" aria-label="Callback home">
            <img src="/icon-192.png" alt="" width={28} height={28} />
            <span>{nav.brand}</span>
          </Link>
        )}
        <nav className="lp-nav__links" aria-label="Main">
          {nav.links.map((l) => (
            <NavLinkItem key={l.href} href={l.href} label={l.label} onHome={onHome} />
          ))}
        </nav>
        <div className="lp-nav__right">
          {showSound ? <SoundToggle /> : null}
          <Link to={SIGNIN} className="lp-nav__signin">
            {nav.signIn}
          </Link>
          <Link to={SIGNUP} className="lp-btn lp-btn--nav">
            {nav.cta}
          </Link>
          <button
            type="button"
            className="lp-nav__menu"
            aria-expanded={open}
            aria-controls="lp-menu"
            aria-label={open ? nav.closeMenu : nav.menu}
            ref={btnRef}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={22} strokeWidth={1.75} aria-hidden="true" /> : <Menu size={22} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div id="lp-menu" className="lp-menu" ref={menuRef} hidden={!open}>
        <nav aria-label="Main, mobile">
          {nav.links.map((l) => (
            <NavLinkItem key={l.href} href={l.href} label={l.label} onHome={onHome} onClick={close} />
          ))}
          <Link to={SIGNIN} onClick={close}>
            {nav.signIn}
          </Link>
        </nav>
        <Link to={SIGNUP} className="lp-btn lp-btn--light lp-btn--block" onClick={close}>
          {nav.cta}
        </Link>
      </div>
    </header>
  );
}
