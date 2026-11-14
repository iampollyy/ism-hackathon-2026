// One person in the family list: who they are, whether they joined (with
// their invite link to copy, share or scan if not), their phone, practice
// consent, their voice, the welcome call, readiness before and now, and the
// way to their own page.
//
// On a phone (compact) the row is a small card: the name, where things stand
// as badges, one main action (Share the invite, or Open their page), and the
// rest behind Details.
//
// Practice consent is the person's own: only they say yes, on their phone.
// Here the organiser can only switch it off (after a short confirm); while it
// is off the cell says what it is waiting for instead of offering a switch.

import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, ChevronRight, Link2, PhoneIncoming, QrCode } from 'lucide-react';
import { api } from '../../api/client';
import type { MemberView, VoiceSampleStatus, WeekItem } from '../../api/types';
import { Avatar } from '../../components/atoms/Avatar';
import { CopyButton, fullUrl, LinkQrCode, ShareButton } from './links';
import { Switch } from './Switch';
import { callErrorText, capitalise, errorText, possessive } from './words';

type Props = {
  member: MemberView;
  color: string;
  initials: string;
  familyId: string;
  familyName: string;
  /** The organiser's first name, who sends the invites. */
  organiserName: string | null;
  /** undefined until loaded; only fetched for members who joined. */
  sample: VoiceSampleStatus | undefined;
  week: WeekItem[];
  left: boolean;
  base: string;
  onChanged: () => void;
  /** A small card with details behind a toggle, for phones. */
  compact?: boolean;
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

export function MemberRow({
  member, color, initials, familyId, familyName, organiserName, sample, week, left, base, onChanged, compact = false,
}: Props) {
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const withdrawRef = useRef<HTMLDivElement>(null);
  // The withdrawal just sent, shown until the next refresh of the family agrees.
  const [consentSent, setConsentSent] = useState<false | null>(null);
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (consentSent !== null && member.consent.practice === consentSent) setConsentSent(null);
  }, [member.consent.practice, consentSent]);

  // The question takes the focus when it opens, so the keyboard and screen readers go there next.
  useEffect(() => {
    if (confirmWithdraw) withdrawRef.current?.focus();
  }, [confirmWithdraw]);

  const keepConsent = () => {
    setConfirmWithdraw(false);
    rowRef.current?.querySelector<HTMLElement>('[role=switch]')?.focus();
  };

  // They withdrew on their phone meanwhile: nothing left to confirm.
  useEffect(() => {
    if (!member.consent.practice) setConfirmWithdraw(false);
  }, [member.consent.practice]);

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

  // The organiser can only withdraw: a yes comes from the person, on their phone.
  const withdrawConsent = async () => {
    setConsentBusy(true);
    setNotice(null);
    try {
      await api.setConsent(member.id, { consent_practice: false });
      setConsentSent(false);
      setConfirmWithdraw(false);
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
  const theirPhone = `${possessive(member.relationship)} phone`;

  let practice: React.ReactNode;
  if (consent && !left) {
    practice = (
      <Switch
        checked
        label={`Practice calls for ${member.name}: agreed. Switch off to withdraw`}
        onText="Agreed"
        busy={consentBusy}
        onChange={() => setConfirmWithdraw((open) => !open)}
      />
    );
  } else {
    const detail = left
      ? `${member.name} has left Callback`
      : !member.joined
        ? 'Invite not opened yet'
        : `Waiting for ${member.name} to say yes on ${theirPhone}`;
    practice = (
      <>
        <span className={`fh-fact-value ${left || !member.joined ? 'quiet' : 'wait'}`}>Not agreed</span>
        <small className="fh-fact-detail">{detail}</small>
      </>
    );
  }

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

  // The card on a phone: badges for where things stand, one main action.
  const badges: { text: string; tone: 'good' | 'wait' | 'quiet' }[] = [
    left
      ? { text: 'Left Callback', tone: 'quiet' }
      : member.joined
        ? { text: 'Joined', tone: 'good' }
        : { text: 'Not joined yet', tone: 'wait' },
  ];
  if (!left) {
    badges.push(consent ? { text: 'Practice agreed', tone: 'good' } : { text: 'Practice not agreed yet', tone: 'quiet' });
    badges.push(
      voice.tone === 'good'
        ? { text: 'Voice ready', tone: 'good' }
        : { text: `Voice: ${voice.text.toLowerCase()}`, tone: voice.tone === 'quiet' ? 'quiet' : 'wait' },
    );
    if (member.joined) badges.push(member.phone_online ? { text: 'Phone open', tone: 'good' } : { text: 'Phone closed', tone: 'quiet' });
  }

  const openLink = (
    <Link to={`/family/${familyId}/members/${member.id}`} className="fh-member-open" aria-label={`Open ${member.name}'s page`}>
      <span>Open</span>
      <ChevronRight size={16} aria-hidden="true" />
    </Link>
  );

  const compactHead = (
    <>
      <div className="fh-mc">
        <Avatar initials={initials} color={color} size="md" />
        <div className="fh-mc-who">
          <h3>{member.name}</h3>
          <span>{role}</span>
        </div>
        <div className="fh-mc-action">
          {!member.joined && !left && inviteUrl ? (
            <ShareButton url={inviteUrl} name={member.name} familyName={familyName} from={organiserName} own={member.is_organiser} />
          ) : (
            openLink
          )}
        </div>
      </div>
      <ul className="fh-mc-badges" aria-label={`Where ${member.name} stands`}>
        {badges.map((badge) => (
          <li key={badge.text} className={`fh-tag ${badge.tone}`}>
            {badge.tone === 'good' ? <Check size={13} aria-hidden="true" /> : null}
            {badge.text}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="fh-mc-toggle"
        aria-expanded={detailsOpen}
        aria-controls={detailsOpen ? detailsId : undefined}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        {detailsOpen ? 'Hide details' : !member.joined && !left ? 'Details, link and QR code' : 'Details'}
        <ChevronDown size={16} aria-hidden="true" className={detailsOpen ? 'up' : undefined} />
      </button>
    </>
  );

  const head = (
    <>
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
    </>
  );

  const details = (
    <>
        <dl className="fh-member-facts">
          <div>
            <dt>Practice calls</dt>
            <dd>{practice}</dd>
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
                  <ShareButton
                    url={inviteUrl}
                    name={member.name}
                    familyName={familyName}
                    from={organiserName}
                    own={member.is_organiser}
                  />
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
    </>
  );

  return (
    <li ref={rowRef} className={`fh-member${member.joined ? '' : ' not-joined'}${left ? ' has-left' : ''}`}>
      {compact ? compactHead : head}

      {compact ? (
        detailsOpen ? (
          <div className="fh-member-details" id={detailsId}>
            <p className="fh-mc-ready">
              Readiness <strong>{before} → {now}</strong> of {max}
            </p>
            {details}
          </div>
        ) : null
      ) : (
        details
      )}

      {confirmWithdraw && consent && !left ? (
        <div
          ref={withdrawRef}
          className="fh-row-confirm"
          role="group"
          aria-label={`Switch off ${member.name}'s practice calls`}
          tabIndex={-1}
        >
          <span>
            Switch off {member.name}'s practice calls? Only {member.name} can switch them on again, from {theirPhone}.
          </span>
          <div>
            <button type="button" className="fh-chip-button danger" onClick={() => void withdrawConsent()} disabled={consentBusy}>
              {consentBusy ? 'Switching off…' : 'Switch off'}
            </button>
            <button type="button" className="fh-chip-button" onClick={keepConsent} disabled={consentBusy}>
              Keep them on
            </button>
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
