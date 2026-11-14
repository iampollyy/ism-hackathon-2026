// One person in the family list: who they are, whether they joined (with
// their invite link to copy, share or scan if not), their phone, practice
// consent (a switch), their voice, the welcome call, readiness before and
// now, and the way to their own page.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, Link2, PhoneIncoming, QrCode } from 'lucide-react';
import { api } from '../../api/client';
import type { MemberView, VoiceSampleStatus, WeekItem } from '../../api/types';
import { Avatar } from '../../components/atoms/Avatar';
import { CopyButton, fullUrl, LinkQrCode, ShareButton } from './links';
import { Switch } from './Switch';
import { callErrorText, capitalise, errorText } from './words';

type Props = {
  member: MemberView;
  color: string;
  initials: string;
  familyId: string;
  familyName: string;
  /** undefined until loaded; only fetched for members who joined. */
  sample: VoiceSampleStatus | undefined;
  week: WeekItem[];
  left: boolean;
  base: string;
  onChanged: () => void;
};

type Notice = { tone: 'good' | 'bad'; text: string; callId?: string };

/** How long "Ringing on …" stays when the week never shows the call answered. */
const RINGING_NOTICE_MS = 45_000;
const ANSWERED = ['in_progress', 'ended', 'scored'];

const joinedFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

type Voice = { text: string; tone: 'good' | 'wait' | 'warn' | 'quiet'; detail?: string };

function voiceState(member: MemberView, sample: VoiceSampleStatus | undefined, left: boolean): Voice {
  if (member.voice_ready) return { text: 'Ready', tone: 'good' };
  if (left) return { text: 'Not in use', tone: 'quiet' };
  if (sample?.state === 'waiting_for_consent') return { text: 'Waiting', tone: 'wait', detail: 'For their spoken yes' };
  if (sample?.state === 'cloning') return { text: 'Being made…', tone: 'wait' };
  if (sample?.state === 'failed' || member.voice_status === 'failed') {
    return { text: 'Not made', tone: 'warn', detail: sample?.reason ?? 'The recording could not be used.' };
  }
  if (member.voice_status === 'deleted') return { text: 'Deleted', tone: 'quiet' };
  if (!member.joined) return { text: 'None yet', tone: 'quiet', detail: 'Made from their welcome call' };
  if (sample?.call_id && sample.reason && /did not agree|clear yes/i.test(sample.reason)) {
    return { text: 'None', tone: 'quiet', detail: 'They chose to keep it private' };
  }
  return { text: 'None yet', tone: 'quiet' };
}

export function MemberRow({ member, color, initials, familyId, familyName, sample, week, left, base, onChanged }: Props) {
  const [consentBusy, setConsentBusy] = useState(false);
  // The answer just sent, shown until the next refresh of the family agrees.
  const [consentSent, setConsentSent] = useState<boolean | null>(null);
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (consentSent !== null && member.consent.practice === consentSent) setConsentSent(null);
  }, [member.consent.practice, consentSent]);

  // An error goes once what it was about changes (the phone opens, consent, a voice).
  useEffect(() => {
    setNotice((current) => (current?.tone === 'bad' ? null : current));
  }, [member.phone_online, member.consent.practice, member.voice_ready]);

  const welcomes = week.filter((item) => item.kind === 'welcome' && item.member_id === member.id);
  const welcomeLive = welcomes.find((item) => item.status === 'ringing' || item.status === 'in_progress');
  const welcomeDone = Boolean(sample?.call_id) || welcomes.some((item) => ANSWERED.includes(item.status));

  // "Ringing on …" follows the welcome call it started.
  const noticeStatus = notice?.callId ? week.find((item) => item.call_id === notice.callId)?.status : undefined;
  useEffect(() => {
    if (notice && !notice.callId && notice.tone === 'good') {
      const timer = window.setTimeout(() => setNotice(null), 8000);
      return () => window.clearTimeout(timer);
    }
    if (!notice?.callId || noticeStatus === 'in_progress') return;
    if (noticeStatus && noticeStatus !== 'ringing') {
      setNotice(null);
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), RINGING_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, noticeStatus]);

  const consent = consentSent ?? member.consent.practice;
  const voice = voiceState(member, sample, left);
  const { before, now, max } = member.readiness;
  const inviteUrl = member.invite_link ? fullUrl(member.invite_link, base) : '';
  const phoneUrl = fullUrl(member.phone_link, base);

  const toggleConsent = async (next: boolean) => {
    setConsentBusy(true);
    setNotice(null);
    try {
      await api.setConsent(member.id, { consent_practice: next });
      setConsentSent(next);
      onChanged();
    } catch (error) {
      setNotice({ tone: 'bad', text: errorText(error) });
    } finally {
      setConsentBusy(false);
    }
  };

  const removeVoice = async () => {
    setRemoving(true);
    setNotice(null);
    try {
      await api.deleteVoice(member.id);
      setConfirmRemove(false);
      setNotice({ tone: 'good', text: `${member.name}'s cloned voice is deleted. No practice call will sound like ${member.name} now.` });
      onChanged();
    } catch (error) {
      setNotice({ tone: 'bad', text: errorText(error, `${member.name}'s voice wasn't deleted. Please try again.`) });
    } finally {
      setRemoving(false);
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

  const role = [capitalise(member.relationship), member.is_organiser ? 'Organiser' : null].filter(Boolean).join(' · ');

  let welcome: React.ReactNode;
  if (!member.joined) {
    welcome = <span className="fh-fact-value quiet">Rings when they join</span>;
  } else if (welcomeLive) {
    welcome = (
      <Link to={`/calls/${welcomeLive.call_id}`} className="fh-fact-value live">
        {welcomeLive.status === 'ringing' ? 'Ringing now' : 'On the call'} <ArrowRight size={14} />
      </Link>
    );
  } else if (welcomeDone) {
    welcome = (
      <span className="fh-fact-value good">
        <Check size={15} aria-hidden="true" /> Done
        {sample?.call_id ? (
          <Link to={`/calls/${sample.call_id}`} className="fh-inline-link">
            Listen back
          </Link>
        ) : null}
      </span>
    );
  } else if (sample === undefined) {
    welcome = <span className="fh-fact-value quiet">Checking…</span>;
  } else {
    welcome = (
      <button type="button" className="fh-chip-button strong" onClick={welcomeCall} disabled={welcomeBusy || left}>
        <PhoneIncoming size={15} /> {welcomeBusy ? 'Calling…' : 'Start welcome call'}
      </button>
    );
  }

  return (
    <li className={`fh-member${member.joined ? '' : ' not-joined'}${left ? ' has-left' : ''}`}>
      <div className="fh-member-main">
        <Avatar initials={initials} color={color} size="md" />
        <div className="fh-member-name">
          <h3>{member.name}</h3>
          <span>{role}</span>
        </div>

        <div className="fh-member-state">
          {left ? (
            <span className="fh-tag quiet">Left Callback</span>
          ) : member.joined ? (
            <span className="fh-tag good">
              <Check size={13} aria-hidden="true" />
              Joined{member.joined_at ? ` ${joinedFormat.format(new Date(member.joined_at))}` : ''}
            </span>
          ) : (
            <span className="fh-tag wait">Invite not opened yet</span>
          )}
          {member.joined && !left ? (
            <span className={`fh-phone-dot${member.phone_online ? ' on' : ''}`}>
              {member.phone_online ? 'Phone open' : 'Phone closed'}
            </span>
          ) : null}
          {member.phone_number ? <span className="fh-phone-number">{member.phone_number}</span> : null}
        </div>

        <div className="fh-member-ready" aria-label={`Readiness ${before} before practice, ${now} now, out of ${max}`}>
          <span className="fh-member-ready-label">Readiness</span>
          <strong>
            {before}
            <ArrowRight size={15} aria-hidden="true" />
            <em>{now}</em>
            <small>/{max}</small>
          </strong>
        </div>

        <Link to={`/family/${familyId}/members/${member.id}`} className="fh-member-open" aria-label={`Open ${member.name}'s page`}>
          <span>Open</span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </div>

      <dl className="fh-member-facts">
        <div>
          <dt>Practice calls</dt>
          <dd>
            <Switch
              checked={consent}
              label={`${member.name} agrees to practice calls`}
              onText="Agreed"
              offText="Not agreed"
              busy={consentBusy}
              disabled={left}
              onChange={(next) => void toggleConsent(next)}
            />
          </dd>
        </div>
        <div>
          <dt>Voice</dt>
          <dd>
            <span className={`fh-fact-value ${voice.tone}`}>
              {voice.tone === 'good' ? <Check size={15} aria-hidden="true" /> : null}
              {voice.text}
              {member.voice_ready && !confirmRemove ? (
                <button
                  type="button"
                  className="fh-text-button quiet"
                  onClick={() => setConfirmRemove(true)}
                  aria-label={`Remove ${member.name}'s cloned voice`}
                >
                  Remove
                </button>
              ) : null}
            </span>
            {voice.detail ? (
              <small className="fh-fact-detail" title={voice.detail}>
                {voice.detail}
              </small>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Welcome call</dt>
          <dd>{welcome}</dd>
        </div>
        {member.joined ? (
          <div className="fh-fact-links">
            <dt className="fh-visually-hidden">Links</dt>
            <dd>
              <button
                type="button"
                className="fh-text-button"
                onClick={() => setLinksOpen((open) => !open)}
                aria-expanded={linksOpen}
              >
                <Link2 size={15} aria-hidden="true" /> Phone link
              </button>
            </dd>
          </div>
        ) : null}
      </dl>

      {!member.joined && !left ? (
        <div className="fh-invite">
          {inviteUrl ? (
            <>
              <div className="fh-invite-text">
                <strong>Invite link</strong>
                <span>Send it to {member.name}. Opening it on their phone joins them and starts the welcome call.</span>
              </div>
              <code className="fh-link-text">{inviteUrl}</code>
              <div className="fh-invite-actions">
                <CopyButton text={inviteUrl} owner={member.name} what="invite link" />
                <ShareButton url={inviteUrl} name={member.name} familyName={familyName} />
                <button
                  type="button"
                  className="fh-chip-button"
                  onClick={() => setQrOpen((open) => !open)}
                  aria-expanded={qrOpen}
                  aria-label={qrOpen ? `Hide ${member.name}'s QR code` : `Show ${member.name}'s QR code`}
                >
                  <QrCode size={15} /> <span>{qrOpen ? 'Hide code' : 'QR code'}</span>
                </button>
              </div>
              {qrOpen ? (
                <div className="fh-qr">
                  <LinkQrCode url={inviteUrl} owner={member.name} size={148} />
                  <span>Scan with {member.name}'s phone camera.</span>
                </div>
              ) : null}
            </>
          ) : (
            <p className="fh-invite-text">
              <span>
                Invite links show only for the organiser.{' '}
                <Link to="/login" className="fh-inline-link">
                  Log in
                </Link>{' '}
                to send {member.name} theirs.
              </span>
            </p>
          )}
        </div>
      ) : null}

      {member.joined && linksOpen ? (
        <div className="fh-invite">
          <div className="fh-invite-text">
            <strong>Phone link</strong>
            <span>{member.name}'s own page, where practice calls ring. Use it to open their phone again.</span>
          </div>
          <code className="fh-link-text">{phoneUrl}</code>
          <div className="fh-invite-actions">
            <CopyButton text={phoneUrl} owner={member.name} what="phone link" />
            <a href={phoneUrl} target="_blank" rel="noreferrer" className="fh-chip-button">
              Open here
            </a>
          </div>
          <div className="fh-qr">
            <LinkQrCode url={phoneUrl} owner={member.name} size={132} />
          </div>
        </div>
      ) : null}

      {confirmRemove && member.voice_ready ? (
        <div className="fh-row-confirm" role="group" aria-label={`Remove ${member.name}'s voice`}>
          <span>
            Delete {member.name}'s cloned voice for good? Practice calls stop sounding like {member.name} straight
            away. A new voice needs {member.name}'s yes again.
          </span>
          <div>
            <button type="button" className="fh-chip-button danger" onClick={removeVoice} disabled={removing}>
              {removing ? 'Deleting…' : 'Delete the voice'}
            </button>
            <button type="button" className="fh-chip-button" onClick={() => setConfirmRemove(false)} disabled={removing}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      {/* Once the week shows the welcome call ringing, the Welcome call cell links to it instead. */}
      {notice && !(notice.callId && welcomeLive) ? (
        <div className={`fh-row-notice ${notice.tone}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>
          <span>
            {notice.callId && noticeStatus === 'in_progress' ? `${member.name} answered the welcome call` : notice.text}
          </span>
          {notice.callId ? (
            <Link to={`/calls/${notice.callId}`} className="fh-inline-link">
              Watch the call
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
