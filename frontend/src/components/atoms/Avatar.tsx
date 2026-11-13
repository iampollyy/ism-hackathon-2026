type AvatarProps = {
  initials: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
};

export function Avatar({ initials, color, size = 'md' }: AvatarProps) {
  const sizeClass = {
    sm: 'avatar-sm',
    md: 'avatar-md',
    lg: 'avatar-lg',
  }[size];

  return (
    <div className={`avatar ${sizeClass}`} style={{ background: color }}>
      {initials}
    </div>
  );
}
