import type { ReactNode } from 'react';

type StatCardProps = {
  label: string;
  value: string;
  note?: string;
  icon?: ReactNode;
};

export function StatCard({ label, value, note, icon }: StatCardProps) {
  return (
    <div className="stat-card surface-card">
      <div className="stat-card-top">
        <span className="stat-label">{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}
