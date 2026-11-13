// One member's card on the family page: who they are, readiness before and
// now, voice, phone, practice consent (with a toggle), the family word and the
// next practice, and a button for the welcome call.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneIncoming } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { MemberView, ScenarioView } from '../../api/types';
import { Avatar } from '../../components/atoms/Avatar';
import { avatarColor, initials } from '../FamilySignUpPage/signUpTypes';
import { callErrorText, capitalise, scenarioTitle } from './words';

type Props = {
  member: MemberView;
  index: number;
  familyId: string;
  safeWordSet: boolean;
  scenarios: ScenarioView[];
  selected: boolean;
  onSelect: () => void;
  onChanged: () => void;
};

type Notice = { tone: 'good' | 'bad'; text: string; callId?: string };

function voiceWords(member: MemberView): { text: string; good: boolean } {
  switch (member.voice_status) {
    case 'ready': return { text: 'Ready', good: true };
    case 'failed': return { text: 'Recording failed', good: false };
    case 'deleted': return { text: 'Deleted', good: false };
    default: return { text: 'Not yet', good: false };
  }
}

export function FamilyMemberCard({ member, index, familyId, safeWordSet, scenarios, selected, onSelect, onChanged }: Props) {
  const [consentBusy, setConsentBusy] = useState(false);
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const voice = voiceWords(member);
  const nextStep = member.plan?.steps.find((step) => step.status !== 'done');
  const { before, now, max } = member.readiness;

  const toggleConsent = async () => {
    setConsentBusy(true);
    setNotice(null);
    try {
      await api.setConsent(member.id, { consent_practice: !member.consent.practice });
      onChanged();
    } catch (error) {
      setNotice({ tone: 'bad', text: error instanceof ApiError ? error.message : 'Something went wrong. Please try again.' });
    } finally {
      setConsentBusy(false);
    }
  };

  const welcomeCall = async () => {
    setWelcomeBusy(true);
    setNotice(null);
    try {
      const call = await api.startWelcomeCall(member.id);
      setNotice({ tone: 'good', text: `Ringing on ${member.name}'s phone`, callId: call.call_id });
      onChanged();
    } catch (error) {
      setNotice({ tone: 'bad', text: callErrorText(error, member.name) });
    } finally {
      setWelcomeBusy(false);
    }
  };

  return (
    <article className={`member-card family-member-card${selected ? ' selected' : ''}`}>
      <div className="member-card-row">
        <div className="member-card-head">
          <Avatar initials={initials(member.name)} color={avatarColor(index)} size="md" />
          <div>
            <h4>{member.name}</h4>
            <p>{capitalise(member.relationship)}</p>
          </div>
        </div>
        {member.is_organiser ? <span className="member-card-tag">Organiser</span> : null}
      </div>

      <span className={`phone-dot${member.phone_online ? ' on' : ''}`}>
        {member.phone_online ? 'Phone open' : 'Phone page closed'}
      </span>

      <div className="member-card-metric">
        <div>
          <label>Readiness</label>
          <strong>
            {before} <ArrowRight size={18} className="metric-arrow" /> {now}
            <small> / {max}</small>
          </strong>
        </div>
        <button type="button" className="text-button" onClick={onSelect} aria-pressed={selected}>
          {selected ? 'Showing plan' : 'See plan'}
        </button>
      </div>

      <dl className="member-facts">
        <div>
          <dt>Voice</dt>
          <dd className={voice.good ? 'good' : undefined}>
            {voice.text}
            {!voice.good ? (
              <Link to={`/signup?family=${familyId}&step=voices`} className="text-button">
                Record
              </Link>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Practice calls</dt>
          <dd>
            <button
              type="button"
              role="switch"
              aria-checked={member.consent.practice}
              aria-label={`${member.name} agrees to practice calls`}
              className={`consent-switch${member.consent.practice ? ' on' : ''}`}
              onClick={toggleConsent}
              disabled={consentBusy}
            >
              <span className="switch-track" aria-hidden="true" />
              <span>{member.consent.practice ? 'Agreed' : 'Not agreed'}</span>
            </button>
          </dd>
        </div>
        <div>
          <dt>Family word</dt>
          <dd className={safeWordSet ? 'good' : undefined}>{safeWordSet ? 'Agreed' : 'Not agreed yet'}</dd>
        </div>
        <div>
          <dt>Next practice</dt>
          <dd>{nextStep ? `${scenarioTitle(nextStep.scenario, scenarios)}, ${nextStep.when}` : 'Not planned yet'}</dd>
        </div>
      </dl>

      {member.weak_spot ? (
        <div className="member-weak-spot">
          <small>Focus</small>
          <p>{member.weak_spot}</p>
        </div>
      ) : null}

      <div className="member-card-actions">
        <button type="button" className="button button-secondary" onClick={welcomeCall} disabled={welcomeBusy}>
          <PhoneIncoming size={16} /> {welcomeBusy ? 'Calling…' : 'Welcome call'}
        </button>
      </div>

      {notice ? (
        <div className={`card-notice ${notice.tone}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          {notice.callId ? (
            <Link to={`/calls/${notice.callId}`} className="text-link">
              Watch the call
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
