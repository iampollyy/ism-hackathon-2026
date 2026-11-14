// Everyone in the family, one row each (MemberRow), with the address note
// for phones when the links would point at this laptop.

import type { FamilyView, ProtectionView, VoiceSampleStatus } from '../../api/types';
import { MemberRow } from './MemberRow';
import type { Person } from './people';
import { PhoneAddressNote, usePhoneAddress } from './links';

type Props = {
  family: FamilyView;
  protection: ProtectionView | null;
  samples: Record<string, VoiceSampleStatus>;
  people: Record<string, Person>;
  onChanged: () => void;
};

export function MemberRoster({ family, protection, samples, people, onChanged }: Props) {
  const [base, setBase] = usePhoneAddress();
  const members = family.members;
  const joined = members.filter((member) => member.joined).length;
  const waiting = members.length - joined;

  return (
    <section id="members" className="fh-panel fh-roster" aria-labelledby="members-title">
      <div className="fh-panel-head">
        <h2 id="members-title">The family</h2>
        <span className="fh-panel-count">
          {joined} of {members.length} joined
        </span>
      </div>
      <p className="fh-panel-note">
        {waiting > 0
          ? `Send each person their invite link. When they open it on their phone and join, the welcome call starts by itself.`
          : "Everyone has joined. Each person can change their practice consent on their phone, and you can switch it here too."}
      </p>
      <PhoneAddressNote base={base} onChange={setBase} />

      <ul className="fh-member-list">
        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            color={people[member.id]?.color ?? '#213d52'}
            initials={people[member.id]?.initials ?? '?'}
            familyId={family.id}
            familyName={family.name}
            sample={member.joined ? samples[member.id] : undefined}
            week={family.week}
            left={protection?.members.find((entry) => entry.member_id === member.id)?.reason_if_not === 'Has left Callback.'}
            base={base}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  );
}
