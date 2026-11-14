import { CircleCheck, Hourglass, Lightbulb, LoaderCircle, PhoneForwarded, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { CallStatus, Outcome as OutcomeKey, Tactic } from '../../api/types';
import { OUTCOME_LABELS, TACTIC_LABELS } from '../../api/types';
import { duration } from './format';
import { isSafe, type LiveOutcome, type LiveResult } from './liveCallState';

// ---------------------------------------------------------------- what the person did

function outcomeDetail(outcome: OutcomeKey, seconds: number | null): string {
  switch (outcome) {
    case 'asked_safe_word':
    case 'asked_personal_question':
      return seconds !== null ? `Checked after ${duration(seconds)}` : 'Checked who was calling';
    case 'hung_up':
      return seconds !== null ? `Hung up after ${duration(seconds)}` : 'Ended the call';
    case 'hesitated':
      return 'Wasn’t sure, but didn’t check who was calling';
    case 'agreed':
      return 'Went along with the caller. The lesson shows what to try next time.';
    default:
      return '';
  }
}

type OutcomeTilesProps = {
  target: string;
  status: CallStatus;
  outcome: LiveOutcome | null;
  result: LiveResult | null;
  callback: { seconds: number | null } | null;
  /** Ten minutes have passed since the call ended, so the family number can no longer be tapped for it. */
  callbackClosed: boolean;
};

/** "What Sara did" and "Family number", side by side. */
export function OutcomeTiles({ target, status, outcome, result, callback, callbackClosed }: OutcomeTilesProps) {
  const done = result?.outcome ?? outcome?.outcome ?? null;
  const seconds = result?.seconds_to_challenge ?? outcome?.secondsToChallenge ?? null;
  const safe = isSafe(done);
  const over = status === 'ended' || status === 'scored';

  let didText: string;
  let didDetail: string | null = null;
  if (done) {
    didText = OUTCOME_LABELS[done];
    didDetail = outcomeDetail(done, seconds);
  } else if (status === 'in_progress') {
    didText = 'Listening…';
    didDetail = `This turns green when ${target} checks who is calling or hangs up.`;
  } else if (status === 'ended') {
    didText = 'Working it out…';
  } else if (status === 'scored') {
    didText = 'No result';
    didDetail = 'There was nothing to score for this call.';
  } else {
    didText = 'Not yet';
    didDetail = 'The call hasn’t started.';
  }

  let lineText: string;
  let lineDetail: string | null = null;
  let lineState: 'done' | 'waiting' | 'idle' = 'idle';
  if (callback) {
    lineState = 'done';
    lineText = `${target} called the family number`;
    lineDetail = callback.seconds !== null ? `${duration(callback.seconds)} after the reveal.` : null;
  } else if (over && !callbackClosed) {
    lineState = 'waiting';
    lineText = `Waiting for ${target} to call the family number`;
    lineDetail = 'The reveal on the phone offers a button for it.';
  } else if (over) {
    lineText = `${target} didn’t call the family number this time`;
  } else {
    lineText = 'Not yet';
    lineDetail = `After the reveal, ${target} can tap “Call the family number”.`;
  }

  return (
    <div className="lc-tiles">
      <section className={`lc-card lc-tile${done ? (safe ? ' is-safe' : ' is-unsafe') : ''}`} aria-live="polite">
        <span className="small-label">What {target} did</span>
        <div className="lc-tile__value" key={done ?? 'none'}>
          {done ? (safe ? <ShieldCheck size={22} /> : <Lightbulb size={22} />) : status === 'ended' ? <LoaderCircle size={20} className="lc-spin" /> : null}
          <strong>{didText}</strong>
        </div>
        {didDetail ? <p className="lc-tile__detail">{didDetail}</p> : null}
      </section>

      <section className={`lc-card lc-tile lc-tile--line is-${lineState}`} aria-live="polite">
        <span className="small-label">Family number</span>
        <div className="lc-tile__value" key={lineState}>
          {lineState === 'done' ? <PhoneForwarded size={22} /> : lineState === 'waiting' ? <Hourglass size={20} /> : null}
          <strong>{lineText}</strong>
        </div>
        {lineDetail ? <p className="lc-tile__detail">{lineDetail}</p> : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- the result

/** "3 tactics used, none worked on Sara." */
function tacticsSummary(used: number, worked: number, target: string): string {
  if (!used) return 'The caller marked no tactics.';
  const usedText = used === 1 ? '1 tactic used' : `${used} tactics used`;
  const workedText = worked === 0 ? 'none' : worked === used && used > 1 ? 'all' : String(worked);
  return `${usedText}, ${workedText} worked on ${target}.`;
}

type ResultPanelProps = {
  target: string;
  status: CallStatus;
  result: LiveResult | null;
  hadConversation: boolean;
};

/** After scoring: the lesson, the debrief, and the tactics used against those that worked. */
export function ResultPanel({ target, status, result, hadConversation }: ResultPanelProps) {
  if (status === 'ended') {
    return (
      <section className="lc-card lc-result lc-result--pending">
        <LoaderCircle size={18} className="lc-spin" />
        <span>Working out the lesson from the conversation…</span>
      </section>
    );
  }
  if (status !== 'scored') return null;
  if (!result) {
    return (
      <section className="lc-card lc-result lc-result--empty">
        <span className="small-label">Result</span>
        <p>
          {hadConversation
            ? 'This call has no result.'
            : 'There is no result for this call: the voice didn’t connect, so there was no conversation to learn from.'}
        </p>
      </section>
    );
  }

  const worked = new Set<Tactic>(result.tactics_worked);
  const safe = isSafe(result.outcome);
  return (
    <section className={`lc-card lc-result${safe ? ' is-safe' : ''}`} aria-label="Result">
      <div className="lc-result__head">
        <span className="small-label">Result</span>
        <span className={`status-pill ${safe ? 'good' : 'warn'}`}>{OUTCOME_LABELS[result.outcome]}</span>
      </div>

      {result.lesson ? (
        <div className="lesson-box lc-result__lesson">
          <div className="lesson-label">Lesson</div>
          <p>{result.lesson}</p>
        </div>
      ) : null}

      {result.debrief ? <p className="lc-result__debrief">{result.debrief}</p> : null}

      <div className="lc-result__tactics">
        <span className="lc-result__tactics-title">
          {tacticsSummary(result.tactics_used.length, result.tactics_worked.length, target)}
        </span>
        {result.tactics_used.length ? (
          <div className="lc-result__chips">
            {result.tactics_used.map((key) => (
              <span key={key} className={`lc-used${worked.has(key) ? ' is-worked' : ''}`}>
                {worked.has(key) ? <TriangleAlert size={13} aria-hidden /> : <CircleCheck size={13} aria-hidden />}
                {TACTIC_LABELS[key]}
                <small>{worked.has(key) ? 'worked' : 'didn’t work'}</small>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
