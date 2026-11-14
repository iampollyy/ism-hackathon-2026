import { useCallback, useEffect, useState } from 'react';
import { Clock3, KeyRound, LoaderCircle, LockKeyhole, PhoneCall, RotateCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../../../api/client';
import type { Habits, LearnTactics } from '../../../api/types';
import { plainError } from '../usePhone';

type Learn = { habits: Habits['habits']; tactics: LearnTactics['tactics'] };

// The content changes only with a deploy: one fetch per visit is enough.
let cached: Learn | null = null;

const HABIT_ICONS: Record<string, LucideIcon> = {
  hang_up_and_call_back: PhoneCall,
  ask_for_the_family_word: KeyRound,
  never_share_codes: LockKeyhole,
  take_your_time: Clock3,
};

/** How many warning signs show before "Show all". */
const FIRST_SIGNS = 4;

export function LearnTab() {
  const [learn, setLearn] = useState<Learn | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.habits(), api.tactics()]).then(
      ([habits, tactics]) => {
        cached = { habits: habits.habits, tactics: tactics.tactics };
        setLearn(cached);
      },
      (failure: unknown) => setError(plainError(failure, 'This could not be loaded. Please try again.')),
    );
  }, []);

  useEffect(() => {
    if (!cached) load();
  }, [load]);

  if (error) {
    return (
      <div className="phone-tab-state" role="alert">
        <p>{error}</p>
        <button type="button" className="phone-quiet-button" onClick={load}>
          <RotateCw size={18} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }
  if (!learn) {
    return (
      <div className="phone-tab-state" aria-busy="true">
        <LoaderCircle className="phone-spin" size={22} aria-hidden="true" />
        <p>Loading…</p>
      </div>
    );
  }

  const signs = showAll ? learn.tactics : learn.tactics.slice(0, FIRST_SIGNS);

  return (
    <div className="phone-learn">
      <section aria-labelledby="learn-habits">
        <h2 className="phone-section-title" id="learn-habits">
          Four habits that beat voice scams
        </h2>
        <ul className="phone-habits">
          {learn.habits.map((habit) => {
            const Icon = HABIT_ICONS[habit.key] ?? PhoneCall;
            return (
              <li key={habit.key}>
                <span className="phone-habits__icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <div>
                  <h3>{habit.title}</h3>
                  <p>{habit.line}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="learn-signs">
        <h2 className="phone-section-title" id="learn-signs">
          What a scam call sounds like
        </h2>
        <p className="phone-section-text">
          Callers use the same few tricks again and again. Once you know them, they are easier to hear.
        </p>
        <div className="phone-signs">
          {signs.map((sign) => (
            <article key={sign.key} className={`phone-sign phone-sign--${sign.level}`}>
              <header className="phone-sign__head">
                <h3>{sign.label}</h3>
                <span className="phone-sign__level">{sign.level === 'red' ? 'Red flag' : 'Warning sign'}</span>
              </header>
              <blockquote className="phone-sign__quote">“{sign.what_it_sounds_like[0]}”</blockquote>
              <p className="phone-sign__do">
                <strong>What to do: </strong>
                {sign.what_to_do}
              </p>
              <details className="phone-sign__why">
                <summary>Why it works</summary>
                <p>{sign.why_it_works}</p>
              </details>
            </article>
          ))}
        </div>
        {!showAll && learn.tactics.length > FIRST_SIGNS && (
          <button type="button" className="phone-quiet-button phone-quiet-button--wide" onClick={() => setShowAll(true)}>
            Show all {learn.tactics.length} signs
          </button>
        )}
      </section>
    </div>
  );
}
