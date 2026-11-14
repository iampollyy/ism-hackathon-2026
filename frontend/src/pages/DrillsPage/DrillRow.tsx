// One drill in a list: who, the story and the voice, what they did, the
// highest the risk light went, the tactics and the lesson. The whole row opens
// the replay (/calls/{call_id}).

import { Link } from 'react-router-dom';
import {
  BellRing, ChevronRight, CircleDashed, Hourglass, Lightbulb, LoaderCircle, PhoneForwarded, PhoneOff, ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { TacticBadge } from '../../components/molecules/TacticBadge';
import { PersonAvatar, RiskLamp } from './ReviewParts';
import type { ShieldInfo } from './useShieldCalls';
import {
  DIFFICULTY_WORDS, drillOutcomeWords, drillState, secondsWords, voiceWords, whenWords, type DrillView,
} from './reviewWords';

type DrillRowProps = {
  drill: DrillView;
  /** The person's place in the family, for their avatar colour. */
  colorIndex: number;
  relationship?: string;
  /** Leave out the person (on that person's own page). */
  showWho?: boolean;
  /** Leave out the lesson (where the lessons are listed on their own). */
  showLesson?: boolean;
  /** Set when this drill was a Shield demo call. */
  shield?: ShieldInfo | null;
};

const STATE_ICONS = {
  safe: ShieldCheck,
  tip: Lightbulb,
  reviewing: LoaderCircle,
  live: CircleDashed,
  upcoming: Hourglass,
  unanswered: PhoneOff,
} as const;

export function DrillRow({
  drill, colorIndex, relationship, showWho = true, showLesson = true, shield = null,
}: DrillRowProps) {
  const state = drillState(drill);
  const outcome = drillOutcomeWords(drill);
  const voice = voiceWords(drill);
  const Icon = STATE_ICONS[state];
  const title = drill.scenario_title ?? 'Practice call';
  const when = state === 'upcoming' ? null : whenWords(drill.ended_at ?? drill.answered_at ?? drill.created_at);
  const meta = [voice, DIFFICULTY_WORDS[drill.difficulty], when].filter(Boolean).join(' · ');
  const callback = secondsWords(drill.callback_seconds);
  const done = state === 'safe' || state === 'tip';

  return (
    <li className={`rv-drill is-${state}${showWho ? '' : ' no-who'}`}>
      <Link to={`/calls/${drill.call_id}`} className="rv-drill__link">
        {showWho ? (
          <div className="rv-drill__who">
            <PersonAvatar name={drill.member.name} index={colorIndex} size="sm" />
            <div>
              <strong>{drill.member.name}</strong>
              {relationship ? <small>{relationship}</small> : null}
            </div>
          </div>
        ) : null}

        <div className="rv-drill__call">
          <strong className="rv-drill__title">
            {title}
            {shield ? (
              <span className="rv-shield-tag" title="A simulated real scam call with Callback Shield on">
                <ShieldAlert size={12} aria-hidden /> Shield demo
              </span>
            ) : null}
          </strong>
          <span className="rv-drill__meta">{meta}</span>
          {drill.tactics.length ? (
            <span className="rv-drill__tactics" aria-label="Pressure tactics the caller used">
              {drill.tactics.map((tactic) => <TacticBadge key={tactic.key} label={tactic.label} active />)}
            </span>
          ) : null}
        </div>

        <div className="rv-drill__outcome">
          <span className={`rv-outcome is-${state}`}>
            <Icon size={15} aria-hidden className={state === 'reviewing' ? 'rv-spin' : undefined} />
            {outcome.label}
          </span>
          {outcome.detail ? <small>{outcome.detail}</small> : null}
          {shield && shield.alerted > 0 ? (
            <small className="rv-drill__shield">
              <BellRing size={13} aria-hidden /> Shield alerted {shield.alerted === 1 ? '1 person' : `${shield.alerted} people`}
            </small>
          ) : null}
          {done && callback ? (
            <small className="rv-drill__callback">
              <PhoneForwarded size={13} aria-hidden /> Called the family number {callback} later
            </small>
          ) : null}
        </div>

        <div className="rv-drill__risk">
          {/* Nothing has been said yet while it is planned or ringing. */}
          {state === 'upcoming' || drill.status === 'ringing'
            ? <span className="rv-drill__dash" aria-hidden>–</span>
            : <RiskLamp level={drill.peak_risk_level} />}
        </div>

        <span className="rv-drill__open">
          <span className="rv-sr">{state === 'live' ? 'Follow live' : state === 'upcoming' ? 'Open' : 'Replay'}</span>
          <ChevronRight size={18} aria-hidden />
        </span>

        {showLesson && drill.lesson ? (
          <p className="rv-drill__lesson">
            <Lightbulb size={14} aria-hidden />
            <span>{drill.lesson}</span>
          </p>
        ) : null}
      </Link>
    </li>
  );
}

/** The column names above a list of drill rows. */
export function DrillListHead({ showWho = true }: { showWho?: boolean }) {
  return (
    <div className={`rv-drill-head${showWho ? '' : ' no-who'}`} aria-hidden>
      {showWho ? <span>Who</span> : null}
      <span>The call</span>
      <span>What they did</span>
      <span>Peak risk</span>
    </div>
  );
}
