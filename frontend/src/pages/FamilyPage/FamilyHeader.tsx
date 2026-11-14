// The top of the organiser's home: the family's name, where things stand in
// one line, the plan, and the way into the other family screens.

import { Link } from 'react-router-dom';
import { Activity, ArrowUpRight, BookOpen, KeyRound, ListChecks, Mic, Newspaper, ShieldCheck, ShieldOff, Smartphone, Users } from 'lucide-react';
import type { FamilyPlanView, FamilyView } from '../../api/types';
import { daysUntil } from './words';

type Props = {
  family: FamilyView;
  plan: FamilyPlanView | null;
  /** null while the protection settings load. */
  protectionOn: boolean | null;
};

function planWords(plan: FamilyPlanView): string {
  if (plan.status === 'trialing') {
    const days = daysUntil(plan.trial_ends_at);
    return days === null ? plan.plan_name : `${plan.plan_name} · ${days === 1 ? '1 day' : `${days} days`} left`;
  }
  if (plan.status === 'canceled') return `${plan.plan_name} · cancelled`;
  return plan.price ? `${plan.plan_name} · ${plan.price}` : plan.plan_name;
}

export function FamilyHeader({ family, plan, protectionOn }: Props) {
  const members = family.members;
  const joined = members.filter((member) => member.joined).length;
  const voices = members.filter((member) => member.voice_ready).length;
  const phones = members.filter((member) => member.phone_online).length;
  const { before, now, max } = family.readiness;
  const base = `/family/${family.id}`;

  const links = [
    { to: `${base}/drills`, label: 'Drills', note: 'Replays and lessons', icon: ListChecks },
    { to: `${base}/activity`, label: 'Activity', note: 'Who did what', icon: Activity },
    { to: `${base}/learn`, label: 'Learn', note: "Scammers' tricks", icon: BookOpen },
    { to: `${base}/news`, label: 'News', note: "This week's scams", icon: Newspaper },
  ];

  return (
    <header className="fh-header">
      <div className="fh-header-top">
        <h1>{family.name}</h1>
        {plan ? (
          <Link to={`${base}/plan`} className="fh-plan-chip">
            <span>{planWords(plan)}</span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <ul className="fh-facts" aria-label="Where the family stands">
        <li className={protectionOn ? 'on' : undefined}>
          {protectionOn === false ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}
          {protectionOn === null ? 'Protection…' : protectionOn ? 'Protection on' : 'Protection off'}
        </li>
        <li>
          <span className="fh-readiness-mini" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (now / Math.max(1, max)) * 100)}%` }} />
          </span>
          Readiness <strong>{before} → {now}</strong> of {max}
        </li>
        <li className={family.safe_word_set ? 'on' : undefined}>
          <KeyRound size={16} />
          {family.safe_word_set ? 'Family word agreed' : 'No family word yet'}
        </li>
        <li>
          <Users size={16} />
          {joined} of {members.length} joined
        </li>
        <li>
          <Mic size={16} />
          {voices === 1 ? '1 voice ready' : `${voices} voices ready`}
        </li>
        <li className={phones > 0 ? 'on' : undefined}>
          <Smartphone size={16} />
          {phones === 1 ? '1 phone open' : `${phones} phones open`}
        </li>
      </ul>

      <nav className="fh-quicklinks" aria-label="Family screens">
        {links.map(({ to, label, note, icon: Icon }) => (
          <Link key={to} to={to} className="fh-quicklink">
            <span className="fh-quicklink-icon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{note}</small>
            </span>
            <ArrowUpRight size={16} className="fh-quicklink-arrow" aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </header>
  );
}
