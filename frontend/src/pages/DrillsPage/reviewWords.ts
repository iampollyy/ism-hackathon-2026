// Plain words shared by the organiser's review screens (drills, activity, one
// person's page): times, days, outcomes. Never "failed": an outcome that was
// not safe is "a tip for next time".

import { ApiError } from '../../api/client';
import type { ActivityView, DrillList, Outcome, ProgressView } from '../../api/types';
import { duration, possessive } from '../LiveCallPage/format';
import { parseTime } from '../LiveCallPage/liveCallState';

export { possessive };

// The list items, by name (types.ts names only the lists).
export type DrillView = DrillList['drills'][number];
export type ActivityItem = ActivityView['items'][number];
export type LessonView = ProgressView['lessons'][number];

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const shortDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

function toDate(iso: string | null | undefined): Date | null {
  const ms = parseTime(iso);
  return ms === null ? null : new Date(ms);
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Whole days from today: 0 today, -1 yesterday, 1 tomorrow. */
function dayOffset(date: Date, now = new Date()): number {
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}

/** "14:05". */
export function clockTime(iso: string | null | undefined): string {
  const date = toDate(iso);
  return date ? timeFormat.format(date) : '';
}

/** "Today, 14:05", "Yesterday, 09:00", "Tomorrow, 10:41" or "Fri 13 Nov, 14:05". */
export function whenWords(iso: string | null | undefined): string {
  const date = toDate(iso);
  if (!date) return '';
  const days = dayOffset(date);
  const day = days === 0 ? 'Today' : days === -1 ? 'Yesterday' : days === 1 ? 'Tomorrow' : shortDay.format(date);
  return `${day}, ${timeFormat.format(date)}`;
}

/** A key for grouping by the local day. */
export function dayKey(iso: string | null | undefined): string {
  const date = toDate(iso);
  return date ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` : 'unknown';
}

/** "Today", "Yesterday", or "Thursday 12 November". */
export function dayHeading(iso: string | null | undefined): { title: string; detail: string | null } {
  const date = toDate(iso);
  if (!date) return { title: 'Some time ago', detail: null };
  const days = dayOffset(date);
  if (days === 0) return { title: 'Today', detail: longDay.format(date) };
  if (days === -1) return { title: 'Yesterday', detail: longDay.format(date) };
  return { title: longDay.format(date), detail: null };
}

/** "2 s" style is too terse for this audience: "2 seconds", "1 minute 5 seconds". */
export function secondsWords(seconds: number | null | undefined): string | null {
  return seconds === null || seconds === undefined || !Number.isFinite(seconds) ? null : duration(seconds);
}

export const DIFFICULTY_WORDS: Record<number, string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

export type DrillState = 'safe' | 'tip' | 'reviewing' | 'live' | 'upcoming' | 'unanswered';

/** Where a drill stands, for its colour and its words. */
export function drillState(drill: DrillView): DrillState {
  switch (drill.status) {
    case 'scheduled': return 'upcoming';
    case 'ringing':
    case 'in_progress': return 'live';
    case 'ended': return 'reviewing';
    case 'declined':
    case 'missed':
    case 'failed': return 'unanswered';
    default:
      if (!drill.outcome) return drill.status === 'scored' ? 'unanswered' : 'reviewing';
      return drill.safe ? 'safe' : 'tip';
  }
}

/** The outcome in words, with a short detail line. */
export function drillOutcomeWords(drill: DrillView): { label: string; detail: string | null } {
  const name = drill.member.name;
  const challenge = secondsWords(drill.seconds_to_challenge);
  switch (drillState(drill)) {
    case 'safe':
      return {
        label: drill.outcome_label ?? 'Did the safe thing',
        // The label already says "Hung up": the detail only adds when.
        detail: challenge ? (drill.outcome === 'hung_up' ? `After ${challenge}` : `Checked after ${challenge}`) : null,
      };
    case 'tip':
      return { label: drill.outcome_label ?? 'Took the call', detail: 'Picked up a tip for next time' };
    case 'reviewing':
      return { label: 'Being reviewed', detail: 'The lesson is on its way' };
    case 'live':
      return {
        label: drill.status === 'ringing' ? 'Ringing now' : `${name} is on the call`,
        detail: 'Open it to follow along live',
      };
    case 'upcoming':
      return {
        label: drill.scheduled_for ? `Rings ${lowerFirst(whenWords(drill.scheduled_for))}` : 'Planned',
        detail: `${name} doesn’t know when`,
      };
    case 'unanswered':
    default:
      if (drill.status === 'declined') return { label: 'Declined', detail: 'No practice this time, and that’s fine' };
      if (drill.status === 'missed') return { label: 'Not answered', detail: 'No practice this time' };
      if (drill.status === 'failed') return { label: 'Didn’t connect', detail: 'Nothing to review' };
      return { label: 'No result', detail: 'There was nothing to review' };
  }
}

/** "Today, 09:58" becomes "today, 09:58" mid-sentence; a weekday keeps its capital. */
export function lowerFirst(text: string): string {
  return /^(Today|Tomorrow|Yesterday)\b/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** Whose voice, but never while the drill has not been answered yet: a call
 * that is planned or ringing keeps its voice a surprise. */
export function voiceWords(drill: DrillView): string | null {
  if (drill.status === 'scheduled' || drill.status === 'ringing') return null;
  return drill.voice_of ? `In ${possessive(drill.voice_of.name)} voice` : 'In a voice from the library';
}

export function isSafeOutcome(outcome: Outcome | null | undefined): boolean {
  return outcome === 'asked_safe_word' || outcome === 'hung_up' || outcome === 'asked_personal_question';
}

/** An error as one plain sentence. */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
