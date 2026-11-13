import { ShieldAlert } from 'lucide-react';
import { familyData } from '../../data/mockData';
import { StatCard } from '../molecules/StatCard';

export function FamilyOverview() {
  return (
    <section className="content-panel">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">Family readiness</span>
          <h2>Habit strength is trending up</h2>
        </div>
        <span className="status-pill good">+19% in 2 weeks</span>
      </div>

      <div className="stats-grid">
        <StatCard label="Overall readiness" value={`${familyData.readiness.now}%`} note="up from 62% before practice" icon={<ShieldAlert size={18} />} />
        <StatCard label="Safe word recall" value="92%" note="This week’s strongest habit" />
        <StatCard label="Family number" value="Ready" note="Saved and tested" />
      </div>
    </section>
  );
}
