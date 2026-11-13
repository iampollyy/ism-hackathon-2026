import { useEffect, useRef } from 'react';
import { CheckCheck, MessageSquareText } from 'lucide-react';
import type { RiskPointView } from '../../api/types';
import { clock } from './format';
import type { LiveTactic, LiveTurn } from './liveCallState';

type ConversationProps = {
  turns: LiveTurn[];
  tactics: LiveTactic[];
  /** Caller lines where the risk light went up a colour. */
  lightChanges: Map<number, RiskPointView>;
  /** Tactics the risk check heard too. */
  agreed: Set<string>;
  callerName: string;
  personName: string;
  listening: boolean;
  emptyText: string;
};

const LEVEL_WORDS = { green: 'green', yellow: 'yellow', red: 'red' } as const;

/** The conversation, line by line, with each tactic popping in on the caller line it belongs to. */
export function Conversation({
  turns, tactics, lightChanges, agreed, callerName, personName, listening, emptyText,
}: ConversationProps) {
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow the newest line, unless someone scrolled up to read.
  useEffect(() => {
    const el = body.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns.length, tactics.length, lightChanges.size]);

  const onScroll = () => {
    const el = body.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <section className="live-transcript lc-conversation" aria-label="Conversation">
      <div className="transcript-header">
        <div className="transcript-title-wrap">
          <MessageSquareText size={17} />
          <span>Conversation</span>
        </div>
        {listening ? (
          <div className="listening-pill">
            <span className="pulse-dot" />
            <span>Live</span>
          </div>
        ) : null}
      </div>

      <div className="transcript-body lc-conversation__body" ref={body} onScroll={onScroll} aria-live="polite">
        {turns.length === 0 ? <p className="lc-empty">{emptyText}</p> : null}
        {turns.map((turn, index) => {
          const isCaller = turn.speaker === 'agent';
          const chips = tactics.filter((tactic) => tactic.turnIndex === index);
          const change = lightChanges.get(index);
          return (
            <div key={index} className={`transcript-row lc-turn ${isCaller ? 'is-caller' : 'is-person'}`}>
              <div className="row-header">
                <div className="speaker-badge">{isCaller ? callerName : personName}</div>
                {turn.t !== null ? <time>{clock(turn.t)}</time> : null}
              </div>
              <p>{turn.text}</p>
              {chips.length || change ? (
                <div className="lc-turn__marks">
                  {chips.map((tactic, chipIndex) => (
                    <span
                      key={`${tactic.key}-${chipIndex}`}
                      className={`tag-chip lc-tactic${agreed.has(tactic.key) ? ' is-agreed' : ''}`}
                      title={agreed.has(tactic.key) ? 'The risk check heard this too' : 'Tactic marked by the caller'}
                    >
                      {agreed.has(tactic.key) ? <CheckCheck size={13} aria-hidden /> : null}
                      {tactic.label}
                    </span>
                  ))}
                  {change ? (
                    <span className={`lc-turn__light lc-turn__light--${change.level}`}>
                      <span className="lc-turn__light-dot" aria-hidden />
                      Light turned {LEVEL_WORDS[change.level]}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
