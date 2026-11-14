import type { MemberView } from '../../api/types';

/** A member as the sign-up steps know them: from POST /api/families, or from
 * GET /api/families/{id} when sign-up is resumed. */
export type SignUpMember = {
  id: string;
  name: string;
  phone_link: string;
  relationship?: string;
  voiceStatus: MemberView['voice_status'];
  phoneOnline?: boolean;
  isOrganiser: boolean;
  /** They have agreed to a copy of their voice, so a sample may be recorded for them. */
  voiceAllowed: boolean;
};

const AVATAR_COLORS = ['#e0475e', '#138653', '#4e38b2', '#b77a15', '#6b5ca5', '#432fa8'];

/** Colours by position in the family (the API has no colour per person). */
export function avatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
