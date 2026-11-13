type ProgressBarProps = {
  value: number;
  max?: number;
  color?: string;
};

export function ProgressBar({ value, max = 100, color = '#e76d52' }: ProgressBarProps) {
  const pct = Math.min((value / max) * 100, 100);

  return (
    <div className="progress-shell" aria-label={`Progress ${value} of ${max}`}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
