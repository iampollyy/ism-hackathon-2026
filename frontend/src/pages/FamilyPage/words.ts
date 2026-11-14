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
    case 'failed': return "Didn't go ahead";
    case 'sent': return 'Sent';
    case 'read': return 'Read';
    default: return status.replace(/_/g, ' ');
  }
}

/** Statuses of a call that is still to come or happening now. */
export function isLiveStatus(status: string | undefined): boolean {
  return status === 'scheduled' || status === 'ringing' || status === 'in_progress';
}

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** "Today, 14:05", "Tomorrow, 09:00" or "Fri 13 Nov, 14:05" (this computer's time). */
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

// ---------------------------------------------------------------- the family's time zone

/** The day (yyyy-mm-dd) and the hour of day (0 to 24, with minutes as a fraction) in a time zone. */
export type ZonedTime = { dayKey: string; hour: number };

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone });
  } catch {
    // An unknown zone: this computer's time is the best guess.
    return new Intl.DateTimeFormat('en-GB', options);
  }
}

export function zonedTime(date: Date, timeZone: string): ZonedTime {
  const parts = Object.fromEntries(zoneFormat(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
  const hour = (Number(parts.hour) % 24) + Number(parts.minute) / 60;
  return { dayKey: `${parts.year}-${parts.month}-${parts.day}`, hour };
}

/** "Vilnius" from "Europe/Vilnius", "New York" from "America/New_York". */
export function zoneCity(timeZone: string): string {
  const last = timeZone.split('/').pop() ?? timeZone;
  return last.replace(/_/g, ' ');
}

/** This computer's time zone, or null when the browser does not say. */
export function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** "Today, 14:05" or "Mon 16 Nov, 11:41", in the family's time zone. */
export function whenInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const then = zonedTime(date, timeZone);
  const today = zonedTime(new Date(), timeZone);
  const tomorrow = zonedTime(new Date(Date.now() + 86_400_000), timeZone);
  let time: string;
  let day: string;
  try {
    time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(date);
    day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(date);
  } catch {
    time = timeFormat.format(date);
    day = dayFormat.format(date);
  }
  if (then.dayKey === today.dayKey) return `Today, ${time}`;
  if (then.dayKey === tomorrow.dayKey) return `Tomorrow, ${time}`;
  return `${day}, ${time}`;
}

/** Whole days from now until an ISO time (0 when it has passed). */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
}

// ---------------------------------------------------------------- errors

export function errorText(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** A 409 (or other) error from starting a call, in plain words. */
export function callErrorText(error: unknown, targetName: string, voiceName?: string): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'phone_offline':
      return `Open ${targetName}'s phone link first. A call can only ring while that page is open.`;
    case 'consent_missing':
      return /left Callback|opted out/i.test(error.message)
        ? `${targetName} has left Callback, so no calls go to them.`
        : `${targetName} hasn't agreed to practice calls yet. When they say yes, switch on "Practice calls" in their row.`;
    case 'voice_not_ready':
      return voiceName
        ? `${voiceName}'s voice isn't ready yet. It's made from their welcome call, or choose another voice.`
        : error.message;
    case 'busy':
      return `${targetName} is already on a call. Try again when it ends.`;
    case 'daily_limit':
      return "Today's limit for calls is reached. Please try again tomorrow.";
    case 'shield_off':
      return 'Callback Shield is switched off. Switch it on under Protection first.';
    case 'not_eligible':
      // The back end's sentence already says who and why, in plain words.
      return error.message;
    default:
      return error.message;
  }
}
