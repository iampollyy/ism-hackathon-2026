// Section 1: the call. The page opens as an incoming call; Answer plays the scam,
// the screen glitches into the truth, and the phone calls the real son back.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, Phone as PhoneIcon, PhoneOff, RotateCcw, MessageCircle } from 'lucide-react';
import { hero } from '../copy';
import { REVEAL_LINES, SCAM_LINES, lineAt, type Line } from '../captions';
import { callMachine, focusMark, isActiveCall, setAnnouncer } from '../callMachine';
import { callAudio } from '../audio';
import { live, store, useLp, type CallState } from '../store';
import { Phone, type Rings } from './Phone';
import { HeroScreen, LiveWave, fmt, scrambleInto } from './screens';
import { SoundToggle } from './SoundToggle';

const ICON = { strokeWidth: 1.75 } as const;

type Panel = 'intro' | 'call' | 'done' | 'declined' | 'stopped';

function panelFor(call: CallState): Panel {
  if (call === 'ringing' || call === 'connecting') return 'intro';
  if (call === 'done') return 'done';
  if (call === 'declined') return 'declined';
  if (call === 'stopped') return 'stopped';
  return 'call';
}

export function ringsFor(call: CallState): Rings {
  if (call === 'ringing' || call === 'connecting') return 'scam';
  if (call === 'calling-back') return 'safe';
  return 'off';
}

function glowFor(call: CallState, lesson: boolean): string {
  if (call === 'ringing' || call === 'connecting') return 'scam-rest';
  if (call === 'in-call') return 'scam';
  if (call === 'calling-back' || call === 'connected') return 'safe';
  if (call === 'reveal') return lesson ? 'safe-soft' : 'cool';
  if (call === 'glitch' || call === 'hung-up') return 'cool';
  return 'rest';
}

// ------------------------------------------------------------- captions

function CaptionLine({ line, t, size = 'lg' }: { line: Line; t: number; size?: 'lg' | 'md' }) {
  return (
    <p className={`lp-cap lp-cap--${size}`}>
      {line.words.map((w, i) => (
        <span key={i} className={`lp-cap__w${t >= w.start ? ' is-lit' : ''}${w.safe ? ' is-safe' : ''}`}>
          {w.text}
          {i < line.words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  );
}

function Captions({ lines, t, size }: { lines: Line[]; t: number; size?: 'lg' | 'md' }) {
  const idx = lineAt(lines, t);
  if (idx < 0) return <div className="lp-caps" aria-hidden="true" />;
  return (
    <div className="lp-caps" aria-hidden="true">
      <CaptionLine key={idx} line={lines[idx]} t={t} size={size} />
    </div>
  );
}

/** "Please don't tell Dad." (or "You hung up...") scrambles into "That voice wasn't real." */
function DisplayLine({ call }: { call: CallState }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useLp((s) => s.reducedMotion);
  const from = callMachine.hungUp ? hero.hungUp : SCAM_LINES[SCAM_LINES.length - 1].text;
  useEffect(() => {
    const el = ref.current;
    if (!el || call !== 'glitch' || reduced) return;
    el.textContent = from;
    let stop = () => undefined as void;
    const id = window.setTimeout(() => {
      stop = scrambleInto(el, from, hero.glitch, 520);
    }, 380);
    return () => {
      window.clearTimeout(id);
      stop();
    };
  }, [call, from, reduced]);
  if (call === 'hung-up')
    return (
      <p className="lp-display lp-display--in" aria-hidden="true">
        {hero.hungUp}
      </p>
    );
  if (call === 'glitch')
    return (
      <p className={`lp-display${reduced ? ' lp-display--in' : ' is-glitching'}`} aria-hidden="true">
        <span ref={ref}>{reduced ? hero.glitch : from}</span>
      </p>
    );
  return (
    <p className="lp-display" aria-hidden="true">
      {hero.glitch}
    </p>
  );
}

export function CaptionStage({ compact = false }: { compact?: boolean }) {
  const call = useLp((s) => s.call);
  const scamT = useLp((s) => s.scamT);
  const revealT = useLp((s) => s.revealT);
  const timer = useLp((s) => s.timer);
  const noSound = useLp((s) => s.noSound);
  const showReveal = call === 'reveal' || call === 'calling-back' || call === 'connected' || call === 'done';
  return (
    <div className={`lp-capstage${compact ? ' lp-capstage--compact' : ''}`} data-call={call}>
      {call === 'in-call' || call === 'connecting' ? (
        <p className="lp-status">
          <span className="lp-status__dot" aria-hidden="true" />
          {call === 'connecting' ? hero.connecting : `${hero.onCall} · `}
          {call === 'connecting' ? null : <span className="lp-tnum">{fmt(timer)}</span>}
        </p>
      ) : null}
      {call === 'in-call' ? <Captions lines={SCAM_LINES} t={scamT} size={compact ? 'md' : 'lg'} /> : null}
      {call === 'hung-up' || call === 'glitch' || showReveal ? <DisplayLine call={call} /> : null}
      {showReveal ? <Captions lines={REVEAL_LINES} t={call === 'reveal' ? revealT : 99} size="md" /> : null}
      {noSound && (call === 'in-call' || call === 'reveal') ? (
        <p className="lp-nosound">
          {hero.noSound}{' '}
          <button type="button" className="lp-link" onClick={() => callMachine.answer({ overlay: store.get().overlayOpen })}>
            {hero.trySound}
          </button>
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- mobile call card and overlay

function useMobileLayout() {
  const [mobile, setMobile] = useState(() => {
    try {
      return window.matchMedia('(max-width: 859px)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 859px)');
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

function CallCard({ call, declineStep }: { call: CallState; declineStep: 0 | 1 }) {
  const ringing = call === 'ringing' || call === 'connecting';
  const intent = () => callAudio.warm();
  const declined = call === 'declined';
  const label =
    call === 'done' || call === 'connected' || call === 'calling-back'
      ? `${hero.son} · ${hero.savedContact}`
      : declined
        ? hero.callDeclined
        : call === 'stopped'
          ? 'Call ended'
          : ringing
            ? hero.mobile
            : hero.onCall;
  return (
    <div className="lp-callcard" data-rings={ringsFor(call)} data-call={call}>
      <span className="lp-rings lp-rings--card" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {declined && declineStep === 1 ? (
        <div className="lp-bubble is-in lp-bubble--card">
          <span className="lp-bubble__app">
            <MessageCircle size={16} {...ICON} aria-hidden="true" />
            {hero.messageFrom} · {hero.unknown}
            <span className="lp-bubble__when">{hero.now}</span>
          </span>
          <p>{hero.declineBubble}</p>
        </div>
      ) : null}
      <div className="lp-callcard__who">
        <span className="lp-avatar lp-avatar--neutral" aria-hidden="true">
          ?
        </span>
        <div>
          <p className="lp-callcard__name">{hero.unknown}</p>
          <p className="lp-callcard__sub">{label}</p>
        </div>
      </div>
      {ringing ? (
        <div className="lp-callcard__actions">
          <span className="lp-rb">
            <button
              type="button"
              className="lp-rb__btn lp-rb__btn--scam"
              aria-label={hero.declineLabel}
              onClick={() => callMachine.decline()}
              onPointerEnter={intent}
              onTouchStart={intent}
              onFocus={intent}
              disabled={call === 'connecting'}
            >
              <PhoneOff size={28} {...ICON} aria-hidden="true" />
            </button>
            <span className="lp-rb__label" aria-hidden="true">
              {hero.decline}
            </span>
          </span>
          <span className="lp-rb">
            <button
              type="button"
              className="lp-rb__btn lp-rb__btn--safe is-breathing"
              aria-label={hero.answerLabel}
              data-lp-focus="answer-card"
              onClick={() => callMachine.answer({ overlay: true })}
              onPointerEnter={intent}
              onTouchStart={intent}
              onFocus={intent}
              disabled={call === 'connecting'}
            >
              <PhoneIcon size={28} {...ICON} aria-hidden="true" />
            </button>
            <span className="lp-rb__label" aria-hidden="true">
              {call === 'connecting' ? hero.connecting : hero.answer}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function CallOverlay({ returnFocus }: { returnFocus: RefObject<HTMLElement | null> }) {
  const call = useLp((s) => s.call);
  const lesson = useLp((s) => s.lesson);
  const backTimer = useLp((s) => s.backTimer);
  const ref = useRef<HTMLDivElement>(null);

  const closeOverlay = () => {
    if (isActiveCall(store.get().call)) callMachine.stop();
    store.set({ overlayOpen: false });
    window.setTimeout(() => {
      const el = returnFocus.current?.querySelector<HTMLElement>('button, a');
      el?.focus({ preventScroll: true });
    }, 30);
  };

  useLayoutEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeOverlay();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const els = Array.from(
        ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
      );
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!ref.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tone = call === 'calling-back' || call === 'connected' || call === 'done' ? 'safe' : 'scam';
  return (
    <div
      className={`lp-overlay lp-overlay--${tone}`}
      role="dialog"
      aria-modal="true"
      aria-label={hero.dialogLabel}
      ref={ref}
      data-call={call}
    >
      <div
        className={`lp-overlay__inner${call === 'glitch' ? ' lp-overlay--glitch' : ''}`}
        tabIndex={-1}
        data-lp-focus="stage-overlay"
      >
        <div className="lp-overlay__top">
          <p className="lp-overlay__who">
            {tone === 'safe' ? hero.son : call === 'reveal' ? hero.practiceBadge : hero.unknown}
          </p>
          <p className="lp-overlay__sub lp-tnum">
            {call === 'calling-back'
              ? hero.calling
              : call === 'connected' || call === 'done'
                ? fmt(backTimer)
                : call === 'reveal'
                  ? hero.revealSub
                  : null}
          </p>
        </div>
        <div className="lp-overlay__mid">
          {call === 'done' ? <p className="lp-done">{hero.doneLine}</p> : <CaptionStage compact />}
          {call === 'in-call' ? <LiveWave active /> : null}
          {call === 'reveal' ? (
            <div className={`lp-reveal__lesson lp-reveal__lesson--overlay${lesson ? ' is-shown' : ''}`}>
              <span className="lp-reveal__label">{hero.remember}</span>
              <p>{hero.lesson}</p>
            </div>
          ) : null}
        </div>
        <div className="lp-overlay__actions">
          {call === 'in-call' || call === 'connecting' ? (
            <span className="lp-rb">
              <button
                type="button"
                className="lp-rb__btn lp-rb__btn--scam"
                aria-label={hero.endLabel}
                data-lp-focus="end"
                onClick={() => callMachine.end()}
                disabled={call === 'connecting'}
              >
                <PhoneOff size={30} {...ICON} aria-hidden="true" />
              </button>
              <span className="lp-rb__label" aria-hidden="true">
                {hero.end}
              </span>
            </span>
          ) : null}
          {call === 'reveal' ? (
            <button type="button" className="lp-callbtn" data-lp-focus="call-son" onClick={() => callMachine.callBack()}>
              <PhoneIcon size={22} {...ICON} aria-hidden="true" />
              {hero.callSon}
            </button>
          ) : null}
          {call === 'done' || call === 'connected' || call === 'stopped' ? (
            <button type="button" className="lp-btn lp-btn--light lp-btn--block" data-lp-focus="replay" onClick={closeOverlay}>
              {hero.backToPage}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- the hero

export function Hero({ stageUiRef }: { stageUiRef?: RefObject<HTMLDivElement | null> }) {
  const call = useLp((s) => s.call);
  const declineStep = useLp((s) => s.declineStep);
  const lesson = useLp((s) => s.lesson);
  const soundOn = useLp((s) => s.soundOn);
  const mode = useLp((s) => s.mode);
  const overlayOpen = useLp((s) => s.overlayOpen);
  const sectionRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const announcerRef = useRef<HTMLDivElement>(null);
  const mobile = useMobileLayout();
  const panel = panelFor(call);

  useEffect(() => {
    setAnnouncer(announcerRef.current);
    return () => setAnnouncer(null);
  }, []);

  // The glow follows the voice: one rAF while a call is live, writing a CSS variable.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const liveCall = call === 'in-call' || call === 'reveal' || call === 'hung-up' || call === 'glitch';
    if (!liveCall) {
      el.style.setProperty('--lvl', '0');
      return;
    }
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      smooth += (live.audioLevel - smooth) * 0.25;
      el.style.setProperty('--lvl', smooth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [call]);

  // Scrolling away (less than 40% of the hero on screen) or hiding the tab stops the call.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      () => {
        // Entries can arrive late; measure now rather than trust the entry.
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const shown = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)) / Math.max(1, Math.min(r.height, vh));
        if (shown < 0.4 && !store.get().overlayOpen) callMachine.stop();
      },
      { threshold: [0, 0.4, 1] },
    );
    io.observe(el);
    const onVis = () => {
      if (document.visibilityState === 'hidden') callMachine.stop();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Focus never gets lost when a panel cross-fades: move it before the old one hides.
  useEffect(() => {
    if (call === 'declined' && declineStep === 1) focusMark('hear-anyway');
    if (call === 'stopped') focusMark('replay');
    // End disappears when the visitor hangs up: keep focus on the call itself.
    if (call === 'hung-up') focusMark(store.get().overlayOpen ? 'stage-overlay' : 'stage');
  }, [call, declineStep]);

  const replay = () => callMachine.replay({ overlay: mobile });
  const hearAnyway = () => callMachine.answer({ overlay: mobile });

  const panelProps = (p: Panel) => ({
    className: `lp-stage__panel lp-stage__panel--${p}${panel === p ? ' is-on' : ''}`,
    'aria-hidden': panel !== p || undefined,
    inert: panel !== p || undefined,
  });

  return (
    <section
      id="top"
      className="lp-sec lp-hero"
      aria-labelledby="lp-h1"
      ref={sectionRef}
      data-call={call}
      data-glow={glowFor(call, lesson)}
    >
      <div className="lp-hero__glow" aria-hidden="true" />
      <div className="lp-wrap lp-hero__grid">
        <div className="lp-hero__copy">
          <h1 id="lp-h1" className="lp-h1">
            <span className="lp-enter" style={{ ['--d' as string]: '0ms' }}>
              {hero.h1a}
            </span>{' '}
            <span className="lp-enter" style={{ ['--d' as string]: '80ms' }}>
              {hero.h1b}
            </span>
          </h1>
          <div className="lp-stage" data-panel={panel}>
            <div {...panelProps('intro')}>
              <p className="lp-lead lp-enter" style={{ ['--d' as string]: '120ms' }}>
                {hero.sub}
              </p>
              <div className="lp-hero__cta lp-enter" style={{ ['--d' as string]: '200ms' }}>
                <Link to="/signup" className="lp-btn lp-btn--light">
                  {hero.cta}
                </Link>
                <p className="lp-small lp-muted">{hero.priceLine(30)}</p>
              </div>
            </div>
            <div {...panelProps('call')} tabIndex={-1} data-lp-focus="stage">
              {panel === 'call' && !overlayOpen ? <CaptionStage /> : null}
            </div>
            <div {...panelProps('done')}>
              <p className="lp-done">{hero.doneLine}</p>
              <div className="lp-row">
                <Link to="/signup" className="lp-btn lp-btn--light">
                  {hero.cta}
                </Link>
                <button type="button" className="lp-btn lp-btn--ghost" onClick={replay} data-lp-focus="replay">
                  <RotateCcw size={18} {...ICON} aria-hidden="true" />
                  {hero.replay}
                </button>
              </div>
              <a href="#how" className="lp-link lp-link--cue">
                {hero.seeHow}
                <ArrowDown size={18} {...ICON} aria-hidden="true" />
              </a>
            </div>
            <div {...panelProps('declined')}>
              <p className="lp-display lp-display--sm">{hero.declineTitle}</p>
              <p className="lp-lead">{hero.declineBody}</p>
              <div className="lp-row">
                <button type="button" className="lp-btn lp-btn--light" onClick={hearAnyway} data-lp-focus="hear-anyway">
                  <PhoneIcon size={18} {...ICON} aria-hidden="true" />
                  {hero.hearAnyway}
                </button>
                <a href="#how" className="lp-link">
                  {hero.seeHow}
                  <ArrowRight size={18} {...ICON} aria-hidden="true" />
                </a>
              </div>
            </div>
            <div {...panelProps('stopped')}>
              <p className="lp-lead">{hero.stopped}</p>
              <div className="lp-row">
                <button type="button" className="lp-btn lp-btn--light" onClick={replay} data-lp-focus="replay">
                  <RotateCcw size={18} {...ICON} aria-hidden="true" />
                  {hero.replay}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="lp-hero__object">
          <div className="lp-hero__phonewrap lp-enter-phone">
            <Phone anchor="hero" rings={ringsFor(call)} tilt="hero" decorative={mode === '3d'} className="lp-phone--hero">
              <HeroScreen interactive={mode === 'lite' && !mobile} />
            </Phone>
          </div>
          <div className="lp-hero__card" ref={cardRef}>
            <CallCard call={call} declineStep={declineStep} />
          </div>
          {/* The 3D phone's screen is portalled here, so its buttons follow the page's tab order. */}
          <div className="lp-stage-ui" ref={stageUiRef} />
          <div className="lp-hero__notes">
            <p className="lp-hint">
              {call === 'ringing' || call === 'connecting' ? <span>{soundOn ? hero.hintSound : hero.hintMuted}</span> : null}
              <SoundToggle className="lp-sound--inline" withLabel={call !== 'ringing' && call !== 'connecting'} />
            </p>
            <p className="lp-disclosure">{hero.disclosure}</p>
            <details className="lp-details">
              <summary>{hero.transcriptTitle}</summary>
              <p>
                <strong>{hero.callerPrefix}</strong> {SCAM_LINES.map((l) => l.text).join(' ')}
              </p>
              <p>
                <strong>{hero.callbackPrefix}</strong> {REVEAL_LINES.map((l) => l.text).join(' ')}
              </p>
            </details>
          </div>
          <div className="lp-hero__mcta">
            <Link to="/signup" className="lp-btn lp-btn--ghost lp-btn--block">
              {hero.cta}
            </Link>
            <p className="lp-small lp-muted">{hero.priceLine(30)}</p>
          </div>
        </div>
      </div>
      <div className="lp-sr" aria-live="polite" ref={announcerRef} />
      {overlayOpen && mobile ? <CallOverlay returnFocus={cardRef} /> : null}
    </section>
  );
}
