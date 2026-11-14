// One person's plan: what they said, what to work on, this week, the plan's
// steps, and their readiness item by item (before → now, each out of 2).
//
// Whose voice a step uses stays out while a drill has taken it (the step is
// `scheduled`) or while a practice call for this person is still to come or
// ringing, so the page never tells anyone whose voice is about to ring. The
// organiser is a person called too: their own steps never say whose voice,
// and the time of their booked drill stays a surprise.

import { ArrowRight, Quote } from 'lucide-react';
import type { MemberView, PlanStepView, ScenarioView, WeekItem } from '../../api/types';
import { ProgressBar } from '../../components/atoms/ProgressBar';
import { capitalise, DIFFICULTY_WORDS, isLiveStatus, scenarioTitle, statusWords } from './words';

type Props = {
  members: MemberView[];
  selected: MemberView;
  week: WeekItem[];
  scenarios: ScenarioView[];
  onSelect: (memberId: string) => void;
};

export function MemberPlan({ members, selected, week, scenarios, onSelect }: Props) {
  const { plan, readiness } = selected;
  const organiser = selected.is_organiser;
  const callComing = week.some(
    (item) => item.kind === 'practice' && item.member_id === selected.id && isLiveStatus(item.status),
  );
  const showVoice = (step: PlanStepView) =>
    Boolean(step.voice_of) && step.status !== 'scheduled' && (step.status === 'done' || (!callComing && !organiser));
  const stepWhen = (step: PlanStepView) =>
    organiser && step.status === 'scheduled' ? "When: a surprise, like everyone's" : capitalise(step.when);

  return (
    <section id="plan" className="fh-panel fh-plan" aria-labelledby="plan-title">
      <div className="fh-panel-head wrap">
        <h2 id="plan-title">Readiness and plans</h2>
        <div className="fh-tabs" role="group" aria-label="Choose a person">
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              aria-pressed={member.id === selected.id}
              className={member.id === selected.id ? 'on' : undefined}
              onClick={() => onSelect(member.id)}
            >
              {member.name}
            </button>
          ))}
        </div>
      </div>

      <div className="fh-plan-grid">
        <div className="fh-plan-story">
          {selected.said ? (
            <blockquote className="fh-plan-quote">
              <Quote size={18} aria-hidden="true" />
              <p>{selected.said}</p>
              <cite>{selected.name}, on the welcome call</cite>
            </blockquote>
          ) : null}

          {selected.weak_spot ? (
            <div className="fh-plan-block">
              <h3>What to work on</h3>
              <p>{selected.weak_spot}</p>
            </div>
          ) : null}

          {plan ? (
            <>
              {plan.this_week ? (
                <div className="fh-plan-block this-week">
                  <h3>This week</h3>
                  <p>{plan.this_week}</p>
                </div>
              ) : null}
              {plan.steps.length > 0 ? (
                <ol className="fh-plan-steps">
                  {plan.steps.map((step, index) => (
                    <li key={index} className={step.status === 'done' ? 'done' : undefined}>
                      <div className="fh-plan-step-head">
                        <strong>{scenarioTitle(step.scenario, scenarios)}</strong>
                        <span className={`fh-step-status ${step.status}`}>{statusWords(step.status)}</span>
                      </div>
                      <span className="fh-plan-step-meta">
                        {stepWhen(step)} · {DIFFICULTY_WORDS[step.difficulty] ?? `Level ${step.difficulty}`}
                        {showVoice(step) ? ` · in ${step.voice_of}'s voice` : ''}
                      </span>
                      <p>{step.why}</p>
                    </li>
                  ))}
                </ol>
              ) : null}
            </>
          ) : (
            <p className="fh-empty">
              No plan yet. Callback writes {selected.name}'s plan after their welcome call or first practice.
            </p>
          )}
        </div>

        <div className="fh-plan-readiness">
          <div className="fh-plan-total">
            <span>Readiness</span>
            <strong>
              {readiness.before} <ArrowRight size={20} aria-hidden="true" /> {readiness.now}
              <small>/{readiness.max}</small>
            </strong>
            <span>Before any practice, and now</span>
          </div>
          <ul className="fh-readiness-items">
            {readiness.items.map((item) => (
              <li key={item.key}>
                <div className="fh-readiness-head">
                  <span>{item.label}</span>
                  <span className="fh-readiness-score">
                    {item.before} → {item.now} <small>/ {item.max}</small>
                  </span>
                </div>
                <ProgressBar value={item.now} max={item.max} color={item.now > item.before ? '#1d8d64' : '#213d52'} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
