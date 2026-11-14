// Small parts shared by the organiser's review screens: the page header with
// its way back to the family, the person filter, the peak-risk light, empty,
// loading and error states.

import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, WifiOff } from 'lucide-react';
import type { FamilyView, MemberView, RiskLevel } from '../../api/types';
import { Avatar } from '../../components/atoms/Avatar';
import { saveFamilyId } from '../FamilySignUpPage/familyStorage';
import { avatarColor, initials } from '../FamilySignUpPage/signUpTypes';

// ---------------------------------------------------------------- the header

type ReviewHeaderProps = {
  familyId: string;
  familyName: string | null;
  /** Where the back link goes instead of the family page, such as when the
   * family itself was not found. */
  back?: { to: string; label: string };
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  /** Shown before the title, such as a person's avatar. */
  leading?: ReactNode;
};

export function ReviewHeader({ familyId, familyName, back, title, lead, actions, leading }: ReviewHeaderProps) {
  const to = back?.to ?? `/family/${familyId}`;
  const label = back?.label ?? (familyName ? `Back to ${familyName}` : 'Back to the family');
  return (
    <header className="rv-header">
      <Link to={to} className="rv-back">
        <ArrowLeft size={16} aria-hidden />
        <span>{label}</span>
      </Link>
      <div className="rv-header__row">
        <div className="rv-header__title">
          {leading}
          <div>
            <h1>{title}</h1>
            {lead ? <p className="rv-lead">{lead}</p> : null}
          </div>
        </div>
        {actions ? <div className="rv-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Remember the family once it has loaded, so the sidebar can find it again
 * when someone lands on this page from a link. */
export function useRememberFamily(familyId: string | null | undefined): void {
  useEffect(() => {
    if (familyId) saveFamilyId(familyId);
  }, [familyId]);
}

// ---------------------------------------------------------------- people

/** A member's place in the family, for the same avatar colour as the family page. */
export function memberIndex(family: FamilyView | null, memberId: string): number {
  const index = family?.members.findIndex((member) => member.id === memberId) ?? -1;
  return index === -1 ? 0 : index;
}

export function PersonAvatar({ name, index, size = 'md' }: { name: string; index: number; size?: 'sm' | 'md' | 'lg' }) {
  return <Avatar initials={initials(name)} color={avatarColor(index)} size={size} />;
}

type PersonFilterProps = {
  members: MemberView[];
  value: string | null;
  onChange: (memberId: string | null) => void;
  /** How many items each person has, and in all; left out (no badges)
   * while they are not known yet. */
  counts?: Map<string, number>;
  total?: number;
  label: string;
};

/** "Everyone" and one chip per person, with how many items each has. */
export function PersonFilter({ members, value, onChange, counts, total, label }: PersonFilterProps) {
  return (
    <div className="rv-filter" role="group" aria-label={label}>
      <button type="button" className={`rv-filter__chip${value === null ? ' is-on' : ''}`} aria-pressed={value === null} onClick={() => onChange(null)}>
        Everyone {total !== undefined ? <span className="rv-filter__count">{total}</span> : null}
      </button>
      {members.map((member, index) => (
        <button
          key={member.id}
          type="button"
          className={`rv-filter__chip${value === member.id ? ' is-on' : ''}`}
          aria-pressed={value === member.id}
          onClick={() => onChange(value === member.id ? null : member.id)}
        >
          <span className="rv-filter__dot" style={{ background: avatarColor(index) }} aria-hidden />
          {member.name} {counts ? <span className="rv-filter__count">{counts.get(member.id) ?? 0}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the peak-risk light

const LAMP_WORDS: Record<RiskLevel, string> = { green: 'Green', yellow: 'Yellow', red: 'Red' };
const LAMP_TITLES: Record<RiskLevel, string> = {
  green: 'The risk light stayed green',
  yellow: 'The risk light reached yellow: be careful',
  red: 'The risk light reached red: warning signs',
};

/** The live call screen's traffic light, small: the highest level it reached. */
export function RiskLamp({ level, showWord = true }: { level: RiskLevel | null; showWord?: boolean }) {
  const title = level ? LAMP_TITLES[level] : 'No risk reading for this call';
  return (
    <span className={`rv-lamp${level ? ` rv-lamp--${level}` : ' rv-lamp--none'}`} title={title}>
      <span className="rv-lamp__housing" aria-hidden>
        <i className="rv-lamp__bulb is-red" />
        <i className="rv-lamp__bulb is-yellow" />
        <i className="rv-lamp__bulb is-green" />
      </span>
      {showWord ? <span className="rv-lamp__word" aria-hidden>{level ? LAMP_WORDS[level] : 'None'}</span> : null}
      <span className="rv-sr">{title}</span>
    </span>
  );
}

// ---------------------------------------------------------------- states

type EmptyStateProps = { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode; compact?: boolean };

export function EmptyState({ icon, title, children, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`rv-empty${compact ? ' rv-empty--compact' : ''}`}>
      <span className="rv-empty__icon" aria-hidden>{icon}</span>
      <div>
        <h3>{title}</h3>
        <div className="rv-empty__text">{children}</div>
        {action ? <div className="rv-empty__action">{action}</div> : null}
      </div>
    </div>
  );
}

/** Grey rows while the first answer is on its way. */
export function LoadingRows({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div className="rv-loading" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rv-loading__row" style={{ animationDelay: `${index * 120}ms` }}>
          <span className="rv-loading__dot" />
          <span className="rv-loading__line" />
          <span className="rv-loading__line is-short" />
        </div>
      ))}
    </div>
  );
}

/** Nothing could be loaded: say why, and offer to try again. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rv-error" role="alert">
      <WifiOff size={20} aria-hidden />
      <div>
        <strong>We couldn’t load this just now</strong>
        <p>{message}</p>
      </div>
      <button type="button" className="button button-secondary" onClick={onRetry}>
        <RefreshCw size={15} aria-hidden /> Try again
      </button>
    </div>
  );
}

/** Data is on screen, but the latest refresh failed. */
export function StaleNotice() {
  return (
    <p className="rv-stale" role="status">
      <WifiOff size={15} aria-hidden /> Can’t reach Callback right now. Showing the last update and trying again.
    </p>
  );
}
