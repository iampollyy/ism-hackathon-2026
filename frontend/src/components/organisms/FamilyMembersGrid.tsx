import { familyData } from '../../data/mockData';
import { MemberCard } from '../molecules/MemberCard';

export function FamilyMembersGrid() {
  return (
    <section id="members" className="content-panel">
      <div className="section-heading-row compact">
        <div>
          <span className="eyebrow">Members</span>
          <h2>Who needs the next practice?</h2>
        </div>
      </div>

      <div className="member-grid">
        {familyData.members.map((member) => (
          <MemberCard key={member.id} member={member} />
        ))}
      </div>
    </section>
  );
}
