// Step 2: each person's invite link (/join/{member_id}) as a QR code, with
// Copy and Share. Opening it on their phone and tapping Join starts their
// welcome call by itself. The page refreshes the family every few seconds,
// so a card turns green the moment that person joins. Recording a voice
// sample here is optional: voices now come from the welcome call.

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CircleCheck, Mic, Smartphone } from 'lucide-react';
import type { FamilyView, MemberView } from '../../api/types';
import { Avatar } from '../../components/atoms/Avatar';
import { firstName } from '../../layouts/useMe';
import { CopyButton, PhoneAddressNote, PhoneQrCode, ShareButton, phoneUrl, shownUrl, usePhoneAddress } from './phoneLinks';
import { avatarColor, initials, type SignUpMember } from './signUpTypes';
import { VoiceStep } from './VoiceStep';

const timeFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function joinedWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : timeFormat.format(date);
}

type Props = {
  family: FamilyView;
  voicesOpen: boolean;
  onVoicesOpen: (open: boolean) => void;
  onVoiceReady: (memberId: string) => void;
  onNext: () => void;
};

export function InviteStep({ family, voicesOpen, onVoicesOpen, onVoiceReady, onNext }: Props) {
  const navigate = useNavigate();
  const [base, setBase] = usePhoneAddress();
  const members = family.members;
  const joined = members.filter((member) => member.joined).length;
  const hiddenLinks = members.some((member) => !member.invite_link);
  const organiser = members.find((member) => member.is_organiser);
  const from = organiser ? firstName(organiser.name) : null;

  // Opened from the family page's "Record a voice" link: go straight to the
  // recorder. Only on arrival; opening it later by hand should not jump the page.
  const openOnArrival = useRef(voicesOpen);
  useEffect(() => {
    if (openOnArrival.current) document.getElementById('voices')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const voiceMembers: SignUpMember[] = members.map((member) => ({
    id: member.id,
    name: member.name,
    phone_link: member.phone_link,
    relationship: member.relationship,
    voiceStatus: member.voice_status,
    phoneOnline: member.phone_online,
    isOrganiser: member.is_organiser,
    // Their own yes to a copy of their voice, given on their phone. The organiser,
    // before joining, is the one at this laptop: their recording opens with it.
    voiceAllowed: member.consent.clone || (member.is_organiser && !member.joined),
  }));

  return (
    <div className="onb-invite">
      <ol className="onb-how" aria-label="What each person does">
        <li>
          <span className="onb-how-icon" aria-hidden="true">
            <Smartphone size={18} />
          </span>
          <span>
            <strong>Open their link</strong>
            <small>On their own phone, from WhatsApp or the QR code.</small>
          </span>
        </li>
        <li>
          <span className="onb-how-icon" aria-hidden="true">
            <CircleCheck size={18} />
          </span>
          <span>
            <strong>Agree and tap Join</strong>
            <small>Two ticks they can change later, and a phone number if they like.</small>
          </span>
        </li>
        <li>
          <span className="onb-how-icon" aria-hidden="true">
            <Mic size={18} />
          </span>
          <span>
            <strong>The welcome call starts</strong>
            <small>A few minutes with a friendly voice. Sound on, somewhere quiet.</small>
          </span>
        </li>
      </ol>

      <PhoneAddressNote base={base} onChange={setBase} />

      {hiddenLinks ? (
        <div className="form-alert" role="note">
          Invite links are only shown to the organiser who set up this family. Log in with that account to see them.
        </div>
      ) : null}

      <div className="onb-invite-summary" role="status" aria-live="polite">
        <span className={`onb-joined-count${joined === members.length ? ' all' : ''}`}>
          {joined === members.length
            ? 'Everyone has joined'
            : `${joined} of ${members.length} joined`}
        </span>
        <span className="onb-live-dot">Updates by itself</span>
      </div>

      <div className="onb-invite-grid">
        {members.map((member, index) => (
          <InviteCard
            key={member.id}
            member={member}
            index={index}
            familyName={family.name}
            from={from}
            base={base}
            onJoinHere={() => navigate(`/join/${member.id}`)}
          />
        ))}
      </div>

      <section className={`onb-voices${voicesOpen ? ' open' : ''}`} id="voices">
        <button
          type="button"
          className="onb-voices-toggle"
          aria-expanded={voicesOpen}
          aria-controls="onb-voices-body"
          onClick={() => onVoicesOpen(!voicesOpen)}
        >
          <span className="onb-how-icon" aria-hidden="true">
            <Mic size={18} />
          </span>
          <span>
            <strong>Or record a voice sample now</strong>
            <small>
              Optional. Each person’s voice comes from their welcome call, after a spoken yes. If someone who has
              allowed a copy of their voice is with you, they can read a one-minute text here instead.
            </small>
          </span>
          <span className="onb-voices-action">{voicesOpen ? 'Close' : 'Record'}</span>
        </button>
        {voicesOpen ? (
          <div className="onb-voices-body" id="onb-voices-body">
            <VoiceStep embedded members={voiceMembers} onReady={onVoiceReady} />
          </div>
        ) : null}
      </section>

      <div className="onb-footer">
        <span>You can find these links again on the family page.</span>
        <button type="button" className="button button-primary" onClick={onNext}>
          Next: choose a plan <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

type CardProps = {
  member: MemberView;
  index: number;
  familyName: string;
  /** The organiser's first name, who sends the invites. */
  from: string | null;
  base: string;
  onJoinHere: () => void;
};

function InviteCard({ member, index, familyName, from, base, onJoinHere }: CardProps) {
  const url = member.invite_link ? phoneUrl(member.invite_link, base) : '';
  const when = joinedWhen(member.joined_at);

  return (
    <article className={`onb-invite-card${member.joined ? ' joined' : ''}`}>
      <header className="onb-invite-head">
        <Avatar initials={initials(member.name)} color={avatarColor(index)} />
        <div className="onb-invite-who">
          <h3 title={member.name}>{member.name}</h3>
          <p>
            {member.relationship}
            {member.is_organiser ? <span className="onb-you">You</span> : null}
          </p>
        </div>
        <span className={`onb-state${member.joined ? ' joined' : member.phone_online ? ' open' : ''}`}>
          {member.joined ? 'Joined' : member.phone_online ? 'Phone open' : 'Not joined'}
        </span>
      </header>

      {member.joined ? (
        <div className="onb-joined">
          <CircleCheck size={30} aria-hidden="true" />
          <strong>{member.name} has joined</strong>
          <small>
            {when ? `On ${when}` : 'Just now'}
            {member.phone_number ? ` · ${member.phone_number}` : ''}
          </small>
        </div>
      ) : url ? (
        <div className="onb-qr">
          <PhoneQrCode url={url} owner={member.name} size={148} />
        </div>
      ) : (
        <div className="onb-qr empty">
          <span>Log in as the organiser to see {member.name}’s link.</span>
        </div>
      )}

      {url ? (
        <>
          <code className="onb-link" title={url}>
            {shownUrl(url)}
          </code>
          <div className="onb-invite-actions">
            {member.is_organiser && !member.joined ? (
              <button type="button" className="button button-primary onb-join-here" onClick={onJoinHere}>
                <Smartphone size={16} aria-hidden="true" /> Join on this phone
              </button>
            ) : null}
            <CopyButton text={url} label="Copy" owner={member.name} />
            <ShareButton url={url} name={member.name} familyName={familyName} from={from} own={member.is_organiser} />
          </div>
        </>
      ) : null}
    </article>
  );
}
