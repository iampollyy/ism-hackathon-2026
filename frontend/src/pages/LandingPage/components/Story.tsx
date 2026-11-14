// Section 4: how Callback works. One practice call in five chapters; the phone stays
// put (sticky) while the chapters scroll past, and its screen follows them.
import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SIGNUP, story } from '../copy';
import { useLp } from '../store';
import { Phone, type Rings } from './Phone';
import { StoryScreen, TRANSCRIPT_SECONDS, riskAt } from './screens';

const CHIPS = story.transcript.filter((l) => l.chip) as { chip: string; chipAt: number }[];
// Until the transcript lines can be measured: slots as a share of the phone's height.
const SLOTS = [0.2, 0.34, 0.48, 0.62, 0.76];
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Tactic chips fly in on the transcript's timings, in the DOM beside the phone (both modes). */
function Chips({ chapter, p, reduced }: { chapter: number; p: number; reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(300);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 300));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Each chip sits level with the transcript line it names (measured on the CSS phone,
  // which stays laid out under the 3D phone too).
  const [slots, setSlots] = useState<(number | null)[]>(() => CHIPS.map(() => null));
  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (!box || chapter !== 1) return;
    const top = box.getBoundingClientRect().top;
    const lines = Array.from(box.querySelectorAll<HTMLElement>('.lp-phone--story .lp-tline[data-chip]'));
    setSlots((prev) => {
      const next = CHIPS.map((c, i) => {
        const el = lines.find((l) => l.dataset.chip === c.chip);
        if (!el) return prev[i];
        const r = el.getBoundingClientRect();
        return Math.round(r.top + r.height / 2 - top);
      });
      return next.some((v, i) => v !== prev[i]) ? next : prev;
    });
  }, [chapter, p, w]);
  const t = chapter === 1 ? p * TRANSCRIPT_SECONDS : chapter > 1 ? 99 : -1;
  // In the reveal chapter they leave to the right during the turn.
  const out = chapter === 3 ? clamp01(p / 0.14) : chapter > 3 ? 1 : 0;
  const dim = chapter === 2;
  return (
    <div className="lp-chips" ref={ref} aria-hidden="true">
      {CHIPS.map((c, i) => {
        let qv = reduced ? 1 : easeOutCubic(clamp01((t - c.chipAt) / 0.8));
        if (chapter < 1) qv = 0;
        // A quadratic path from the right of the phone, up and over, to its slot on the left.
        const x0 = w + 180;
        const y0 = -40;
        const cx = w * 0.5;
        const cy = -160 - i * 10;
        const a = 1 - qv;
        let x = a * a * x0 + 2 * a * qv * cx;
        let y = a * a * y0 + 2 * a * qv * cy;
        let o = qv;
        if (out > 0) {
          x += easeOutCubic(out) * (w + 260);
          y -= easeOutCubic(out) * 30;
          o *= 1 - out;
        }
        return (
          <span
            key={c.chip}
            className={`lp-chip${dim ? ' is-dim' : ''}`}
            style={{
              top: slots[i] !== null ? `${slots[i]}px` : `${SLOTS[i] * 100}%`,
              opacity: o,
              transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(0.85 + 0.15 * qv).toFixed(3)})`,
            }}
          >
            {c.chip}
          </span>
        );
      })}
    </div>
  );
}

function ringsFor(chapter: number, p: number): Rings {
  if (chapter === 3 && p >= 0.7) return 'safe';
  if (chapter === 1 && p < 0.08) return 'scam';
  return 'off';
}

function StickyPhone({ chapter, p, reduced }: { chapter: number; p: number; reduced: boolean }) {
  const risk = chapter === 2 ? riskAt(p).level : chapter === 1 ? 'scam' : chapter >= 3 ? 'safe' : 'calm';
  return (
    <div className="lp-story__phonebox" data-risk={risk}>
      <span className="lp-story__glow" aria-hidden="true" />
      <Chips chapter={chapter} p={p} reduced={reduced} />
      <Phone anchor="story" rings={ringsFor(chapter, p)} className="lp-phone--story">
        <StoryScreen chapter={chapter} p={p} />
      </Phone>
    </div>
  );
}

function ChapterText({ i }: { i: number }) {
  const c = story.chapters[i];
  return (
    <>
      <h3 className="lp-h3">{c.h3}</h3>
      <p className="lp-body">{c.body}</p>
      {'small' in c && c.small ? <p className="lp-small lp-muted">{c.small}</p> : null}
      {i === 4 ? (
        <Link to={SIGNUP} className="lp-btn lp-btn--light lp-story__cta">
          {story.cta}
        </Link>
      ) : null}
    </>
  );
}

export function Story() {
  const chapter = useLp((s) => s.chapter);
  const p = useLp((s) => s.chapterP);
  const reduced = useLp((s) => s.reducedMotion);
  const rootRef = useRef<HTMLDivElement>(null);

  const go = (i: number) => {
    const el = rootRef.current?.querySelectorAll<HTMLElement>('[data-chapter]')[i];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.5 + 60;
    window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <section id="how" className="lp-sec lp-story" aria-labelledby="how-h" data-theme="dark" data-chapter-now={chapter}>
      <div className="lp-wrap">
        <div className="lp-story__head">
          <h2 id="how-h" className="lp-h2">
            {story.h2}
          </h2>
          <p className="lp-lead">{story.intro}</p>
        </div>

        {reduced ? (
          <div className="lp-story__static">
            {story.chapters.map((_, i) => (
              <article key={i} className="lp-story__row" aria-labelledby={`ch-${i}`}>
                <div className="lp-story__rowtext" id={`ch-${i}`}>
                  <ChapterText i={i} />
                </div>
                <div className="lp-story__rowphone">
                  <Phone className="lp-phone--story" rings={i === 3 ? 'safe' : 'off'}>
                    <StoryScreen chapter={i} p={i === 3 ? 0.6 : 1} />
                  </Phone>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="lp-story__grid" ref={rootRef}>
            <nav className="lp-rail" aria-label="Chapters">
              <ol>
                {story.rail.map((label, i) => (
                  <li key={label}>
                    <button
                      type="button"
                      className={chapter === i ? 'is-on' : ''}
                      aria-current={chapter === i ? 'step' : undefined}
                      onClick={() => go(i)}
                    >
                      <span className="lp-rail__bar" aria-hidden="true">
                        <i style={{ transform: `scaleY(${chapter > i ? 1 : chapter === i ? p : 0})` }} />
                      </span>
                      {label}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="lp-chapters">
              {story.chapters.map((_, i) => (
                <article key={i} className={`lp-chapter${chapter === i ? ' is-on' : ''}`} data-chapter={i}>
                  <div className="lp-chapter__panel">
                    <ChapterText i={i} />
                  </div>
                </article>
              ))}
            </div>
            <div className="lp-story__stick">
              <div className="lp-story__sticky">
                <div className="lp-story__progress" aria-hidden="true">
                  <i style={{ transform: `scaleX(${(chapter + p) / 5})` }} />
                </div>
                <StickyPhone chapter={chapter} p={p} reduced={reduced} />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
