import { ActivityItem } from '../molecules/ActivityItem';
import { familyData } from '../../data/mockData';
import { CalendarClock, Check, ListChecks } from 'lucide-react';

export function WeeklyActivity() {
  return (
    <section className="content-panel">
      <div className="section-heading-row compact">
        <div>
          <span className="eyebrow">Activity</span>
          <h2>Recent and planned reminders</h2>
        </div>
      </div>

      <div className="activity-stack">
        {familyData.week.recent.map((item, index) => (
          <ActivityItem key={item} title={item} meta="Completed this week" icon={<Check size={16} />} />
        ))}
        {familyData.week.planned.map((item) => (
          <ActivityItem key={item} title={item} meta="Planned" icon={<CalendarClock size={16} />} />
        ))}
      </div>
    </section>
  );
}
