// Step 3: choose a plan, or simply start the free trial (every family is on
// it from sign-up, so skipping needs no request). Demo mode: no payment and
// no card details. The banner follows the plan: the trial, a chosen plan (on
// coming back to this step), or a cancelled one.

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarClock, CircleSlash } from 'lucide-react';
import { api } from '../../api/client';
import type { FamilyPlanView } from '../../api/types';
import { PlanPicker } from '../PlanPage/PlanPicker';
import { chosenForAfterTrial, longDate } from '../PlanPage/planWords';

type Props = {
  familyId: string;
  onBack: () => void;
  onDone: () => void;
};

type Banner = {
  icon: typeof CalendarClock;
  tone: string;
  title: string;
  text: string;
  action: string;
  /** False when the plans below are the main thing to do. */
  primary: boolean;
};

function banner(plan: FamilyPlanView | null, days: number): Banner {
  if (plan?.status === 'active') {
    return {
      icon: BadgeCheck,
      tone: 'active',
      title: `You’re on ${plan.plan_name}`,
      text: `${plan.price ? `${plan.price}, ` : ''}chosen on ${longDate(plan.started_at)}. No payment was taken. You can change it later from Plan in the menu.`,
      action: 'Go to the family page',
      primary: true,
    };
  }
  if (plan?.status === 'canceled') {
    return {
      icon: CircleSlash,
      tone: 'canceled',
      title: 'Choose a plan again',
      text: `${plan.plan_name} is cancelled. Pick a plan below whenever you like; drills and the Shield keep working in this demo.`,
      action: 'Go to the family page',
      primary: false,
    };
  }
  const ends = plan?.status === 'trialing' ? longDate(plan.trial_ends_at) : '';
  if (plan && chosenForAfterTrial(plan)) {
    return {
      icon: BadgeCheck,
      tone: 'active',
      title: ends ? `${days} days free, then ${plan.plan_name}` : `Free trial, then ${plan.plan_name}`,
      text: `${plan.plan_name}${plan.price ? ` (${plan.price})` : ''} starts${ends ? ` on ${ends}` : ' when the trial ends'}. Demo: nothing is ever charged. You can change it later from Plan in the menu.`,
      action: 'Go to the family page',
      primary: true,
    };
  }
  return {
    icon: CalendarClock,
    tone: 'trialing',
    title: ends ? `${days} days free, until ${ends}` : `${days} days free`,
    text: 'Demo: nothing is ever charged. Choose a plan now, or later from Plan in the menu.',
    action: `Start the ${days}-day free trial`,
    primary: true,
  };
}

export function PlanStep({ familyId, onBack, onDone }: Props) {
  const [plan, setPlan] = useState<FamilyPlanView | null>(null);
  const [trialDays, setTrialDays] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    api.plan(familyId).then(
      (answer) => live && setPlan(answer),
      () => undefined, // the banner just stays general
    );
    return () => {
      live = false;
    };
  }, [familyId]);

  const shown = banner(plan, trialDays ?? 30);
  const Icon = shown.icon;

  return (
    <div className="onb-plan">
      <div className={`onb-trial ${shown.tone}`}>
        <span className="onb-how-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <span>
          <strong>{shown.title}</strong>
          <small>{shown.text}</small>
        </span>
        <button type="button" className={`button ${shown.primary ? 'button-primary' : 'button-secondary'}`} onClick={onDone}>
          {shown.action} <ArrowRight size={18} aria-hidden="true" />
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
