// Section 5: Callback Shield. A red warning drops onto Rasa's screen while a second
// phone, Lukas's, rises with the family alert.
import { BellRing, Hand, ShieldCheck } from 'lucide-react';
import { shield } from '../copy';
import { useLp } from '../store';
import { Phone } from './Phone';
import { LockScreen, ShieldScreen } from './screens';

const ICONS = { shield: ShieldCheck, bell: BellRing, hand: Hand } as const;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (x: number) => 1 - (1 - x) ** 3;

export function Shield() {
  const raw = useLp((s) => s.shieldP);
  const reduced = useLp((s) => s.reducedMotion);
  const p = reduced ? 1 : raw;
  const rise = ease(clamp01((p - 0.3) / 0.3));
  return (
    <section id="shield" className="lp-sec lp-shield" aria-labelledby="shield-h" data-theme="dark">
      <div className="lp-wrap lp-split">
        <div className="lp-split__copy">
          <h2 id="shield-h" className="lp-h2">
            {shield.h2}
          </h2>
          <p className="lp-lead">{shield.lead}</p>
          <ul className="lp-points">
            {shield.points.map((pt) => {
              const Icon = ICONS[pt.icon as keyof typeof ICONS];
              return (
                <li key={pt.icon}>
                  <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
                  <span>{pt.text}</span>
                </li>
              );
            })}
          </ul>
          <p className="lp-small lp-muted">{shield.note}</p>
        </div>
        <div className="lp-split__object lp-shield__object">
          <span className="lp-shield__glow" aria-hidden="true" />
          <Phone anchor="shield" className="lp-phone--shield" rings="off">
            <ShieldScreen p={Math.max(p, reduced ? 1 : 0)} />
          </Phone>
          <div
            className="lp-shield__second"
            style={{ transform: `translateY(${((1 - rise) * 60).toFixed(1)}px)`, opacity: rise }}
          >
            <Phone className="lp-phone--small" rings="off">
              <LockScreen shown={p >= 0.55} />
            </Phone>
          </div>
        </div>
      </div>
    </section>
  );
}
