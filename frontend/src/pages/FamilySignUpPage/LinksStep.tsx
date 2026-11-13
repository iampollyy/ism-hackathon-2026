// Step 3: each member's phone link as a QR code, with the link to copy.
// Watches the family every 3 s, so a card shows when that phone is open.

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { api } from '../../api/client';
import { Avatar } from '../../components/atoms/Avatar';
import { avatarColor, initials, type SignUpMember } from './signUpTypes';
import { CopyButton, PhoneAddressNote, PhoneQrCode, phoneUrl, usePhoneAddress } from './phoneLinks';

type Props = {
  familyId: string;
  members: SignUpMember[];
  onBack: () => void;
  onDone: () => void;
};

export function LinksStep({ familyId, members, onBack, onDone }: Props) {
  const [base, setBase] = usePhoneAddress();
  const [online, setOnline] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(members.map((member) => [member.id, Boolean(member.phoneOnline)])),
  );

  useEffect(() => {
    let live = true;
    const load = () =>
      api.getFamily(familyId).then(
        (family) => live && setOnline(Object.fromEntries(family.members.map((member) => [member.id, member.phone_online]))),
        () => undefined, // the dots simply stay as they were
      );
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [familyId]);

  return (
    <div className="links-step">
      <div className="auth-card signup-card">
        <div className="auth-card-header">
          <div>
            <small>Step 3 of 3</small>
            <h2>Each person's phone</h2>
          </div>
          <span className="mini-badge">
            {members.filter((member) => online[member.id]).length} of {members.length} open
          </span>
        </div>
        <p className="step-intro">
          Each person scans their own code with their phone's camera, then keeps that page open with the sound on.
          Practice calls ring there. Nothing to install.
        </p>
        <PhoneAddressNote base={base} onChange={setBase} />
      </div>

      <div className="link-grid">
        {members.map((member, index) => {
          const url = phoneUrl(member.phone_link, base);
          const isOnline = online[member.id];
          return (
            <section key={member.id} className="link-card">
              <header className="member-card-head">
                <Avatar initials={initials(member.name)} color={avatarColor(index)} />
                <div>
                  <h4>{member.name}</h4>
                  {member.relationship ? <p>{member.relationship}</p> : null}
                </div>
              </header>
              <div className="qr-frame">
                <PhoneQrCode url={url} owner={member.name} size={176} />
              </div>
              <span className={`phone-dot${isOnline ? ' on' : ''}`}>
                {isOnline ? 'Phone open' : 'Not opened yet'}
              </span>
              <code className="link-text">{url}</code>
              <CopyButton text={url} label="Copy link" owner={member.name} />
            </section>
          );
        })}
      </div>

      <div className="step-footer">
        <button type="button" className="button button-secondary" onClick={onBack}>
          <ArrowLeft size={16} /> Voices
        </button>
        <span>You can find these links again on the family page.</span>
        <button type="button" className="button button-primary" onClick={onDone}>
          Open the family page <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
