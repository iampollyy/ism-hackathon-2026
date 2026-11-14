type ProgressBarProps = {
  value: number;
  max?: number;
  color?: string;
};

export function ProgressBar({ value, max = 100, color = 'var(--accent-fill)' }: ProgressBarProps) {
  const pct = Math.min((value / max) * 100, 100);

  return (
    <div className="progress-shell" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={`Progress ${value} of ${max}`}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
