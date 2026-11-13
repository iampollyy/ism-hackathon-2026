// One member's plan: what they said, their weak spot, this week, the plan's
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
    <section id="plan" className="content-panel plan-panel">
      <div className="section-heading-row compact">
        <div>
          <span className="eyebrow">One person's plan</span>
          <h2>{selected.name}'s plan</h2>
        </div>
        <div className="member-tabs" role="tablist" aria-label="Choose a person">
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

      <div className="plan-grid">
        <div className="plan-story">
          {selected.said ? (
            <blockquote className="plan-quote">
              <Quote size={18} />
              <p>{selected.said}</p>
              <cite>{selected.name}, on the welcome call</cite>
            </blockquote>
          ) : null}

          {selected.weak_spot ? (
            <div className="plan-block">
              <small>Weak spot</small>
              <p>{selected.weak_spot}</p>
            </div>
          ) : null}

          {plan ? (
            <>
              <div className="plan-block this-week">
                <small>This week</small>
                <p>{plan.this_week}</p>
              </div>
              {plan.steps.length > 0 ? (
                <ol className="plan-steps">
                  {plan.steps.map((step, index) => (
                    <li key={index} className={step.status === 'done' ? 'done' : undefined}>
                      <div className="plan-step-head">
                        <strong>{scenarioTitle(step.scenario, scenarios)}</strong>
                        <span className={`step-status ${step.status}`}>{statusWords(step.status)}</span>
                      </div>
                      <span className="plan-step-meta">
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
            <p className="plan-empty">
              No plan yet. Callback writes {selected.name}'s plan after their welcome call or first practice.
            </p>
          )}
        </div>

        <div className="plan-readiness">
          <div className="plan-readiness-total">
            <small>Readiness</small>
            <strong>
              {readiness.before} <ArrowRight size={20} /> {readiness.now}
            </strong>
            <span>out of {readiness.max}, before practice and now</span>
          </div>
          <ul className="readiness-items">
            {readiness.items.map((item) => (
              <li key={item.key}>
                <div className="readiness-header">
                  <span>{item.label}</span>
                  <span className="readiness-score">
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
