// One switch for the page (role="switch"), with its state in words beside it.

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What it switches, for screen readers ("Practice calls for Sara"). */
  label: string;
  onText?: string;
  offText?: string;
  disabled?: boolean;
  busy?: boolean;
  /** 'dark' for the navy protection panel. */
  surface?: 'light' | 'dark';
  size?: 'md' | 'lg';
  /** 'neutral': on, but not a green "all good" (on for someone a drill cannot reach yet). */
  tone?: 'good' | 'neutral';
};

export function Switch({
  checked, onChange, label, onText = 'On', offText = 'Off', disabled = false, busy = false, surface = 'light', size = 'md',
  tone = 'good',
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      className={`fh-switch ${surface} ${size}${checked ? ' on' : ''}${tone === 'neutral' ? ' neutral' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled || busy}
    >
      <span className="fh-switch-track" aria-hidden="true" />
      <span className="fh-switch-text">{checked ? onText : offText}</span>
    </button>
  );
}
