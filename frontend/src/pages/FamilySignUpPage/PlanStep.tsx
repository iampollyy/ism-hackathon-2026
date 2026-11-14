// Step 3: choose a plan, or simply start the free trial (every family is on
// it from sign-up, so skipping needs no request). Demo mode: no payment and
// no card details.

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock } from 'lucide-react';
import { api } from '../../api/client';
import type { FamilyPlanView } from '../../api/types';
import { PlanPicker } from '../PlanPage/PlanPicker';
import { longDate } from '../PlanPage/planWords';

type Props = {
  familyId: string;
  onBack: () => void;
  onDone: () => void;
};

export function PlanStep({ familyId, onBack, onDone }: Props) {
  const [plan, setPlan] = useState<FamilyPlanView | null>(null);
  const [trialDays, setTrialDays] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    api.plan(familyId).then(
      (answer) => live && setPlan(answer),
      () => undefined, // the trial line just stays general
    );
    return () => {
      live = false;
    };
  }, [familyId]);

  const ends = plan?.status === 'trialing' ? longDate(plan.trial_ends_at) : '';
  const days = trialDays ?? 30;

  return (
    <div className="onb-plan">
      <div className="onb-trial">
        <span className="onb-how-icon" aria-hidden="true">
          <CalendarClock size={18} />
        </span>
        <span>
          <strong>Your {days}-day free trial has started.</strong>
          <small>
            {ends ? `It runs until ${ends}. ` : ''}Nothing is charged when it ends. Choose a plan now, or later from Plan
            in the menu.
          </small>
        </span>
        <button type="button" className="button button-primary" onClick={onDone}>
          Start the {days}-day free trial <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>

      <PlanPicker
        familyId={familyId}
        current={plan}
        highlight={null}
        onChosen={onDone}
        onPricing={(pricing) => setTrialDays(pricing.trial_days)}
      />

      <div className="onb-footer">
        <button type="button" className="button button-secondary" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" /> Back to the invites
        </button>
      </div>
    </div>
  );
}
