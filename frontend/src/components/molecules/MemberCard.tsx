import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Avatar } from '../atoms/Avatar';
import type { FamilyMember } from '../../types/family';

export function MemberCard({ member }: { member: FamilyMember }) {
  return (
    <div className="member-card" style={{ borderColor: `${member.accent}33` }}>
      <div className="member-card-row">
        <div className="member-card-head">
          <Avatar initials={member.name.slice(0, 2).toUpperCase()} color={member.accent} size="md" />
          <div>
            <h4>{member.name}</h4>
            <p>{member.relationship}</p>
          </div>
        </div>
        <span className="member-card-tag">
          <ShieldCheck size={14} />
          {member.consent ? 'Consent ready' : 'Needs consent'}
        </span>
      </div>

      <div className="member-card-metric">
        <div>
          <label>Readiness</label>
          <strong>{member.readiness.now}%</strong>
        </div>
        <div className="member-card-arrow">
          <ArrowRight size={15} />
        </div>
      </div>

      <div className="member-weak-spot">
        <small>Focus</small>
        <p>{member.weakSpot}</p>
      </div>
    </div>
  );
}
