import { Hourglass, KeyRound, LockKeyhole, PhoneForwarded, Printer, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { numberWord, type Habit } from './shared';

// An icon per known habit; a habit added later still shows, with the shield.
const ICONS: Record<string, LucideIcon> = {
  hang_up_and_call_back: PhoneForwarded,
  ask_for_the_family_word: KeyRound,
  never_share_codes: LockKeyhole,
  take_your_time: Hourglass,
};

type HabitsBandProps = {
  habits: Habit[];
  familyName: string | null;
};

/** The core habits, in the API's order: the first one leads, the rest follow. */
export function HabitsBand({ habits, familyName }: HabitsBandProps) {
  const [first, ...rest] = habits;
  if (!first) return null;
  const FirstIcon = ICONS[first.key] ?? ShieldCheck;

  return (
    <section className="lp-habits" id="habits" aria-labelledby="lp-habits-title">
      <div className="lp-habits__head">
        <h2 id="lp-habits-title">
          {habits.length === 1 ? 'The habit' : `The ${numberWord(habits.length)} habits`} that beat a copied voice
        </h2>
        <p className="lp-habits__print-note">{familyName ? `${familyName} · ` : ''}Keep this by the phone.</p>
        <button type="button" className="lp-habits__print" onClick={() => window.print()}>
          <Printer size={16} aria-hidden /> Print for by the phone
        </button>
      </div>

      <div className="lp-habits__grid">
        <article className="lp-habit lp-habit--lead">
          <span className="lp-habit__icon" aria-hidden>
            <FirstIcon size={26} />
          </span>
          <h3>{first.title}</h3>
          <p>{first.line}</p>
        </article>
        <ol className="lp-habits__rest" start={2}>
          {rest.map((habit) => {
            const Icon = ICONS[habit.key] ?? ShieldCheck;
            return (
              <li key={habit.key} className="lp-habit">
                <span className="lp-habit__icon" aria-hidden>
                  <Icon size={20} />
                </span>
                <div>
                  <h3>{habit.title}</h3>
                  <p>{habit.line}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
