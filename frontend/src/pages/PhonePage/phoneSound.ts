// Sound, vibration and the screen wake lock for the phone page.
//
// Phones only play sound after a tap, so the waiting screen has one big
// "Tap to switch on sound" button. In that tap (before any await, or iOS
// forgets it was a tap) we unlock an AudioContext, play the ringtone once
// muted, ask for the microphone so no permission box appears while it rings,
// and keep the screen awake.
//
// The phone can take the sound away again later (a lock screen, Siri, a real
// call, the voice call's own audio): the status follows the AudioContext, so
// the waiting screen brings the button back when a new tap is needed.

import { audioContextClass, type PrimedAudio } from './audioUnlock';

export type SoundStatus = 'off' | 'on' | 'mic_blocked';

const RING_EVERY_MS = 3000;
const VIBRATE_PATTERN = [600, 300, 600];
/** The Shield's warning: three long pulses, unlike the ring. */
const WARNING_PATTERN = [500, 150, 500, 150, 900];
/** iOS keeps resume() pending while the sound is interrupted: wait this long at most. */
const RESUME_WAIT_MS = 3000;
/** The microphone question waits for the person, but not for ever. */
const MICROPHONE_WAIT_MS = 30000;

/** The promise's value, or `fallback` once `ms` have passed. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export class PhoneSound {
  private context: AudioContext | null = null;
  /** The context unlocked on the Join page, adopted here: never closed. */
  private shared: AudioContext | null = null;
  private ringTimer: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private wantWakeLock = false;
  /** The sound tap happened: vibration is allowed from now on. */
  private unlocked = false;
  private vibrating = false;
  private switching = false;
  private microphoneOk = false;
  private listener: ((status: SoundStatus) => void) | null = null;

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** 'on' only while the tap's sound still works; 'off' asks for a new tap. */
  get status(): SoundStatus {
    if (!this.unlocked) return 'off';
    if (this.context && this.context.state !== 'running') return 'off';
    return this.microphoneOk ? 'on' : 'mic_blocked';
  }

  /** Told whenever the status changes by itself (not during switchOn). */
  onStatusChange(listener: ((status: SoundStatus) => void) | null): void {
    this.listener = listener;
  }

  /** Call straight from the tap's click handler. */
  async switchOn(): Promise<SoundStatus> {
    this.switching = true;
    try {
      // Synchronous part first: these need the tap itself.
      this.unlocked = true;
      const Context = audioContextClass();
      if (Context && !this.context) {
        this.context = new Context();
        this.context.onstatechange = this.report;
      }
      const resumed = this.context ? this.context.resume().catch(() => undefined) : Promise.resolve();
      this.playRing(0); // once, muted: unlocks playback for later
      this.wantWakeLock = true;
      const lock = this.requestWakeLock();
      const microphone = navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
            stream.getTracks().forEach((track) => track.stop());
            return true;
          })
        : Promise.resolve(false);

      // Never leave the button stuck: an interrupted resume or a slow wake
      // lock gives up after a few seconds, and the button can be tapped again.
      await within(Promise.all([resumed, lock]).then(() => undefined), RESUME_WAIT_MS, undefined);
      this.microphoneOk = await within(microphone, MICROPHONE_WAIT_MS, false);
    } finally {
      this.switching = false;
    }
    return this.status;
  }

  /** Take over the sound and microphone a tap on the Join page unlocked
   * (audioUnlock.ts), so the first ring is heard without a new tap. */
  async adopt(primed: PrimedAudio): Promise<SoundStatus> {
    this.switching = true;
    try {
      this.unlocked = true;
      if (primed.context && !this.context) {
        this.context = primed.context;
        this.shared = primed.context;
        this.context.onstatechange = this.report;
      }
      this.wantWakeLock = true;
      void this.requestWakeLock();
      this.microphoneOk = await within(primed.microphone, MICROPHONE_WAIT_MS, false);
    } finally {
      this.switching = false;
    }
    return this.status;
  }

  /** A strong buzz for the Shield's warning, where the phone allows it. */
  warn(): void {
    const tapped = this.unlocked || navigator.userActivation?.hasBeenActive === true;
    if (tapped && 'vibrate' in navigator) navigator.vibrate(WARNING_PATTERN);
  }

  /** The ringtone (every few seconds) and vibration, until stopRinging. */
  startRinging(): void {
    this.stopRinging();
    const ring = () => {
      this.playRing(0.2);
      // Browsers allow vibration only after a tap on the page.
      const tapped = this.unlocked || navigator.userActivation?.hasBeenActive === true;
      if (tapped && 'vibrate' in navigator) this.vibrating = navigator.vibrate(VIBRATE_PATTERN) || this.vibrating;
    };
    ring();
    this.ringTimer = window.setInterval(ring, RING_EVERY_MS);
  }

  stopRinging(): void {
    if (this.ringTimer !== null) window.clearInterval(this.ringTimer);
    this.ringTimer = null;
    if (this.vibrating && 'vibrate' in navigator) navigator.vibrate(0);
    this.vibrating = false;
  }

  dispose(): void {
    this.stopRinging();
    this.listener = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.wantWakeLock = false;
    this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    if (this.context) this.context.onstatechange = null;
    // The Join tap's context belongs to the document (audioUnlock.ts).
    if (this.context !== this.shared) this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private report = () => {
    if (!this.switching) this.listener?.(this.status);
  };

  /** One "ring ring": two short bursts of 440 + 480 Hz, like a phone line. */
  private playRing(volume: number): void {
    const context = this.context;
    if (!context) return;
    if (context.state !== 'running') context.resume().catch(() => undefined);
    const now = context.currentTime + 0.02;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.connect(context.destination);
    for (const start of [0, 0.5]) {
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(volume, now + start + 0.03);
      gain.gain.setValueAtTime(volume, now + start + 0.37);
      gain.gain.linearRampToValueAtTime(0, now + start + 0.4);
    }
    for (const frequency of [440, 480]) {
      const oscillator = context.createOscillator();
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + 0.95);
    }
  }

  private async requestWakeLock(): Promise<void> {
    if (!this.wantWakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (this.wakeLock && !this.wakeLock.released) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Not allowed here (battery saver, an old browser): the screen may dim.
    }
  }

  private onVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    void this.requestWakeLock();
    const context = this.context;
    if (!context || context.state === 'running') {
      this.report();
      return;
    }
    // Try to get the sound back without a tap; if the phone refuses, the
    // status says 'off' and the waiting screen asks for a new tap.
    void within(context.resume().catch(() => undefined), RESUME_WAIT_MS, undefined).then(this.report);
  };
}
