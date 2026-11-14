// Callback's landing page. It opens as an incoming call and, as you scroll, the same
// phone carries you through the product, from night (the scam) into day (the plan).
// Lite mode (CSS phone) renders first everywhere; the WebGL phone loads after the
// page has loaded, only on capable desktops.
import { Suspense, useEffect, useRef, useState, type ComponentType, type RefObject } from 'react';
import './styles/landing.scss';
import { head } from './copy';
import { store, useLp } from './store';
import { callMachine } from './callMachine';
import { afterLoadIdle, can3D, prefersReducedMotion } from './capability';
import { useLandingHead, useLandingShell } from './useLandingHead';
import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { Habit, Problem } from './components/Night';
import { Story } from './components/Story';
import { Shield } from './components/Shield';
import { Banks, Dawn, Faq, PricingSection, Rules, usePricing } from './components/Day';
import { Close, Footer, MobileBar } from './components/Close';

type StageProps = { portal: RefObject<HTMLDivElement | null>; onReady: () => void; onFail: () => void };

export default function LandingPage() {
  useLandingHead({ title: head.title, description: head.description, theme: '#07111a' });
  const rootRef = useRef<HTMLDivElement>(null);
  const stageUiRef = useRef<HTMLDivElement>(null);
  const mode = useLp((s) => s.mode);
  const reduced = useLp((s) => s.reducedMotion);
  const pricingData = usePricing();
  const [Stage, setStage] = useState<ComponentType<StageProps> | null>(null);
  useLandingShell(rootRef);

  // The scroll driver (GSAP ScrollTrigger) loads after first paint.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let stop: (() => void) | undefined;
    let alive = true;
    const cancel = afterLoadIdle(() => {
      import('./motion')
        .then((m) => {
          if (alive && rootRef.current) stop = m.startScroll(rootRef.current);
        })
        .catch(() => undefined);
    });
    return () => {
      alive = false;
      cancel();
      stop?.();
    };
  }, []);

  // The 3D chunk: only on capable desktops, after load and idle.
  useEffect(() => {
    if (!can3D()) return;
    let alive = true;
    const cancel = afterLoadIdle(() => {
      import('./three/Stage')
        .then((m) => {
          if (alive) setStage(() => m.default);
        })
        .catch(() => undefined);
    });
    return () => {
      alive = false;
      cancel();
    };
  }, []);

  useEffect(
    () => () => {
      callMachine.cancel();
      store.reset();
      store.set({ mode: 'lite', overlayOpen: false });
    },
    [],
  );

  const onReady = () => {
    // Swap only while the hero phone rings and nothing inside it has focus.
    const trySwap = () => {
      const st = store.get();
      const focusInPhone = !!document.activeElement?.closest('[data-phone-anchor="hero"]');
      if (st.call === 'ringing' && !focusInPhone) {
        store.set({ mode: '3d' });
        return true;
      }
      return false;
    };
    if (trySwap()) return;
    const unsub = store.subscribe(() => {
      if (trySwap()) unsub();
    });
  };
  const onFail = () => {
    store.set({ mode: 'lite' });
    setStage(null);
  };

  return (
    <div className="lp" lang="en-GB" ref={rootRef} data-mode={mode} data-reduced={reduced || undefined}>
      <Nav />
      <main id="content" tabIndex={-1}>
        <div className="lp-night">
          {Stage ? (
            <Suspense fallback={null}>
              <Stage portal={stageUiRef} onReady={onReady} onFail={onFail} />
            </Suspense>
          ) : null}
          <Hero stageUiRef={stageUiRef} />
          <Problem />
          <Habit />
          <Story />
          <Shield />
        </div>
        <Dawn />
        <Rules />
        <PricingSection data={pricingData} />
        <Banks />
        <Faq />
        <Close />
      </main>
      <Footer />
      <MobileBar />
    </div>
  );
}
