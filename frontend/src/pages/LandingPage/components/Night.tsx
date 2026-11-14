// Sections 2 and 3: the problem (a field of phones ringing in the dark) and the
// habit (they go dark, all but the one that called back).
import { problem, habit, SOURCES } from '../copy';
import { useLp } from '../store';
import { Phone } from './Phone';
import { CallingScreen, IncomingScreen, mulberry32 } from './screens';

const FIELD = (() => {
  const r = mulberry32(11);
  return Array.from({ length: 30 }, (_, i) => ({ i, th: r(), delay: Math.floor(r() * 6) * 400 }));
})();
const GREEN_INDEX = 14;

function Field({ ringShare, dark, green }: { ringShare: number; dark: boolean; green: boolean }) {
  return (
    <div className={`lp-field${dark ? ' is-dark' : ''}${green ? ' is-green' : ''}`} aria-hidden="true">
      {FIELD.map((f) => {
        const ringing = !dark && f.th < ringShare;
        return (
          <span
            key={f.i}
            className={`lp-field__phone${ringing ? ' is-ringing' : ''}${f.i === GREEN_INDEX ? ' is-one' : ''}`}
            style={{ ['--delay' as string]: `${f.delay}ms` }}
          >
            <i />
          </span>
        );
      })}
    </div>
  );
}

function Sup({ id }: { id: 1 | 2 }) {
  const src = SOURCES[id - 1];
  return (
    <sup className="lp-sup">
      <a href={`#src-${id}`} aria-label={`Source ${id}: ${src.label}`}>
        {id}
      </a>
    </sup>
  );
}

export function Problem() {
  const p = useLp((s) => s.problemP);
  const reduced = useLp((s) => s.reducedMotion);
  const share = reduced ? 0.25 : 0.3 + 0.4 * p;
  return (
    <section id="problem" className="lp-sec lp-problem" aria-labelledby="problem-h" data-theme="dark">
      <div className="lp-wrap lp-split">
        <div className="lp-split__copy">
          <h2 id="problem-h" className="lp-h2">
            {problem.h2}
          </h2>
          <p className="lp-lead">{problem.body}</p>
          <ul className="lp-facts">
            {problem.facts.map((f) => (
              <li key={f.num} className="lp-fact">
                {f.pre}
                <span className="lp-fact__num">{f.num}</span>
                {f.post}
                <Sup id={f.source as 1 | 2} />
              </li>
            ))}
          </ul>
        </div>
        <div className="lp-split__object lp-fieldwrap">
          <Field ringShare={share} dark={false} green={false} />
          <Phone anchor="problem" className="lp-phone--field" rings="off">
            <IncomingScreen />
          </Phone>
        </div>
      </div>
    </section>
  );
}

export function Habit() {
  const p = useLp((s) => s.habitP);
  const reduced = useLp((s) => s.reducedMotion);
  const lit = reduced || p > 0.3;
  return (
    <section id="habit" className="lp-sec lp-habit" aria-labelledby="habit-h" data-theme="dark">
      <div className="lp-wrap lp-split">
        <div className="lp-split__copy">
          <h2 id="habit-h" className="lp-h2">
            {habit.h2}
          </h2>
          <p className="lp-statement" aria-label={`${habit.a} ${habit.b}`}>
            <span>{habit.a}</span> <span className="lp-safe">{habit.b}</span>
          </p>
          <p className="lp-or">{habit.or}</p>
          <p className="lp-body">{habit.body}</p>
        </div>
        <div className="lp-split__object lp-fieldwrap">
          <Field ringShare={0.7} dark={lit} green={lit} />
          <Phone anchor="habit" className="lp-phone--habit" rings={lit ? 'safe' : 'off'}>
            {lit ? <CallingScreen name="Son" timer={0} connected={false} /> : <IncomingScreen />}
          </Phone>
        </div>
      </div>
    </section>
  );
}
