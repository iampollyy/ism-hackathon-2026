// Sound, vibration and the screen wake lock for the phone page.
//
// Phones only play sound after a tap, so the waiting screen has one big
// "Tap to switch on sound" button. In that tap (before any await, or iOS
// forgets it was a tap) we unlock an AudioContext, play the ringtone once
// muted, ask for the microphone so no permission box appears while it rings,
// and keep the screen awake.

export type SoundStatus = 'off' | 'on' | 'mic_blocked';

type AudioContextClass = typeof AudioContext;

const RING_EVERY_MS = 3000;
const VIBRATE_PATTERN = [600, 300, 600];

function audioContextClass(): AudioContextClass | null {
  const w = window as typeof window & { webkitAudioContext?: AudioContextClass };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class PhoneSound {
  private context: AudioContext | null = null;
  private ringTimer: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private wantWakeLock = false;
  /** The sound tap happened: vibration is allowed from now on. */
  private unlocked = false;
  private vibrating = false;

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Call straight from the tap's click handler. */
  async switchOn(): Promise<SoundStatus> {
    // Synchronous part first: these need the tap itself.
    this.unlocked = true;
    const Context = audioContextClass();
    if (Context && !this.context) this.context = new Context();
    const resumed = this.context?.resume().catch(() => undefined);
    this.playRing(0); // once, muted: unlocks playback for later
    this.wantWakeLock = true;
    const lock = this.requestWakeLock();
    const microphone = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ audio: true }).then(
          (stream) => {
            stream.getTracks().forEach((track) => track.stop());
            return true;
          },
          () => false,
        )
      : Promise.resolve(false);

    const [, , micOk] = await Promise.all([resumed, lock, microphone]);
    return micOk ? 'on' : 'mic_blocked';
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
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.wantWakeLock = false;
    this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.context?.close().catch(() => undefined);
    this.context = null;
  }

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
    if (this.context && this.context.state !== 'running') this.context.resume().catch(() => undefined);
  };
}
