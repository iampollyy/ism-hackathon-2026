// Small helpers shared by the learning page and the news page (both W4):
// the learning content (cached for the session, it only changes with a
// deploy), the family's name for the page header, and dates in plain words.

import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { DrillList, Habits, LearnTactics } from '../../api/types';

export type Habit = Habits['habits'][number];
export type LearnTactic = LearnTactics['tactics'][number];
export type Drill = DrillList['drills'][number];
export type LearnContent = { habits: Habit[]; tactics: LearnTactic[] };

let contentCache: Promise<LearnContent> | null = null;

/** Habits and tactics, fetched once per session; a failed fetch is retried next time. */
export function loadLearnContent(): Promise<LearnContent> {
  if (!contentCache) {
    contentCache = Promise.all([api.habits(), api.tactics()])
      .then(([habits, tactics]) => ({ habits: habits.habits, tactics: tactics.tactics }))
      .catch((error: unknown) => {
        contentCache = null;
        throw error;
      });
  }
  return contentCache;
}

/** A plain-language sentence for a failed request. */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === 'content_unavailable') return 'The learning pages are not available right now. Please try again in a moment.';
    return error.message;
  }
  return fallback;
}

export type FamilyName = { name: string | null; notFound: boolean };

/** The family's name for the header; quietly empty if it cannot be loaded. */
export function useFamilyName(familyId: string): FamilyName {
  const [state, setState] = useState<FamilyName>({ name: null, notFound: false });
  useEffect(() => {
    let live = true;
    setState({ name: null, notFound: false });
    api.getFamily(familyId).then(
      (family) => live && setState({ name: family.name, notFound: false }),
      (error: unknown) =>
        live && setState({ name: null, notFound: error instanceof ApiError && error.status === 404 }),
    );
    return () => {
      live = false;
    };
  }, [familyId]);
  return state;
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** 4 -> "four"; larger numbers stay as digits. */
export function numberWord(count: number): string {
  return WORDS[count] ?? String(count);
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "14 Nov" (this year) or "14 Nov 2025". */
export function shortDate(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** "Saturday 14 November at 09:30". */
export function dayAndTime(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '';
  const day = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} at ${time}`;
}

/** "09:30" today, otherwise "Sun 15 Nov, 09:30". */
export function timeOrDay(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '';
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

/** "Sara's" / "James'" */
export function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
