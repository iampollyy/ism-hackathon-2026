// The hero call: ringing, the scam, the glitch, the reveal and the green call-back.
// One clock drives everything: the audio context's clock when sound runs (so captions
// follow the voice exactly), performance.now otherwise (sound off or refused).
import { callAudio } from './audio';
import { LESSON_AT, REVEAL_DURATION, SCAM_DURATION, SCAM_LINES } from './captions';
import { hero } from './copy';
import { live, store, type CallState } from './store';

const GLITCH_AT = 11.85;
const GLITCH_LEN = 0.9;
const REVEAL_CLIP_DELAY = 0.25; // after the display line resolves
const AUTO_CALLBACK_AFTER = 2.5;
const RING_BACK = 2.4;
const CONNECTED_TO_DONE = 1.0;
const HANG_UP_HOLD = 1.4;

type Clock = 'audio' | 'perf';

let announceEl: HTMLElement | null = null;

export function setAnnouncer(el: HTMLElement | null) {
  announceEl = el;
}

function announce(text: string) {
  if (!announceEl) return;
  announceEl.textContent = '';
  // A new text node after a tick makes screen readers read it even when it repeats.
  window.setTimeout(() => {
    if (announceEl) announceEl.textContent = text;
  }, 60);
}

/** Focus the first visible element marked data-lp-focus="name" (works across React roots).
 * A panel that is still turning visible (reduced motion keeps a short transition) is
 * retried for a few frames rather than leaving focus on the body. */
export function focusMark(name: string, tries = 12) {
  window.requestAnimationFrame(() => {
    // While the phone-sized call dialog is open, focus stays inside it.
    const scope: ParentNode = document.querySelector('.lp-overlay[aria-modal="true"]') ?? document;
    const els = Array.from(scope.querySelectorAll<HTMLElement>(`[data-lp-focus="${name}"]`));
    const el = els.find((e) => {
      if (e.closest('[inert]')) return false;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const style = window.getComputedStyle(e);
      return style.visibility !== 'hidden';
    });
    if (el) el.focus({ preventScroll: true });
    else if (tries > 0) window.setTimeout(() => focusMark(name, tries - 1), 30);
  });
}

/** A short buzz on phones that allow it (after the visitor's tap; iOS ignores it). */
function buzz(pattern: number | number[]) {
  if (store.get().reducedMotion) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not allowed here: nothing to do.
  }
}

class CallMachine {
  private raf = 0;
  private clock: Clock = 'perf';
  private t0 = 0;
  private glitchAt = GLITCH_AT;
  private revealClipStarted = false;
  private revealClipAt = 0;
  private waitFrom = -1;
  private backFrom = -1;
  private connectedFrom = -1;
  private timers: number[] = [];
  private runId = 0;
  private hungUpAt = -1;
  onGlitch: (() => void) | null = null;

  private now() {
    if (this.clock === 'audio' && callAudio.ctx) return callAudio.ctx.currentTime;
    return performance.now() / 1000;
  }

  private later(ms: number, fn: () => void) {
    const id = window.setTimeout(fn, ms);
    this.timers.push(id);
  }

  private clearTimers() {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
  }

  private set(call: CallState, extra: Parameters<typeof store.set>[0] = {}) {
    store.set({ call, ...extra });
  }

  /** Answer, Hear the call anyway, Try sound again. Must be called from a tap. */
  answer(opts: { overlay?: boolean } = {}) {
    this.cancel();
    const id = ++this.runId;
    const soundOn = store.get().soundOn;
    const unlocked = callAudio.unlock();
    callAudio.setMuted(!soundOn);
    if (opts.overlay) store.set({ overlayOpen: true });
    store.set({
      noSound: false,
      scamT: 0,
      revealT: 0,
      timer: 0,
      backTimer: 0,
      revealShown: false,
      lesson: false,
      declineStep: 0,
    });
    if (!unlocked) {
      this.start(id, 'perf', true);
      return;
    }
    if (callAudio.isReady('scam') && callAudio.isReady('reveal')) {
      this.startWhenRunning(id);
      return;
    }
    this.set('connecting');
    const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('slow')), 6000));
    Promise.race([Promise.all([callAudio.load('scam'), callAudio.load('reveal')]), timeout])
      .then(() => {
        if (id === this.runId) this.startWhenRunning(id);
      })
      .catch(() => {
        if (id === this.runId) this.start(id, 'perf', true);
      });
    callAudio.load('ring').catch(() => undefined);
  }

  private startWhenRunning(id: number) {
    if (callAudio.running) {
      this.start(id, 'audio', false);
      return;
    }
    // The context may take a moment to resume after the tap; if it never does, sound was refused.
    let tries = 0;
    const check = () => {
      if (id !== this.runId) return;
      if (callAudio.running) this.start(id, 'audio', false);
      else if (tries++ > 8) this.start(id, 'perf', true);
      else window.setTimeout(check, 50);
    };
    check();
  }

  private start(id: number, clock: Clock, noSound: boolean) {
    if (id !== this.runId) return;
    this.clock = clock;
    this.glitchAt = GLITCH_AT;
    this.revealClipStarted = false;
    this.revealClipAt = GLITCH_AT + GLITCH_LEN + REVEAL_CLIP_DELAY;
    this.waitFrom = -1;
    this.backFrom = -1;
    this.connectedFrom = -1;
    this.hungUpAt = -1;
    if (clock === 'audio') {
      const at = callAudio.play('scam');
      this.t0 = at ?? this.now();
    } else {
      this.t0 = this.now();
    }
    this.set('in-call', { noSound });
    announce(hero.announce.answered);
    focusMark('end');
    callAudio.load('ring').catch(() => undefined);
    this.loop();
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.step();
      const s = store.get().call;
      if (s === 'ringing' || s === 'declined' || s === 'stopped' || s === 'connecting') {
        live.audioLevel = 0;
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  private fakeLevel(t: number) {
    // With no sound, the glow still breathes with the words.
    for (const line of SCAM_LINES)
      for (const w of line.words) if (t >= w.start && t <= w.end) return 0.35 + 0.25 * Math.abs(Math.sin(t * 19));
    return 0.04;
  }

  private step() {
    const st = store.get();
    const T = this.now() - this.t0;
    const audio = this.clock === 'audio' && !st.noSound;

    if (st.call === 'in-call') {
      const scamT = audio ? (callAudio.clipTime('scam') ?? T) : T;
      store.set({ scamT: Math.round(Math.min(scamT, SCAM_DURATION) * 50) / 50, timer: Math.floor(T) });
      if (audio) callAudio.level();
      else live.audioLevel = this.fakeLevel(scamT);
      if (T >= this.glitchAt) this.enterGlitch();
      return;
    }
    if (st.call === 'hung-up') {
      live.audioLevel *= 0.9;
      if (T >= this.glitchAt) this.enterGlitch();
      return;
    }
    if (st.call === 'glitch') {
      live.audioLevel *= 0.85;
      if (T >= this.glitchAt + GLITCH_LEN) {
        live.glitch = 0;
        this.set('reveal', { revealShown: true });
        announce(hero.announce.glitch);
      }
      return;
    }
    if (st.call === 'reveal') {
      if (!this.revealClipStarted && T >= this.revealClipAt) {
        this.revealClipStarted = true;
        if (audio) callAudio.play('reveal');
      }
      if (!this.revealClipStarted) return;
      const rt = audio ? (callAudio.clipTime('reveal') ?? T - this.revealClipAt) : T - this.revealClipAt;
      if (audio) callAudio.level();
      else live.audioLevel = 0.12;
      const patch: Parameters<typeof store.set>[0] = { revealT: Math.round(Math.min(rt, REVEAL_DURATION) * 50) / 50 };
      if (rt >= LESSON_AT) patch.lesson = true;
      store.set(patch);
      if (rt >= REVEAL_DURATION && this.waitFrom < 0) {
        this.waitFrom = T;
        focusMark('call-son');
      }
      if (this.waitFrom >= 0 && T - this.waitFrom >= AUTO_CALLBACK_AFTER) this.callBack();
      return;
    }
    if (st.call === 'calling-back') {
      live.audioLevel *= 0.9;
      if (T - this.backFrom >= RING_BACK) {
        callAudio.stop('ring', 300);
        this.connectedFrom = T;
        this.set('connected', { backTimer: 0 });
      }
      return;
    }
    if (st.call === 'connected' || st.call === 'done') {
      live.audioLevel = 0;
      store.set({ backTimer: Math.floor(T - this.connectedFrom) });
      if (st.call === 'connected' && T - this.connectedFrom >= CONNECTED_TO_DONE) {
        this.set('done');
        announce(hero.announce.done);
        focusMark('replay');
      }
    }
  }

  private enterGlitch() {
    this.set('glitch');
    if (this.clock === 'audio') callAudio.stop('scam', 80);
    if (!store.get().reducedMotion) {
      live.glitch = 1;
      callAudio.glitch();
    }
    buzz([30, 40, 30]);
    this.onGlitch?.();
  }

  /** End, during the call: the right instinct. */
  end() {
    const st = store.get();
    if (st.call !== 'in-call') return;
    const T = this.now() - this.t0;
    callAudio.stop('scam', 120);
    this.hungUpAt = T;
    this.glitchAt = T + HANG_UP_HOLD;
    this.revealClipAt = this.glitchAt + GLITCH_LEN + REVEAL_CLIP_DELAY;
    this.set('hung-up');
    announce(hero.announce.hungUp);
  }

  /** Call Son (or the automatic call-back after the reveal). */
  callBack() {
    const st = store.get();
    if (st.call !== 'reveal') return;
    callAudio.stop('reveal', 200);
    this.backFrom = this.now() - this.t0;
    if (st.soundOn && callAudio.isReady('ring') && callAudio.running) callAudio.play('ring', { loop: true });
    this.set('calling-back');
    buzz(30);
    announce(hero.announce.callingBack);
  }

  decline() {
    this.cancel();
    if (store.get().soundOn) callAudio.unlock();
    this.set('declined', { declineStep: 0 });
    announce(hero.announce.declined);
    this.later(600, () => {
      store.set({ declineStep: 1 });
      callAudio.tick();
      focusMark('hear-anyway');
    });
  }

  /** Replay: ring for 1.6 s, then answer by itself. A tap, so sound may play. */
  replay(opts: { overlay?: boolean } = {}) {
    this.cancel();
    const id = this.runId;
    const soundOn = store.get().soundOn;
    callAudio.unlock();
    callAudio.setMuted(!soundOn);
    store.reset();
    if (opts.overlay) store.set({ overlayOpen: true });
    const ring = () => {
      if (soundOn && callAudio.running) callAudio.play('ring', { loop: true });
    };
    callAudio
      .load('ring')
      .then(() => id === this.runId && ring())
      .catch(() => undefined);
    this.later(1600, () => {
      if (id !== this.runId) return;
      callAudio.stop('ring', 200);
      this.answer({ overlay: opts.overlay });
    });
  }

  /** Scrolled away, tab hidden or overlay closed mid-call. */
  stop(reason: 'scroll' | 'closed' = 'scroll') {
    const s = store.get().call;
    if (s !== 'in-call' && s !== 'glitch' && s !== 'reveal' && s !== 'hung-up' && s !== 'connecting') return;
    this.runId++;
    cancelAnimationFrame(this.raf);
    callAudio.stopAll(400);
    live.audioLevel = 0;
    live.glitch = 0;
    this.set('stopped', { stopReason: reason });
    announce(hero.announce.stopped);
  }

  /** Back to the ringing phone (used when leaving the page). */
  cancel() {
    this.runId++;
    cancelAnimationFrame(this.raf);
    this.clearTimers();
    callAudio.stopAll(120);
    live.audioLevel = 0;
    live.glitch = 0;
  }

  get hungUp() {
    return this.hungUpAt >= 0;
  }
}

export const callMachine = new CallMachine();

export const isActiveCall = (s: CallState) =>
  s === 'connecting' || s === 'in-call' || s === 'hung-up' || s === 'glitch' || s === 'reveal';

/** From Answer until the call back connects: the page steps back so the call leads. */
export const inFocusCall = (s: CallState) =>
  s === 'in-call' || s === 'hung-up' || s === 'glitch' || s === 'reveal' || s === 'calling-back' || s === 'connected';
