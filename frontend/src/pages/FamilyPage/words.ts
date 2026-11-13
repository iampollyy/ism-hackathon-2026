// Plain words for the family page: statuses, errors, times.

import { ApiError } from '../../api/client';
import type { ScenarioKey, ScenarioView } from '../../api/types';

export function scenarioTitle(key: ScenarioKey | string, scenarios: ScenarioView[]): string {
  const found = scenarios.find((scenario) => scenario.key === key);
  if (found) return found.title;
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const DIFFICULTY_WORDS: Record<number, string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

/** A week item's or a plan step's status, in plain words. */
export function statusWords(status: string): string {
  switch (status) {
    case 'scheduled': return 'Planned';
    case 'planned': return 'Planned';
    case 'ringing': return 'Ringing now';
    case 'in_progress': return 'On the call now';
    case 'ended': return 'Just ended';
    case 'scored': return 'Done';
    case 'done': return 'Done';
    case 'declined': return 'Declined';
    case 'missed': return 'Missed';
    case 'failed': return "Didn't connect";
    case 'sent': return 'Sent';
    case 'read': return 'Read';
    default: return status.replace(/_/g, ' ');
  }
}

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** "Today, 14:05", "Tomorrow, 09:00" or "Fri 13 Nov, 14:05". */
export function whenWords(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const today = new Date();
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(today)) / 86_400_000);
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : dayFormat.format(date);
  return `${day}, ${timeFormat.format(date)}`;
}

export function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** A 409 (or other) error from starting a call, in plain words. */
export function callErrorText(error: unknown, targetName: string, voiceName?: string): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'phone_offline':
      return `Open ${targetName}'s phone link first. A call can only ring while that page is open.`;
    case 'consent_missing':
      return /left Callback/i.test(error.message)
        ? error.message
        : `${targetName} hasn't agreed to practice calls yet. When they say yes, switch on "Practice calls" on their card.`;
    case 'voice_not_ready':
      return voiceName
        ? `${voiceName}'s voice isn't ready yet. Record it first, or choose another voice.`
        : error.message;
    case 'busy':
      return `${targetName} is already on a call. Try again when it ends.`;
    case 'daily_limit':
      return "Today's limit for calls is reached. Please try again tomorrow.";
    default:
      return error.message;
  }
}
