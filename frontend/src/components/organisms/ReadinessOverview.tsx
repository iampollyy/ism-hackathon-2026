import { familyData } from '../../data/mockData';
import { ProgressBar } from '../atoms/ProgressBar';

export function ReadinessOverview() {
  return (
    <section className="content-panel">
      <div className="section-heading-row compact">
        <div>
          <span className="eyebrow">This week</span>
          <h2>Personal plans</h2>
        </div>
      </div>

      <div className="readiness-list">
        {familyData.members.map((member) => (
          <div key={member.id} className="readiness-row">
            <div className="readiness-header">
              <strong>{member.name}</strong>
              <span>{member.readiness.now}%</span>
            </div>
            <ProgressBar value={member.readiness.now} color={member.accent} />
            <small>{member.plan.thisWeek}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
