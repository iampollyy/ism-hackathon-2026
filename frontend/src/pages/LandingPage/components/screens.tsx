// Phone screens, drawn at the 390 x 844 design size. The same components render
// inside the CSS phone (scaled) and on the 3D phone's glass (drei Html), so they
// read shared state from the store and never from React context.
import { useEffect, useRef, type ReactNode } from 'react';
import {
  BellRing,
  Check,
  Hand,
  MessageCircle,
  Mic,
  Phone,
  PhoneOff,
  ShieldCheck,
} from 'lucide-react';
import { hero, shield, story, close } from '../copy';
import { live, useLp, type CallState } from '../store';
import { callMachine } from '../callMachine';
import { callAudio } from '../audio';

const ICON = { strokeWidth: 1.75 } as const;

export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const range = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

// A seeded generator so static waveforms look the same on every visit.
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WAVE = (() => {
  const r = mulberry32(7);
  return Array.from({ length: 56 }, (_, i) => {
    const env = 0.35 + 0.65 * Math.sin((i / 55) * Math.PI) ** 0.6;
    return Math.max(0.12, env * (0.35 + r() * 0.65));
  });
})();

export function StaticWave({ lit = 1, bars = 56, className = '' }: { lit?: number; bars?: number; className?: string }) {
  const w = 5;
  const width = bars * w - 3;
  return (
    <svg className={`lp-wave ${className}`} viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" aria-hidden="true">
      {WAVE.slice(0, bars).map((v, i) => {
        const h = Math.max(3, v * 40);
        return (
          <rect
            key={i}
            x={i * w}
            y={(40 - h) / 2}
            width={2}
            height={h}
            rx={1}
            className={i / bars < lit ? 'on' : 'off'}
          />
        );
      })}
    </svg>
  );
}

/** Bars that follow the analyser while a clip plays. */
export function LiveWave({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bars = Array.from(el.children) as HTMLElement[];
    let raf = 0;
    let t = 0;
    const draw = () => {
      t += 1;
      const lvl = active ? live.audioLevel : 0;
      bars.forEach((b, i) => {
        const wobble = 0.55 + 0.45 * Math.sin(t * 0.21 + i * 1.7) * Math.cos(t * 0.13 + i * 0.6);
        const h = 0.08 + Math.min(1, lvl * 1.6) * wobble * WAVE[(i * 3) % WAVE.length];
        b.style.transform = `scaleY(${h.toFixed(3)})`;
      });
      if (active) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return (
    <div className="lp-livewave" ref={ref} aria-hidden="true">
      {Array.from({ length: 24 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

export function StatusBar({ time = '18:42' }: { time?: string }) {
  return (
    <div className="lp-sb" aria-hidden="true">
      <span className="lp-sb__time">{time}</span>
      <span className="lp-sb__island" />
      <span className="lp-sb__icons">
        <svg viewBox="0 0 18 12" width="18" height="12">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 27 13" width="27" height="13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity="0.4" />
          <rect x="2.5" y="2.5" width="16" height="8" rx="2" />
          <rect x="25" y="4.5" width="1.6" height="4" rx="0.8" opacity="0.4" />
        </svg>
      </span>
    </div>
  );
}

function Avatar({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'safe' | 'scam' }) {
  return (
    <span className={`lp-avatar lp-avatar--${tone}`} aria-hidden="true">
      {label}
    </span>
  );
}

function RoundButton({
  tone,
  label,
  icon,
  onClick,
  focusName,
  aria,
  interactive,
  breathe,
  onIntent,
}: {
  tone: 'scam' | 'safe';
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  focusName?: string;
  aria?: string;
  interactive: boolean;
  breathe?: boolean;
  onIntent?: () => void;
}) {
  if (!interactive)
    return (
      <span className="lp-rb" aria-hidden="true">
        <span className={`lp-rb__btn lp-rb__btn--${tone}`}>{icon}</span>
        <span className="lp-rb__label">{label}</span>
      </span>
    );
  return (
    <span className="lp-rb">
      <button
        type="button"
        className={`lp-rb__btn lp-rb__btn--${tone}${breathe ? ' is-breathing' : ''}`}
        onClick={onClick}
        aria-label={aria ?? label}
        data-lp-focus={focusName}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        onTouchStart={onIntent}
      >
        {icon}
      </button>
      <span className="lp-rb__label" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}

/** Incoming call (ringing): used by the hero, the field and the close (from Mum). */
export function IncomingScreen({
  name = hero.unknown,
  sub = hero.mobile,
  tone = 'scam',
  interactive = false,
  connecting = false,
  onAnswer,
  onDecline,
  breathe = false,
}: {
  name?: string;
  sub?: string;
  tone?: 'scam' | 'safe';
  interactive?: boolean;
  connecting?: boolean;
  onAnswer?: () => void;
  onDecline?: () => void;
  breathe?: boolean;
}) {
  const intent = () => callAudio.warm();
  return (
    <div className={`lp-scr lp-scr--incoming lp-scr--${tone}`}>
      <StatusBar />
      <div className="lp-scr__head">
        <Avatar label={tone === 'safe' ? name.charAt(0) : '?'} tone={tone === 'safe' ? 'safe' : 'neutral'} />
        <p className="lp-scr__name">{name}</p>
        <p className="lp-scr__sub">{connecting ? hero.connecting : sub}</p>
      </div>
      <div className="lp-scr__actions">
        <RoundButton
          tone="scam"
          label={hero.decline}
          aria={hero.declineLabel}
          icon={<PhoneOff size={30} {...ICON} />}
          interactive={interactive && !connecting}
          onClick={onDecline}
          focusName="decline"
          onIntent={intent}
        />
        <RoundButton
          tone="safe"
          label={hero.answer}
          aria={hero.answerLabel}
          icon={<Phone size={30} {...ICON} />}
          interactive={interactive && !connecting}
          onClick={onAnswer}
          focusName="answer"
          breathe={breathe}
          onIntent={intent}
        />
      </div>
    </div>
  );
}

function InCallScreen({
  name,
  timer,
  active,
  interactive,
  ended,
  tone = 'scam',
  onEnd,
  scramble,
}: {
  name: string;
  timer: number;
  active: boolean;
  interactive: boolean;
  ended?: boolean;
  tone?: 'scam' | 'safe';
  onEnd?: () => void;
  scramble?: boolean;
}) {
  return (
    <div className={`lp-scr lp-scr--incall lp-scr--${tone}`}>
      <StatusBar />
      <div className="lp-scr__head">
        <Avatar label={tone === 'safe' ? name.charAt(0) : '?'} tone={tone === 'safe' ? 'safe' : 'neutral'} />
        <p className={`lp-scr__name${scramble ? ' is-scrambling' : ''}`}>
          {scramble ? <ScrambleWord from={name} to={hero.practiceBadge} /> : name}
        </p>
        <p className="lp-scr__sub lp-tnum">{ended ? 'Call ended' : fmt(timer)}</p>
      </div>
      <div className="lp-scr__mid">
        <LiveWave active={active} />
      </div>
      <div className="lp-scr__actions lp-scr__actions--one">
        {ended ? null : (
          <RoundButton
            tone="scam"
            label={hero.end}
            aria={hero.endLabel}
            icon={<PhoneOff size={30} {...ICON} />}
            interactive={interactive}
            onClick={onEnd}
            focusName="end"
          />
        )}
      </div>
    </div>
  );
}

/** Characters of `from` scramble into `to` over the glitch. */
function ScrambleWord({ from, to }: { from: string; to: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return scrambleInto(el, from, to, 520);
  }, [from, to]);
  return <span ref={ref}>{from}</span>;
}

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ#%&*';

/** Resolves characters left to right every 18 ms; unresolved ones cycle every 30 ms. */
export function scrambleInto(el: HTMLElement, from: string, to: string, ms: number): () => void {
  const start = performance.now();
  const len = Math.max(from.length, to.length);
  const step = Math.max(10, Math.min(18, ms / Math.max(1, to.length)));
  let raf = 0;
  let lastCycle = 0;
  let noise = '';
  const frame = (now: number) => {
    const t = now - start;
    const resolved = Math.floor(t / step);
    if (now - lastCycle > 30 || !noise) {
      lastCycle = now;
      noise = Array.from({ length: len }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join('');
    }
    let out = '';
    for (let i = 0; i < len; i += 1) {
      if (i < resolved) out += to[i] ?? '';
      else if ((to[i] ?? ' ') === ' ') out += ' ';
      else out += noise[i];
    }
    el.textContent = out;
    if (resolved < len) raf = requestAnimationFrame(frame);
    else el.textContent = to;
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function RevealCard({
  badge,
  title,
  sub,
  praise,
  lesson,
  lessonShown,
  callLabel,
  interactive,
  onCall,
}: {
  badge: string;
  title: string;
  sub?: string;
  praise?: string;
  lesson: string;
  lessonShown: boolean;
  callLabel: string;
  interactive: boolean;
  onCall?: () => void;
}) {
  return (
    <div className="lp-scr lp-scr--reveal">
      <StatusBar />
      <div className="lp-reveal">
        <span className="lp-badge">
          <ShieldCheck size={16} {...ICON} aria-hidden="true" />
          {badge}
        </span>
        <p className="lp-reveal__title">{title}</p>
        {sub ? <p className="lp-reveal__sub">{sub}</p> : null}
        {praise ? <p className="lp-reveal__praise">{praise}</p> : null}
        <div className={`lp-reveal__lesson${lessonShown ? ' is-shown' : ''}`}>
          <span className="lp-reveal__label">{hero.remember}</span>
          <p>{lesson}</p>
        </div>
      </div>
      <div className="lp-scr__actions lp-scr__actions--wide">
        {interactive ? (
          <button type="button" className="lp-callbtn" onClick={onCall} data-lp-focus="call-son">
            <Phone size={22} {...ICON} aria-hidden="true" />
            {callLabel}
          </button>
        ) : (
          <span className="lp-callbtn" aria-hidden="true">
            <Phone size={22} {...ICON} />
            {callLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export function CallingScreen({ name, timer, connected, note }: { name: string; timer: number; connected: boolean; note?: string }) {
  return (
    <div className="lp-scr lp-scr--incall lp-scr--safe">
      <StatusBar />
      <div className="lp-scr__head">
        <Avatar label={name.charAt(0)} tone="safe" />
        <p className="lp-scr__name">{name}</p>
        <p className="lp-scr__sub lp-tnum">{connected ? fmt(timer) : hero.calling}</p>
        <p className="lp-scr__note">{connected ? (note ?? hero.savedContact) : hero.savedContact}</p>
      </div>
      <div className="lp-scr__mid">
        <span className={`lp-pulse${connected ? ' is-still' : ''}`} aria-hidden="true">
          <Phone size={34} {...ICON} />
        </span>
      </div>
      <div className="lp-scr__actions lp-scr__actions--one">
        <span className="lp-rb" aria-hidden="true">
          <span className="lp-rb__btn lp-rb__btn--scam">
            <PhoneOff size={30} {...ICON} />
          </span>
          <span className="lp-rb__label">{hero.end}</span>
        </span>
      </div>
    </div>
  );
}

function DeclinedScreen({ step }: { step: 0 | 1 }) {
  return (
    <div className="lp-scr lp-scr--declined">
      <StatusBar />
      <div className={`lp-bubble${step === 1 ? ' is-in' : ''}`} aria-hidden={step === 0}>
        <span className="lp-bubble__app">
          <MessageCircle size={16} {...ICON} aria-hidden="true" />
          {hero.messageFrom} · {hero.unknown}
          <span className="lp-bubble__when">{hero.now}</span>
        </span>
        <p>{hero.declineBubble}</p>
      </div>
      <div className="lp-scr__head lp-scr__head--low">
        <Avatar label="?" />
        <p className="lp-scr__name">{hero.unknown}</p>
        <p className="lp-scr__sub">{hero.callDeclined}</p>
      </div>
    </div>
  );
}

/** The interactive hero screen, driven by the call machine. */
export function HeroScreen({ interactive = true }: { interactive?: boolean }) {
  const call = useLp((s) => s.call);
  const declineStep = useLp((s) => s.declineStep);
  const timer = useLp((s) => s.timer);
  const backTimer = useLp((s) => s.backTimer);
  const lesson = useLp((s) => s.lesson);
  const reduced = useLp((s) => s.reducedMotion);
  return (
    <HeroScreenView
      call={call}
      declineStep={declineStep}
      timer={timer}
      backTimer={backTimer}
      lesson={lesson}
      interactive={interactive}
      reduced={reduced}
    />
  );
}

export function HeroScreenView({
  call,
  declineStep,
  timer,
  backTimer,
  lesson,
  interactive,
  reduced,
}: {
  call: CallState;
  declineStep: 0 | 1;
  timer: number;
  backTimer: number;
  lesson: boolean;
  interactive: boolean;
  reduced: boolean;
}) {
  const answer = () => callMachine.answer({ overlay: false });
  const decline = () => callMachine.decline();
  switch (call) {
    case 'ringing':
    case 'connecting':
      return (
        <IncomingScreen
          interactive={interactive}
          connecting={call === 'connecting'}
          onAnswer={answer}
          onDecline={decline}
          breathe={!reduced}
        />
      );
    case 'stopped':
      return <InCallScreen name={hero.unknown} timer={timer} active={false} interactive={false} ended />;
    case 'declined':
      return <DeclinedScreen step={declineStep} />;
    case 'in-call':
    case 'hung-up':
      return (
        <InCallScreen
          name={hero.unknown}
          timer={timer}
          active={call === 'in-call'}
          interactive={interactive}
          ended={call === 'hung-up'}
          onEnd={() => callMachine.end()}
        />
      );
    case 'glitch': {
      const base = (
        <InCallScreen name={hero.unknown} timer={timer} active={false} interactive={false} scramble={!reduced} />
      );
      if (reduced) return base;
      return (
        <div className="lp-glitch">
          {base}
          <div className="lp-glitch__layer lp-glitch__layer--r" aria-hidden="true" inert>
            {base}
          </div>
          <div className="lp-glitch__layer lp-glitch__layer--c" aria-hidden="true" inert>
            {base}
          </div>
          <div className="lp-glitch__scan" aria-hidden="true" />
        </div>
      );
    }
    case 'reveal':
      return (
        <RevealCard
          badge={hero.practiceBadge}
          title={hero.revealTitle}
          sub={hero.revealSub}
          lesson={hero.lesson}
          lessonShown={lesson}
          callLabel={hero.callSon}
          interactive={interactive}
          onCall={() => callMachine.callBack()}
        />
      );
    case 'calling-back':
      return <CallingScreen name={hero.son} timer={0} connected={false} />;
    case 'connected':
    case 'done':
      return <CallingScreen name={hero.son} timer={backTimer} connected note={hero.connectedNote} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- the story

export function RecordingScreen({ p }: { p: number }) {
  const sec = Math.round(12 + p * 46);
  return (
    <div className="lp-scr lp-scr--app">
      <StatusBar time="11:05" />
      <div className="lp-app">
        <p className="lp-app__title">{story.rec.title}</p>
        <p className="lp-app__label">{story.rec.read}</p>
        <p className="lp-app__quote">{story.rec.sentence}</p>
        <div className="lp-rec">
          <span className="lp-rec__dot" />
          <span className="lp-tnum">
            {story.rec.recording} {fmt(sec)} / 1:00
          </span>
          <Mic size={18} {...ICON} aria-hidden="true" />
        </div>
        <StaticWave lit={0.15 + p * 0.85} className="lp-wave--rec" />
        <ul className="lp-people">
          {story.rec.people.map((person) => (
            <li key={person.name}>
              <Avatar label={person.initial} tone={person.done ? 'safe' : 'neutral'} />
              <span>
                <strong>
                  {person.name} · {person.role}
                </strong>
                <em>{person.status}</em>
              </span>
              {person.done ? (
                <Check size={20} {...ICON} className="lp-ok" aria-hidden="true" />
              ) : (
                <span className="lp-rec__dot lp-rec__dot--sm" />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export const TRANSCRIPT_SECONDS = 13;

export function TranscriptScreen({ t, risk }: { t: number; risk?: RiskLevel | null }) {
  const lines = story.transcript.filter((l) => t >= l.t);
  return (
    <div className="lp-scr lp-scr--app lp-scr--dark">
      <StatusBar time="15:20" />
      <div className="lp-callhead">
        <Avatar label="?" />
        <div>
          <p className="lp-callhead__name">{story.callerName}</p>
          <p className="lp-callhead__time lp-tnum">{fmt(Math.min(t, 59) + 0)}</p>
        </div>
        {risk ? <RiskPill level={risk} compact /> : null}
      </div>
      <ol className="lp-transcript">
        {lines.map((l) => {
          const fresh = l.chip && t - l.chipAt >= 0 && t - l.chipAt < 1.2;
          return (
            <li key={l.text} className={`lp-tline lp-tline--${l.who === 'Rasa' ? 'me' : 'them'}${fresh ? ' is-fresh' : ''}`}>
              <span className="lp-tline__who">{l.who}</span>
              <span className="lp-tline__text">{l.text}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export type RiskLevel = 'green' | 'yellow' | 'red';

function RiskPill({ level, compact = false }: { level: RiskLevel; compact?: boolean }) {
  return (
    <span className={`lp-riskpill lp-riskpill--${level}${compact ? ' is-compact' : ''}`} aria-hidden="true">
      <i className="g" />
      <i className="y" />
      <i className="r" />
    </span>
  );
}

export function riskAt(p: number): { level: RiskLevel; text: string } {
  if (p < 0.3) return { level: 'green', text: story.risk.green };
  if (p < 0.62) return { level: 'yellow', text: story.risk.yellow };
  if (p < 0.82) return { level: 'red', text: story.risk.red1 };
  return { level: 'red', text: story.risk.red2 };
}

export function RiskScreen({ p }: { p: number }) {
  const { level, text } = riskAt(p);
  return (
    <div className={`lp-scr lp-scr--app lp-scr--dark lp-scr--risk-${level}`}>
      <StatusBar time="15:20" />
      <div className="lp-callhead">
        <Avatar label="?" />
        <div>
          <p className="lp-callhead__name">{story.callerName}</p>
          <p className="lp-callhead__time lp-tnum">{fmt(13 + Math.round(p * 20))}</p>
        </div>
      </div>
      <div className="lp-risk">
        <p className="lp-risk__title">{story.risk.title}</p>
        <div className="lp-risk__lights">
          <span className={`lp-light lp-light--green${level === 'green' ? ' is-on' : ''}`} />
          <span className={`lp-light lp-light--yellow${level === 'yellow' ? ' is-on' : ''}`} />
          <span className={`lp-light lp-light--red${level === 'red' ? ' is-on' : ''}`} />
        </div>
        <p className="lp-risk__level">{story.risk.levels[level]}</p>
        <p className="lp-risk__text" key={text}>
          {text}
        </p>
      </div>
      <ol className="lp-transcript lp-transcript--dim">
        {story.transcript.slice(2, 5).map((l) => (
          <li key={l.text} className="lp-tline lp-tline--them">
            <span className="lp-tline__who">{l.who}</span>
            <span className="lp-tline__text">{l.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PracticeRevealScreen({ p }: { p: number }) {
  const r = story.reveal;
  if (p >= 0.7) {
    const connected = p >= 0.84;
    return (
      <div className="lp-scr lp-scr--incall lp-scr--safe">
        <StatusBar time="15:21" />
        <div className="lp-scr__head">
          <Avatar label="L" tone="safe" />
          <p className="lp-scr__name">Lukas</p>
          <p className="lp-scr__sub lp-tnum">{connected ? fmt(Math.round((p - 0.84) * 40)) : r.calling}</p>
          <p className="lp-scr__note">{hero.savedContact}</p>
        </div>
        <div className={`lp-notify${p >= 0.9 ? ' is-in' : ''}`}>
          <span className="lp-notify__app">
            <BellRing size={16} {...ICON} aria-hidden="true" />
            {r.notifyApp}
            <span className="lp-notify__when">{hero.now}</span>
          </span>
          <p>{r.notify}</p>
        </div>
        <div className="lp-scr__actions lp-scr__actions--one">
          <span className="lp-rb" aria-hidden="true">
            <span className="lp-rb__btn lp-rb__btn--scam">
              <PhoneOff size={30} {...ICON} />
            </span>
            <span className="lp-rb__label">{hero.end}</span>
          </span>
        </div>
      </div>
    );
  }
  return (
    <RevealCard
      badge={r.badge}
      title={r.title}
      praise={r.praise}
      lesson={r.lesson}
      lessonShown={p >= 0.45}
      callLabel={r.call}
      interactive={false}
    />
  );
}

export function FamilyScreen({ p }: { p: number }) {
  const f = story.family;
  const fill = range(p, 0.1, 0.75);
  return (
    <div className="lp-scr lp-scr--app lp-scr--paper">
      <StatusBar time="19:30" />
      <div className="lp-app">
        <p className="lp-app__title">{f.title}</p>
        <ul className="lp-fam">
          {f.rows.map((row) => (
            <li key={row.name}>
              <div className="lp-fam__top">
                <Avatar label={row.initial} tone={row.next ? 'safe' : 'neutral'} />
                <strong>
                  {row.name} · {row.role}
                </strong>
              </div>
              <p className="lp-fam__did">{row.did}</p>
              {row.next ? (
                <>
                  <p className="lp-fam__next">{row.next}</p>
                  <div
                    className="lp-bar"
                    style={{ ['--before' as string]: row.before, ['--now' as string]: row.before + (row.now - row.before) * fill }}
                  >
                    <span className="lp-bar__fill" />
                    <span className="lp-bar__tick" />
                  </div>
                </>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="lp-week">
          <p className="lp-week__title">{f.weekTitle}</p>
          <p>{f.week}</p>
        </div>
      </div>
    </div>
  );
}

export function StoryScreen({ chapter, p }: { chapter: number; p: number }) {
  if (chapter <= 0) return <RecordingScreen p={p} />;
  if (chapter === 1) return <TranscriptScreen t={p * TRANSCRIPT_SECONDS} />;
  if (chapter === 2) return <RiskScreen p={p} />;
  if (chapter === 3) return <PracticeRevealScreen p={p} />;
  return <FamilyScreen p={p} />;
}

// ---------------------------------------------------------------- Shield and the close

export function ShieldScreen({ p }: { p: number }) {
  const s = shield.screen;
  const banner = range(p, 0.1, 0.3);
  return (
    <div className="lp-scr lp-scr--incall lp-scr--shield">
      <StatusBar />
      <div
        className="lp-shieldbanner"
        style={{ opacity: banner, transform: `translateY(${(-24 * (1 - banner)).toFixed(1)}px)` }}
      >
        <span className="lp-shieldbanner__app">
          <ShieldCheck size={18} {...ICON} aria-hidden="true" />
          {s.banner}
        </span>
        <p>{s.warning}</p>
      </div>
      <div className="lp-scr__head lp-scr__head--low">
        <Avatar label="?" />
        <p className="lp-scr__name">{s.caller}</p>
        <p className="lp-scr__sub lp-tnum">{s.time}</p>
        <span className="lp-riskdot" aria-hidden="true" />
      </div>
      <div className="lp-scr__actions lp-scr__actions--stack">
        <span className="lp-pillbtn lp-pillbtn--scam" aria-hidden="true">
          <PhoneOff size={20} {...ICON} />
          {s.hangUp}
        </span>
        <span className="lp-pillbtn lp-pillbtn--outline" aria-hidden="true">
          <Hand size={20} {...ICON} />
          {s.wrong}
        </span>
      </div>
    </div>
  );
}

export function LockScreen({ shown }: { shown: boolean }) {
  const l = shield.lock;
  return (
    <div className="lp-scr lp-scr--lock">
      <StatusBar time="" />
      <div className="lp-lock">
        <p className="lp-lock__date">{l.date}</p>
        <p className="lp-lock__time lp-tnum">{l.time}</p>
      </div>
      <div className={`lp-notify lp-notify--lock${shown ? ' is-in' : ''}`}>
        <span className="lp-notify__app">
          <ShieldCheck size={16} {...ICON} aria-hidden="true" />
          {l.app}
          <span className="lp-notify__when">{l.when}</span>
        </span>
        <p>{l.text}</p>
      </div>
    </div>
  );
}

export function MumScreen() {
  return <IncomingScreen name={close.phone.name} sub={close.phone.sub} tone="safe" />;
}
