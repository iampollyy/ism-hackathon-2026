import { Check, CircleAlert, LoaderCircle, Phone, ShieldCheck } from 'lucide-react';
import { Button } from '../../../components/atoms/Button';
import { Card } from '../../../components/atoms/Card';
import { TacticBadge } from '../../../components/molecules/TacticBadge';
import { OUTCOME_LABELS, SAFE_OUTCOMES, TACTIC_LABELS } from '../../../api/types';
import type { RevealView } from '../phoneState';

type RevealScreenProps = {
  view: RevealView;
  familyNumber: boolean;
  onCallFamily: () => void;
  onDone: () => void;
};

/** Fixed words, never the agent's: the reveal must not depend on the call. */
export function revealWords(voiceOf: string | null, kind: RevealView['kind'] = 'practice'): string {
  const voice = voiceOf
    ? `The voice you heard was artificial, made with ${voiceOf}'s permission.`
    : 'The voice you heard was artificial, from a voice library.';
  return kind === 'shield'
    ? `This was a simulated scam call, to show how Callback Shield protects you. ${voice}`
    : `This was a Callback practice call. ${voice}`;
}

export const HABIT_LINE = 'Next time, hang up and call back on a number you already know, or ask for the family word.';

/** The practice line is answered by an AI helper: say so before the tap. */
export const PRACTICE_LINE_NOTE = 'A Callback helper answers and lets your family know you called back. It isn’t a real person.';

export function RevealScreen({ view, familyNumber, onCallFamily, onDone }: RevealScreenProps) {
  const { result } = view;
  const safe = result ? SAFE_OUTCOMES.includes(result.outcome) : false;

  return (
    <main className="phone-screen phone-light phone-reveal">
      <span className="phone-reveal__badge">
        <ShieldCheck size={18} aria-hidden="true" />
        {view.kind === 'shield' ? 'Shield demo call' : 'Practice call'}
      </span>

      <p className="phone-reveal__words">{revealWords(view.voiceOf, view.kind)}</p>
      {view.endedBy === 'error' && <p className="phone-reveal__note">The line dropped before the call could finish.</p>}

      <Card className="phone-habit">
        <span className="phone-habit__label">The habit</span>
        <p>{HABIT_LINE}</p>
      </Card>

      {view.scoring === 'waiting' && (
        <Card className="phone-result phone-result--loading">
          <LoaderCircle className="phone-spin" size={20} aria-hidden="true" />
          <p>Getting your lesson…</p>
        </Card>
      )}

      {view.scoring === 'done' && result && (
        <Card className={`phone-result ${safe ? 'phone-result--safe' : 'phone-result--warn'}`}>
          <span className="phone-result__label">What you did</span>
          <span className={`phone-outcome ${safe ? 'phone-outcome--safe' : 'phone-outcome--warn'}`}>
            {safe ? <Check size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
            {OUTCOME_LABELS[result.outcome]}
          </span>
          <p className="phone-result__lesson">{result.lesson}</p>
          {result.tactics_used.length > 0 && (
            <div className="phone-result__tactics">
              <span className="phone-result__label">What the caller tried</span>
              <div className="phone-result__chips">
                {result.tactics_used.map((key) => (
                  <TacticBadge key={key} label={TACTIC_LABELS[key]} active />
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="phone-reveal__actions">
        {familyNumber && (
          <button
            type="button"
            className="phone-big-button phone-big-button--green"
            onClick={onCallFamily}
            disabled={!view.endSent || view.startingFamilyLine}
          >
            {view.startingFamilyLine ? (
              <LoaderCircle className="phone-spin" size={24} aria-hidden="true" />
            ) : (
              <Phone size={24} aria-hidden="true" />
            )}
            {view.startingFamilyLine ? 'Calling…' : 'Practise calling back'}
          </button>
        )}
        {familyNumber && <p className="phone-reveal__hint">{PRACTICE_LINE_NOTE}</p>}
        {view.familyLineError && (
          <p className="phone-inline-error" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            {view.familyLineError}
          </p>
        )}
        <Button variant="secondary" className="phone-done" onClick={onDone} disabled={view.startingFamilyLine}>
          Done
        </Button>
      </div>
    </main>
  );
}
