// A tiny store shared by the page, the hero call and the 3D stage (which renders
// its screens in a separate React root, so state cannot live in React context).
import { useSyncExternalStore } from 'react';

export type CallState =
  | 'ringing'
  | 'connecting'
  | 'in-call'
  | 'hung-up'
  | 'glitch'
  | 'reveal'
  | 'calling-back'
  | 'connected'
  | 'done'
  | 'declined'
  | 'stopped';

export type Segment = 'hero' | 'problem' | 'habit' | 'story' | 'shield' | 'after';
export type Mode = 'lite' | '3d';
export type StageKey = 'hero' | 'problem' | 'habit' | 'story' | 'shield';

export interface LpState {
  call: CallState;
  /** The decline path: 0 "Call declined", 1 the message bubble. */
  declineStep: 0 | 1;
  /** Sound was refused or failed: the captions run on their own clock. */
  noSound: boolean;
  soundOn: boolean;
  mode: Mode;
  reducedMotion: boolean;
  /** Seconds into the current clip, quantised to 0.02 s. */
  scamT: number;
  revealT: number;
  /** Whole seconds on the call timer. */
  timer: number;
  /** Whole seconds on the call-back timer. */
  backTimer: number;
  /** The reveal display line is showing (after the glitch). */
  revealShown: boolean;
  /** The lesson ("Hang up, and call back") has been spoken. */
  lesson: boolean;
  overlayOpen: boolean;
  segment: Segment;
  /** Story chapter 0..4 and its progress 0..1 (quantised). */
  chapter: number;
  chapterP: number;
  problemP: number;
  habitP: number;
  shieldP: number;
  heroLeave: number;
  /** Which screen the 3D phone shows (the anchor it is nearest). */
  stage: StageKey;
  /** The 3D phone has passed the back during the reveal turn. */
  turned: boolean;
}

const initial: LpState = {
  call: 'ringing',
  declineStep: 0,
  noSound: false,
  soundOn: true,
  mode: 'lite',
  reducedMotion: false,
  scamT: 0,
  revealT: 0,
  timer: 0,
  backTimer: 0,
  revealShown: false,
  lesson: false,
  overlayOpen: false,
  segment: 'hero',
  chapter: 0,
  chapterP: 0,
  problemP: 0,
  habitP: 0,
  shieldP: 0,
  heroLeave: 0,
  stage: 'hero',
  turned: false,
};

let state: LpState = { ...initial };
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<LpState>) {
    let changed = false;
    for (const key in patch) {
      const k = key as keyof LpState;
      if (state[k] !== patch[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reset() {
    state = { ...initial, soundOn: state.soundOn, mode: state.mode, reducedMotion: state.reducedMotion };
    listeners.forEach((l) => l());
  },
};

export function useLp<T>(selector: (s: LpState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(state),
    () => selector(initial),
  );
}

/** Values that change every frame; read in animation loops, never rendered by React. */
export const live = {
  audioLevel: 0,
  /** Glitch strength 0..1 for the 3D rings and canvas. */
  glitch: 0,
};

export const q = (v: number, step = 0.004) => Math.round(v / step) * step;
