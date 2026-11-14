// Plain words for a family's plan (GET /api/families/{id}/plan), shared by
// the plan page, the plan step of sign-up and the list of families.

import type { FamilyPlanView } from '../../api/types';

const DAY_MS = 24 * 60 * 60 * 1000;

const longFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : longFormat.format(date);
}

/** Whole days left in the trial (0 on its last day), or null without an end. */
export function trialDaysLeft(plan: FamilyPlanView, now = Date.now()): number | null {
  if (plan.status !== 'trialing' || !plan.trial_ends_at) return null;
  const ends = new Date(plan.trial_ends_at).getTime();
  if (Number.isNaN(ends)) return null;
  return Math.max(0, Math.ceil((ends - now) / DAY_MS));
}

export function daysWord(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/** A plan chosen during the trial: it takes over when the trial ends, and the trial keeps going. */
export function chosenForAfterTrial(plan: FamilyPlanView): boolean {
  return plan.status === 'trialing' && plan.plan !== 'trial';
}

/** One short line, for a list: "Free trial · 29 days left", "Family · €4.99 a month". */
export function planLine(plan: FamilyPlanView): string {
  if (plan.status === 'trialing') {
    const days = trialDaysLeft(plan);
    const then = chosenForAfterTrial(plan) ? ` · then ${plan.plan_name}` : '';
    if (days === null) return `Free trial${then}`;
    return days > 0 ? `Free trial · ${daysWord(days)} left${then}` : `Free trial ended${then}`;
  }
  if (plan.status === 'canceled') return `${plan.plan_name} · cancelled`;
  return plan.price ? `${plan.plan_name} · ${plan.price}` : plan.plan_name;
}

export const STATUS_WORDS: Record<FamilyPlanView['status'], string> = {
  trialing: 'Free trial',
  active: 'Active',
  canceled: 'Cancelled',
};
