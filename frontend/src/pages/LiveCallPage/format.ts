import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { CallKind, ScenarioKey } from '../../api/types';

/** "Jon's". */
export function possessive(name: string): string {
  return `${name}’s`;
}

/** 0:07, 1:23, 12:05. */
export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** "1 second", "23 seconds", "1 minute 5 seconds". */
export function duration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (whole < 60) return plural(whole, 'second');
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${plural(minutes, 'minute')} ${plural(rest, 'second')}` : plural(minutes, 'minute');
}

// ---------------------------------------------------------------- scenario titles

let titles: Promise<Map<string, string>> | null = null;

function loadTitles(): Promise<Map<string, string>> {
  titles ??= api.scenarios()
    .then((list) => new Map(list.map((scenario) => [scenario.key, scenario.title])))
    .catch(() => {
      titles = null; // try again next time
      return new Map<string, string>();
    });
  return titles;
}

/** The scenario's readable title from GET /api/scenarios (fetched once). */
export function useCallTitle(kind: CallKind | undefined, scenario: ScenarioKey | null | undefined): string {
  const [map, setMap] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    void loadTitles().then((value) => {
      if (live) setMap(value);
    });
    return () => {
      live = false;
    };
  }, []);
  if (kind === 'welcome') return 'Welcome call';
  if (kind === 'family_line') return 'Family line';
  if (!scenario) return 'Practice call';
  return map?.get(scenario) ?? 'Practice call';
}
