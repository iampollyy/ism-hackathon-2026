// One person's plan: what they said, what to work on, this week, the plan's
// steps, and their readiness item by item (before → now, each out of 2).

import { ArrowRight, Quote } from 'lucide-react';
import type { MemberView, ScenarioView } from '../../api/types';
import { ProgressBar } from '../../components/atoms/ProgressBar';
import { capitalise, DIFFICULTY_WORDS, scenarioTitle, statusWords } from './words';

type Props = {
  members: MemberView[];
  selected: MemberView;
  scenarios: ScenarioView[];
  onSelect: (memberId: string) => void;
};

export function MemberPlan({ members, selected, scenarios, onSelect }: Props) {
  const { plan, readiness } = selected;

  return (
    <section id="plan" className="fh-panel fh-plan" aria-labelledby="plan-title">
      <div className="fh-panel-head wrap">
        <h2 id="plan-title">Readiness and plans</h2>
        <div className="fh-tabs" role="tablist" aria-label="Choose a person">
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              role="tab"
              aria-selected={member.id === selected.id}
              className={member.id === selected.id ? 'on' : undefined}
              onClick={() => onSelect(member.id)}
            >
              {member.name}
            </button>
          ))}
        </div>
      </div>

      <div className="fh-plan-grid" role="tabpanel" aria-label={`${selected.name}'s plan`}>
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
                        {capitalise(step.when)} · {DIFFICULTY_WORDS[step.difficulty] ?? `Level ${step.difficulty}`}
                        {step.voice_of ? ` · in ${step.voice_of}'s voice` : ''}
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
