// Callback's landing page. It opens as an incoming call and, as you scroll, the same
// phone carries you through the product, from night (the scam) into day (the plan).
// Lite mode (CSS phone) renders first everywhere; the WebGL phone loads after the
// page has loaded, only on capable desktops.
import { Component, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react';
import './styles/landing.scss';
import { head } from './copy';
import { store, useLp } from './store';
import { callMachine, inFocusCall } from './callMachine';
import { startScroll } from './motion';
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

/** If the 3D stage throws (no WebGL after all, a driver bug), the page carries on in lite mode. */
class StageBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function LandingPage() {
  useLandingHead({ title: head.title, description: head.description, theme: '#07111a' });
  const rootRef = useRef<HTMLDivElement>(null);
  const stageUiRef = useRef<HTMLDivElement>(null);
  const mode = useLp((s) => s.mode);
  const reduced = useLp((s) => s.reducedMotion);
  // While the call plays, the page steps back: the headline and nav dim, the ground darkens.
  const callFocus = useLp((s) => inFocusCall(s.call));
  const glitching = useLp((s) => s.call === 'glitch');
  const pricingData = usePricing();
  const [Stage, setStage] = useState<ComponentType<StageProps> | null>(null);
  useLandingShell(rootRef);

  // The scroll driver (cached offsets, one frame per scroll). Reduced motion shows
  // every chapter as a still row, so it needs no scroll progress.
  useEffect(() => {
    if (prefersReducedMotion() || !rootRef.current) return;
    return startScroll(rootRef.current);
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
    // Retry when the call or the focus changes.
    const retry = () => {
      if (!trySwap()) return;
      unsub();
      document.removeEventListener('focusin', retry);
    };
    const unsub = store.subscribe(retry);
    document.addEventListener('focusin', retry);
  };
  const onFail = () => {
    store.set({ mode: 'lite' });
    setStage(null);
  };

  return (
    <div
      className="lp"
      lang="en-GB"
      ref={rootRef}
      data-mode={mode}
      data-reduced={reduced || undefined}
      data-call-focus={callFocus || undefined}
      data-glitch={glitching || undefined}
    >
      <Nav />
      <main id="content" tabIndex={-1}>
        <div className="lp-night">
          {/* Under the 3D canvas and the text: darkens the ground during the call. */}
          <div className="lp-vignette" aria-hidden="true" />
          {Stage ? (
            <StageBoundary onFail={onFail}>
              <Suspense fallback={null}>
                <Stage portal={stageUiRef} onReady={onReady} onFail={onFail} />
              </Suspense>
            </StageBoundary>
          ) : null}
          <Hero stageUiRef={stageUiRef} trialDays={pricingData.trial_days} />
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
