// The laptop's live call screen (/calls/:callId): the demo's big screen.
// The call and the risk light on the left; the scam's stages, what the
// person did, the family number, the result and the conversation on the right.
// Everything comes from the call's live stream, or from the call object when
// the call is opened later or the stream is not available (see useLiveCall).

import { ArrowLeft, LoaderCircle, ShieldCheck, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CallStatus, CallView } from '../../api/types';
import { CallPanel } from './CallPanel';
import { Conversation } from './Conversation';
import { possessive, useCallTitle } from './format';
import {
  agreeing, callbackWindowOver, deriveStages, FINAL_STATUSES, latestRisk, riskChanges, stoppedAt, type LiveOutcome, type LiveState,
} from './liveCallState';
import { OutcomeTiles, ResultPanel } from './Outcome';
import { StageLine } from './StageLine';
import { TrafficLight } from './TrafficLight';
import { useLiveCall } from './useLiveCall';
import './LiveCallPage.scss';

function emptyConversationText(status: CallStatus, target: string): string {
  switch (status) {
    case 'scheduled':
    case 'ringing': return `Waiting for ${target} to answer.`;
    case 'in_progress': return 'Listening. The conversation appears here as it happens.';
    case 'declined': return `${target} declined the call, so there is no conversation.`;
    case 'missed': return `${target} didn’t answer, so there is no conversation.`;
    case 'failed': return 'The call could not connect, so there is no conversation.';
    default: return 'No conversation was recorded for this call.';
  }
}

function callerName(call: CallView): string {
  if (call.kind === 'welcome') return 'Callback';
  if (call.kind === 'family_line') return 'Family line';
  return call.voice_of ? `Caller, in ${possessive(call.voice_of.name)} voice` : 'Caller';
}

export function LiveCallPage() {
  const { callId } = useParams();
  const navigate = useNavigate();
  const { state, connection, error } = useLiveCall(callId);
  const call = state.call;
  const title = useCallTitle(call?.kind, call?.scenario);

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));

  if (error || !call) {
    return (
      <div className="live-call">
        <header className="practice-header lc-header">
          <button type="button" className="header-back lc-back" onClick={back}>
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>
          <div className="header-center">
            <span className="live-kicker">Practice call</span>
            <h1>{error ? 'Call not found' : 'Loading the call…'}</h1>
          </div>
        </header>
        <div className="lc-card lc-message">
          {error ? <p>{error}</p> : <p><LoaderCircle size={18} className="lc-spin" /> Getting the call from the server…</p>}
        </div>
      </div>
    );
  }

  return <LiveCallView call={call} state={state} title={title} connection={connection} onBack={back} />;
}

type LiveCallViewProps = {
  call: CallView;
  state: LiveState;
  title: string;
  connection: ReturnType<typeof useLiveCall>['connection'];
  onBack: () => void;
};

function LiveCallView({ call, state, title, connection, onBack }: LiveCallViewProps) {
  const status: CallStatus = state.status ?? call.status;
  const target = call.target.name || 'They';
  const isPractice = call.kind === 'practice';
  const live = status === 'in_progress';
  const over = status === 'ended' || status === 'scored';
  const final = FINAL_STATUSES.includes(status);
  const answered = !!call.answered_at || live || over;

  // The phone always shows the reveal after a practice that was answered,
  // however it ended (backend.md, "Rules enforced in code", 6).
  const revealed = state.revealed || (isPractice && answered && over);
  const outcome: LiveOutcome | null = state.outcome
    ?? (state.result ? { outcome: state.result.outcome, secondsToChallenge: state.result.seconds_to_challenge, afterTurns: state.turns.length } : null);
  const stages = deriveStages(state, revealed);
  const stopped = stoppedAt(stages, outcome);

  // Polling rebuilds the screen from the call object, which has no outcome,
  // reveal or consent: those are only known from the stream (or the result).
  const fromCallObject = connection === 'polling' || (connection === 'done' && state.source === 'snapshot');

  const risk = latestRisk(state);
  const agreed = agreeing(state);
  const callerMarked = new Set<string>(state.tactics.map((tactic) => tactic.key));

  return (
    <div className={`live-call live-call--${status}`}>
      <header className="practice-header lc-header">
        <button type="button" className="header-back lc-back" onClick={onBack}>
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
        <div className="header-center">
          <span className="live-kicker">{isPractice ? (live ? 'Live practice' : 'Practice call') : `Call with ${target}`}</span>
          <h1>{title}</h1>
        </div>
        {isPractice ? (
          <div className="header-badge">
            <ShieldCheck size={15} />
            <span>Practice: it always reveals itself</span>
          </div>
        ) : <span />}
      </header>

      <div className="lc-grid">
        <div className="lc-col lc-col--left">
          <CallPanel
            call={call}
            status={status}
            endedBy={state.endedBy}
            connection={connection}
            hadConversation={state.turns.length > 0}
          />

          {isPractice && !final ? (
            <TrafficLight risk={risk} callerMarked={callerMarked} listening={live && !risk} over={over} />
          ) : null}

          {call.kind === 'welcome' ? (
            <section className={`lc-card lc-tile${state.consent === true ? ' is-safe' : ''}`}>
              <span className="small-label">Practice calls</span>
              <div className="lc-tile__value">
                {state.consent === true ? <UserRoundCheck size={22} /> : state.consent === false ? <UserRoundX size={22} /> : null}
                <strong>
                  {state.consent === true
                    ? `${target} agreed to practice calls`
                    : state.consent === false
                      ? `${target} said no to practice calls`
                      : fromCallObject ? `${possessive(target)} answer is shown on the family page` : 'Not asked yet'}
                </strong>
              </div>
            </section>
          ) : null}
        </div>

        <div className="lc-col lc-col--right">
          {isPractice && !final ? (
            <>
              <StageLine stages={stages} live={live} stopped={stopped} targetName={target} />
              <OutcomeTiles
                target={target}
                status={status}
                outcome={outcome}
                result={state.result}
                callback={state.callback}
                callbackClosed={callbackWindowOver(call.ended_at)}
                fromCallObject={fromCallObject}
              />
              <ResultPanel target={target} status={status} result={state.result} hadConversation={state.turns.length > 0} />
            </>
          ) : null}

          <Conversation
            turns={state.turns}
            tactics={state.tactics}
            lightChanges={isPractice ? riskChanges(state.risk) : new Map()}
            agreed={agreed}
            callerName={callerName(call)}
            personName={target}
            listening={live}
            emptyText={emptyConversationText(status, target)}
          />
        </div>
      </div>
    </div>
  );
}
