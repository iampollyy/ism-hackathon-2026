// Each person's avatar on the family page, and whether they are the organiser
// (whose own drills stay a surprise too, so their times are never shown).

import type { MemberView } from '../../api/types';

export type Person = { initials: string; color: string; organiser: boolean };

// Each at least 4.5:1 behind white initials; no red, which means a scam here.
const AVATAR_COLORS = ['#735ac8', '#138653', '#4e38b2', '#a8457a', '#2f6f8f', '#8a5a44'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function peopleOf(members: MemberView[]): Record<string, Person> {
  return Object.fromEntries(
    members.map((member, index) => [
      member.id,
      { initials: initials(member.name), color: AVATAR_COLORS[index % AVATAR_COLORS.length], organiser: member.is_organiser },
    ]),
  );
}
