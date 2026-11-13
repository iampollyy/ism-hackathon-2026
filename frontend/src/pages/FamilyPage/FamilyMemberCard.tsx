// One member's card on the family page: who they are, readiness before and
// now, voice, phone, practice consent (with a toggle), the family word and the
// next practice, and a button for the welcome call.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneIncoming } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { MemberView, ScenarioView, WeekItem } from '../../api/types';
import { Avatar } from '../../components/atoms/Avatar';
import { avatarColor, initials } from '../FamilySignUpPage/signUpTypes';
import { callErrorText, capitalise, scenarioTitle } from './words';

type Props = {
  member: MemberView;
  index: number;
  familyId: string;
  safeWordSet: boolean;
  scenarios: ScenarioView[];
  week: WeekItem[];
  selected: boolean;
  onSelect: () => void;
  onChanged: () => void;
};

type Notice = { tone: 'good' | 'bad'; text: string; callId?: string };

/** How long "Ringing on …" stays when the week never shows the call answered. */
const RINGING_NOTICE_MS = 45_000;

function voiceWords(member: MemberView): { text: string; good: boolean; record: boolean } {
  // voice_ready, not voice_status: a member who left Callback keeps the status
  // "ready", but their voice can no longer be used (and is not offered to record).
  if (member.voice_ready) return { text: 'Ready', good: true, record: false };
  switch (member.voice_status) {
    case 'ready': return { text: 'Not in use', good: false, record: false };
    case 'failed': return { text: 'Recording failed', good: false, record: true };
    case 'deleted': return { text: 'Deleted', good: false, record: true };
    default: return { text: 'Not yet', good: false, record: true };
  }
}

export function FamilyMemberCard({ member, index, familyId, safeWordSet, scenarios, week, selected, onSelect, onChanged }: Props) {
  const [consentBusy, setConsentBusy] = useState(false);
  // The answer we just sent, shown until the next refresh of the family agrees.
  const [consentSent, setConsentSent] = useState<boolean | null>(null);
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (consentSent !== null && member.consent.practice === consentSent) setConsentSent(null);
  }, [member.consent.practice, consentSent]);

  // An error goes once what it was about changes (the phone opens, consent, a voice).
  useEffect(() => {
    setNotice((current) => (current?.tone === 'bad' ? null : current));
  }, [member.phone_online, member.consent.practice, member.voice_ready]);

  // "Ringing on …" follows the welcome call: it stays while the call rings or
  // goes on, and goes when the call ends, is missed or declined, or after 45 s
  // if the call never shows as answered.
  const noticeCallStatus = notice?.callId ? week.find((item) => item.call_id === notice.callId)?.status : undefined;
  useEffect(() => {
    if (!notice?.callId || noticeCallStatus === 'in_progress') return;
    if (noticeCallStatus && noticeCallStatus !== 'ringing') {
      setNotice(null);
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), RINGING_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, noticeCallStatus]);

  const consent = consentSent ?? member.consent.practice;
  const voice = voiceWords(member);
  const nextStep = member.plan?.steps.find((step) => step.status !== 'done');
  const { before, now, max } = member.readiness;

  const toggleConsent = async () => {
    const next = !consent;
    setConsentBusy(true);
    setNotice(null);
    try {
      await api.setConsent(member.id, { consent_practice: next });
      setConsentSent(next);
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
            {voice.record ? (
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
              aria-checked={consent}
              aria-label={`${member.name} agrees to practice calls`}
              className={`consent-switch${consent ? ' on' : ''}`}
              onClick={toggleConsent}
              disabled={consentBusy}
            >
              <span className="switch-track" aria-hidden="true" />
              <span>{consent ? 'Agreed' : 'Not agreed'}</span>
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
          <span>
            {notice.callId && noticeCallStatus === 'in_progress' ? `${member.name} answered the welcome call` : notice.text}
          </span>
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
