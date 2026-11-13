type TacticProps = {
  label: string;
  active?: boolean;
};

export function TacticBadge({ label, active = false }: TacticProps) {
  return <span className={`tactic-badge ${active ? 'active' : ''}`}>{label}</span>;
}
