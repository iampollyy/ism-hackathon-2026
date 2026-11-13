import type { ReactNode } from 'react';

type ActivityItemProps = {
  title: string;
  meta: string;
  icon?: ReactNode;
};

export function ActivityItem({ title, meta, icon }: ActivityItemProps) {
  return (
    <div className="activity-item">
      <div className="activity-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
    </div>
  );
}
