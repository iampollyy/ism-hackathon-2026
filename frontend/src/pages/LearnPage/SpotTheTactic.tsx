// "Spot the tactic": a caller line from the learning content, three labels
// to choose from, and feedback made only of the content's own words (why it
// works, what to do). Kind either way: a miss is "not quite", never wrong.

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Lightbulb, Phone, RotateCcw, ShieldCheck } from 'lucide-react';
import { scrollBehaviour, shuffle, type Habit, type LearnTactic } from './shared';

const ROUND_LENGTH = 5;
const CHOICES = 3;

type Question = { line: string; answer: LearnTactic; options: LearnTactic[] };

// Pairs whose example lines a fair reader could file under either (a "send it
// to my friend's account" is also asking for money; "don't ring the bank" is
// also stopping a call-back). They never stand side by side in one question,
// so a sensible pick is never marked "not quite". Every tactic still keeps at
// least two others to choose from.
const CLOSE_PAIRS: readonly [string, string][] = [
  ['money_request', 'unusual_payment'],
  ['money_request', 'urgency'],
  ['secrecy', 'isolation'],
  ['secrecy', 'urgency'],
  ['isolation', 'refuses_callback'],
  ['asks_for_code', 'small_ask_first'],
  ['asks_for_code', 'unusual_payment'],
  ['urgency', 'refuses_callback'],
  ['emotional_appeal', 'refuses_callback'],
];

/** True when any part of the element is outside the window. */
function isOffScreen(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return box.top < 0 || box.bottom > window.innerHeight;
}

function areClose(a: string, b: string): boolean {
  return CLOSE_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function makeRound(tactics: LearnTactic[]): Question[] {
  const usable = tactics.filter((tactic) => tactic.what_it_sounds_like.length > 0);
  return shuffle(usable)
    .slice(0, ROUND_LENGTH)
    .map((answer) => {
      const lines = answer.what_it_sounds_like;
      const fair = tactics.filter((tactic) => tactic.key !== answer.key && !areClose(tactic.key, answer.key));
      const pool = fair.length >= CHOICES - 1 ? fair : tactics.filter((tactic) => tactic.key !== answer.key);
      const others = shuffle(pool).slice(0, CHOICES - 1);
      return {
        line: lines[Math.floor(Math.random() * lines.length)],
        answer,
        options: shuffle([answer, ...others]),
      };
    });
}

type SpotTheTacticProps = {
  tactics: LearnTactic[];
  habits: Habit[];
};

export function SpotTheTactic({ tactics, habits }: SpotTheTacticProps) {
  const [round, setRound] = useState<Question[]>(() => makeRound(tactics));
  const [index, setIndex] = useState(0);
  const [picks, setPicks] = useState<(string | null)[]>(() => Array(ROUND_LENGTH).fill(null));
  const sectionRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const callRef = useRef<HTMLElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const finished = index >= round.length;
  const question = finished ? null : round[index];
  const picked = finished ? null : picks[index];
  const spotted = picks.filter((pick, i) => round[i] && pick === round[i].answer.key).length;

  // After a pick, the way forward gets the focus (the feedback is read out by
  // aria-live), and on a small screen the feedback scrolls up into sight.
  useEffect(() => {
    if (!picked) return;
    nextRef.current?.focus({ preventScroll: true });
    feedbackRef.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehaviour() });
  }, [picked]);
  // The score replaces the taller feedback, so the page gets shorter: bring
  // the quiz back into view if the score ended up off screen.
  useEffect(() => {
    if (!finished) return;
    startRef.current?.focus({ preventScroll: true });
    if (doneRef.current && isOffScreen(doneRef.current)) {
      sectionRef.current?.scrollIntoView({ block: 'start', behavior: scrollBehaviour() });
    }
  }, [finished]);
  // Moving on to a new line puts the focus on it, so it is read out next, and
  // brings the quiz back into view: the feedback that was just removed may
  // have left the new line above the screen.
  useEffect(() => {
    if (!moved.current || !callRef.current) return;
    callRef.current.focus({ preventScroll: true });
    if (isOffScreen(callRef.current)) {
      sectionRef.current?.scrollIntoView({ block: 'start', behavior: scrollBehaviour() });
    }
  }, [index, round]);

  if (tactics.length < 2 || round.length === 0) return null;

  const choose = (key: string) => {
    if (picked) return;
    setPicks((current) => current.map((value, i) => (i === index ? key : value)));
  };
  const next = () => {
    moved.current = true;
    setIndex(index + 1);
  };
  const restart = () => {
    moved.current = true;
    setRound(makeRound(tactics));
    setPicks(Array(ROUND_LENGTH).fill(null));
    setIndex(0);
  };

  const firstHabit = habits[0];
  const isSpotted = question !== null && picked === question.answer.key;

  return (
    <section className="lp-quiz" id="spot" aria-labelledby="lp-quiz-title" ref={sectionRef}>
      <div className="lp-quiz__intro">
        <h2 id="lp-quiz-title">Spot the tactic</h2>
        <p>A caller says one line. Which trick is it? {round.length} lines, no time limit, nobody sees your answers.</p>
        <ol className="lp-quiz__dots" aria-label="Progress">
          {round.map((item, i) => {
            const pick = picks[i];
            const state = pick === null ? (i === index ? 'current' : 'todo') : pick === item.answer.key ? 'spotted' : 'tip';
            const words = { current: 'this line', todo: 'still to come', spotted: 'spotted', tip: 'a tip picked up' }[state];
            return (
              <li key={i} className={`lp-quiz__dot is-${state}`}>
                <span className="lp-sr">
                  Line {i + 1}: {words}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {question ? (
        <div className="lp-quiz__play">
          <figure className="lp-call" aria-label="What the caller says" tabIndex={-1} ref={callRef}>
            <figcaption className="lp-call__who">
              <span className="lp-call__icon" aria-hidden>
                <Phone size={14} />
              </span>
              Caller · line {index + 1} of {round.length}
            </figcaption>
            <blockquote className="lp-call__line">
              <p>“{question.line}”</p>
            </blockquote>
          </figure>

          <div className="lp-quiz__answer">
            <p className="lp-quiz__ask" id="lp-quiz-ask">
              Which tactic is the caller using?
            </p>
            <div className="lp-quiz__options" role="group" aria-labelledby="lp-quiz-ask">
              {question.options.map((option) => {
                const isAnswer = option.key === question.answer.key;
                const isPick = option.key === picked;
                const mark = picked ? (isAnswer ? ' is-answer' : isPick ? ' is-pick' : ' is-other') : '';
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={`lp-option${mark}`}
                    onClick={() => choose(option.key)}
                    disabled={Boolean(picked) && !isAnswer && !isPick}
                    aria-pressed={isPick}
                  >
                    <span>{option.label}</span>
                    {picked && isAnswer ? <Check size={18} aria-hidden /> : null}
                    {picked && isPick && !isAnswer ? <span className="lp-option__note">Your pick</span> : null}
                  </button>
                );
              })}
            </div>
            {picked ? null : (
              <p className="lp-quiz__hint">Pick one. You'll see why it works on people, and what to do.</p>
            )}
          </div>

          <div className="lp-quiz__feedback" aria-live="polite">
            {picked ? (
              <div className={`lp-feedback${isSpotted ? ' is-spotted' : ''}`} ref={feedbackRef}>
                <p className="lp-feedback__title">
                  {isSpotted ? (
                    <>
                      <ShieldCheck size={18} aria-hidden /> Yes, spotted: <strong>{question.answer.label}</strong>
                    </>
                  ) : (
                    <>
                      <Lightbulb size={18} aria-hidden /> Not quite. This one is <strong>{question.answer.label}</strong>
                    </>
                  )}
                </p>
                <div className="lp-feedback__part">
                  <h3>Why it works</h3>
                  <p>{question.answer.why_it_works}</p>
                </div>
                <div className="lp-feedback__part">
                  <h3>What to do</h3>
                  <p>{question.answer.what_to_do}</p>
                </div>
                <button ref={nextRef} type="button" className="button button-primary lp-quiz__next" onClick={next}>
                  {index + 1 < round.length ? 'Next line' : 'See how it went'} <ArrowRight size={16} aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="lp-quiz__done" aria-live="polite" ref={doneRef}>
          <p className="lp-quiz__score">
            You spotted {spotted} of {round.length}.
          </p>
          <p>
            {spotted === round.length ? 'Every one. ' : 'Each one you notice is a head start. '}
            {firstHabit ? (
              <>
                On a real call, noticing is your cue for the first habit: <strong>{firstHabit.title.toLowerCase()}</strong>.
              </>
            ) : null}
          </p>
          <button ref={startRef} type="button" className="button button-secondary lp-quiz__again" onClick={restart}>
            <RotateCcw size={16} aria-hidden /> Try {round.length} more lines
          </button>
        </div>
      )}
    </section>
  );
}
