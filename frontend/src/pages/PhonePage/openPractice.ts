// The practice call this tab answered, kept in sessionStorage until the
// person leaves its reveal, so a reload (or a pull-to-refresh) in the middle
// of the call or on the reveal still ends the call and shows the reveal.
// Every practice ends with a reveal, however it ended.

import type { EndedBy } from '../../api/types';

export type OpenPractice = {
  callId: string;
  /** reveal.voice_of from the session, once the answer came back. */
  voiceOf: string | null;
  voiceKnown: boolean;
  /** When it was answered (ms). */
  at: number;
  /** How it ended, once the back end has the end; null while it runs. */
  endedBy: EndedBy | null;
};

/** A reveal whose end was already sent comes back for this long after a reload. */
export const SHOW_ENDED_FOR_MS = 10 * 60 * 1000;

const ENDED_BY: readonly EndedBy[] = ['agent', 'user', 'timeout', 'error'];

const keyFor = (memberId: string) => `callback.phone.${memberId}.practice`;

export function readOpenPractice(memberId: string): OpenPractice | null {
  try {
    const raw = window.sessionStorage.getItem(keyFor(memberId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<OpenPractice> | null;
    if (!value || typeof value.callId !== 'string' || typeof value.at !== 'number') return null;
    return {
      callId: value.callId,
      voiceOf: typeof value.voiceOf === 'string' ? value.voiceOf : null,
      voiceKnown: value.voiceKnown === true,
      at: value.at,
      endedBy: ENDED_BY.find((endedBy) => endedBy === value.endedBy) ?? null,
    };
  } catch {
    return null; // storage blocked (private mode) or a bad value
  }
}

export function saveOpenPractice(memberId: string, value: OpenPractice): void {
  try {
    window.sessionStorage.setItem(keyFor(memberId), JSON.stringify(value));
  } catch {
    // Storage blocked: a reload then cannot bring the reveal back.
  }
}

/** Change the saved practice, only if it is still this call. */
export function updateOpenPractice(memberId: string, callId: string, change: Partial<OpenPractice>): void {
  const saved = readOpenPractice(memberId);
  if (saved && saved.callId === callId) saveOpenPractice(memberId, { ...saved, ...change });
}

/** Forget the saved practice (only the one answered at `at`, if given). */
export function clearOpenPractice(memberId: string, at?: number): void {
  if (at !== undefined && readOpenPractice(memberId)?.at !== at) return;
  try {
    window.sessionStorage.removeItem(keyFor(memberId));
  } catch {
    // nothing to do
  }
}
