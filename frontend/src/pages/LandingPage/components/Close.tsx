// Section 10 (back to night, a green call from Mum), the footer and the mobile bar.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Code } from 'lucide-react';
import { close, footer, mobileBar, REPO_URL, SIGNIN, SOURCES } from '../copy';
import { Phone } from './Phone';
import { MumScreen } from './screens';
import { WaitlistForm } from './Forms';
import { NavLinkItem } from './Nav';

export function Close() {
  return (
    <section id="start" className="lp-sec lp-close" aria-labelledby="close-h" data-theme="dark">
      <div className="lp-wrap lp-split">
        <div className="lp-split__copy">
          <h2 id="close-h" className="lp-h2">
            {close.h2}
          </h2>
          <p className="lp-lead">{close.body}</p>
          <Link to="/signup" className="lp-btn lp-btn--light">
            {close.cta}
          </Link>
          <hr className="lp-hair" />
          <WaitlistForm />
        </div>
        <div className="lp-split__object lp-close__object">
          <span className="lp-close__glow" aria-hidden="true" />
          <Phone className="lp-phone--close" rings="safe">
            <MumScreen />
          </Phone>
        </div>
      </div>
    </section>
  );
}

export function Footer({ onHome = true }: { onHome?: boolean }) {
  return (
    <footer className="lp-footer" data-theme="dark">
      <div className="lp-wrap lp-footer__grid">
        <div className="lp-footer__brand">
          <span className="lp-brand lp-brand--static">
            <img src="/icon-192.png" alt="" width={28} height={28} />
            <span>Callback</span>
          </span>
          <p>{footer.tagline}</p>
        </div>
        <nav className="lp-footer__links" aria-label="Footer">
          {footer.links.map((l) => (
            <NavLinkItem key={l.href} href={l.href} label={l.label} onHome={onHome} />
          ))}
          <Link to={SIGNIN}>{footer.signIn}</Link>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <Code size={16} strokeWidth={1.75} aria-hidden="true" />
            {footer.source}
          </a>
        </nav>
        <div className="lp-footer__fine">
          <p>{footer.disclosure}</p>
          <p className="lp-footer__sources">
            {footer.sourcesTitle}:{' '}
            {SOURCES.map((s, i) => (
              <span key={s.id} id={`src-${s.id}`}>
                <sup>{s.id}</sup>{' '}
                <a href={s.href} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
                {i < SOURCES.length - 1 ? '. ' : '.'}
              </span>
            ))}
          </p>
          <p>{footer.built}</p>
          <p>{footer.copyright}</p>
        </div>
      </div>
    </footer>
  );
}

/** Mobile only: shown after the hero leaves, hidden over pricing, the banks form and the close. */
export function MobileBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const hero = document.getElementById('top');
    const blockers = ['pricing', 'banks', 'start']
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    let heroOut = false;
    const blocked = new Set<Element>();
    const update = () => setShow(heroOut && blocked.size === 0);
    const io1 = new IntersectionObserver(([e]) => {
      heroOut = !e.isIntersecting;
      update();
    });
    if (hero) io1.observe(hero);
    const io2 = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? blocked.add(e.target) : blocked.delete(e.target)));
      update();
    });
    blockers.forEach((b) => io2.observe(b));
    return () => {
      io1.disconnect();
      io2.disconnect();
    };
  }, []);
  return (
    <div className={`lp-mbar${show ? ' is-on' : ''}`} aria-hidden={!show || undefined} inert={!show || undefined}>
      <Link to="/signup" className="lp-btn lp-btn--light lp-btn--block">
        {mobileBar.cta}
      </Link>
    </div>
  );
}
