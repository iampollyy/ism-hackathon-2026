import { Link } from 'react-router-dom';
import { ArrowRight, CircleCheck, ShieldCheck } from 'lucide-react';
import { possessive, shortDate, type Drill, type LearnTactic } from './shared';

const SHOWN_DRILLS = 3;

const LIGHT_WORDS = {
  yellow: { chip: 'Yellow light', title: 'On a live call, this on its own turns the risk light yellow.' },
  red: { chip: 'Red light', title: 'On a live call, this on its own turns the risk light red.' },
} as const;

type TacticCardProps = {
  tactic: LearnTactic;
  drills: Drill[];
  familyId: string;
  flash: boolean;
};

/** One tactic or warning sign: how it sounds, why it works, what to do, and where the family met it. */
export function TacticCard({ tactic, drills, familyId, flash }: TacticCardProps) {
  const light = LIGHT_WORDS[tactic.level];
  const shown = drills.slice(0, SHOWN_DRILLS);
  const more = drills.length - shown.length;

  return (
    <article
      id={`tactic-${tactic.key}`}
      className={`lp-tactic${flash ? ' is-flash' : ''}`}
      aria-labelledby={`lp-tactic-${tactic.key}`}
    >
      <header className="lp-tactic__head">
        <h3 id={`lp-tactic-${tactic.key}`}>{tactic.label}</h3>
        <span className={`lp-light lp-light--${tactic.level}`} title={light.title}>
          <span className="lp-light__dot" aria-hidden />
          {light.chip}
          <span className="lp-sr">: {light.title}</span>
        </span>
      </header>

      <div className="lp-tactic__speech">
        <h4 className="lp-sub">What it sounds like</h4>
        {tactic.what_it_sounds_like.map((line) => (
          <blockquote key={line} className="lp-speech">
            <p>“{line}”</p>
          </blockquote>
        ))}
      </div>

      <div className="lp-tactic__why">
        <h4 className="lp-sub">Why it works</h4>
        <p>{tactic.why_it_works}</p>
      </div>

      <div className="lp-tactic__todo">
        <h4>
          <ShieldCheck size={17} aria-hidden /> What to do
        </h4>
        <p>{tactic.what_to_do}</p>
      </div>

      {shown.length > 0 ? (
        <div className="lp-tactic__drills">
          <h4 className="lp-sub">In the family's practice calls</h4>
          <ul>
            {shown.map((drill) => (
              <li key={drill.call_id}>
                <Link to={`/calls/${drill.call_id}`} className="lp-drill">
                  <span className="lp-drill__who">
                    <strong>{drill.member.name}</strong>
                    <span>
                      {drill.voice_of
                        ? `in ${possessive(drill.voice_of.name)} voice`
                        : (drill.scenario_title ?? 'Practice call')}
                      {drill.ended_at || drill.created_at ? ` · ${shortDate(drill.ended_at ?? drill.created_at)}` : ''}
                    </span>
                  </span>
                  <DrillOutcome drill={drill} />
                  <ArrowRight size={15} className="lp-drill__go" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {more > 0 ? (
            <Link to={`/family/${familyId}/drills`} className="lp-tactic__more">
              {more === 1 ? 'One more practice call' : `${more} more practice calls`} <ArrowRight size={14} aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** What the person did, said kindly: a safe outcome by name, otherwise "a tip for next time". */
function DrillOutcome({ drill }: { drill: Drill }) {
  if (drill.safe && drill.outcome_label) {
    return (
      <span className="lp-drill__outcome is-safe">
        <CircleCheck size={14} aria-hidden /> {drill.outcome_label}
      </span>
    );
  }
  if (drill.outcome) return <span className="lp-drill__outcome">A tip for next time</span>;
  return <span className="lp-drill__outcome">Review on its way</span>;
}
