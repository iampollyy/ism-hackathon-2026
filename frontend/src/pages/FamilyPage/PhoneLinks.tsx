// Each member's phone link, to copy or scan again (for re-opening a phone).

import { useState } from 'react';
import { QrCode } from 'lucide-react';
import type { MemberView } from '../../api/types';
import { CopyButton, PhoneAddressNote, PhoneQrCode, phoneUrl, usePhoneAddress } from '../FamilySignUpPage/phoneLinks';

export function PhoneLinks({ members }: { members: MemberView[] }) {
  const [base, setBase] = usePhoneAddress();
  const [shownQr, setShownQr] = useState<string | null>(null);

  return (
    <section id="links" className="content-panel links-panel">
      <div className="section-heading-row compact">
        <div>
          <span className="eyebrow">Phone links</span>
          <h2>Open a phone again</h2>
        </div>
      </div>
      <PhoneAddressNote base={base} onChange={setBase} compact />

      <ul className="phone-link-list">
        {members.map((member) => {
          const url = phoneUrl(member.phone_link, base);
          const open = shownQr === member.id;
          return (
            <li key={member.id}>
              <div className="phone-link-head">
                <strong>{member.name}</strong>
                <span className={`phone-dot${member.phone_online ? ' on' : ''}`}>
                  {member.phone_online ? 'Open' : 'Closed'}
                </span>
              </div>
              <code className="link-text">{url}</code>
              <div className="phone-link-actions">
                <CopyButton text={url} owner={member.name} />
                <button
                  type="button"
                  className="button button-ghost copy-button"
                  onClick={() => setShownQr(open ? null : member.id)}
                  aria-expanded={open}
                  aria-label={open ? `Hide ${member.name}'s QR code` : `Show ${member.name}'s QR code`}
                >
                  <QrCode size={15} /> {open ? 'Hide code' : 'QR code'}
                </button>
              </div>
              {open ? (
                <div className="qr-frame">
                  <PhoneQrCode url={url} owner={member.name} size={156} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
