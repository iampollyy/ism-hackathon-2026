import type { ReactNode } from 'react';

type BadgeProps = {
  children: ReactNode;
  tone?: 'accent' | 'good' | 'neutral';
};

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
