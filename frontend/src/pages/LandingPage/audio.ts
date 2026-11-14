// Sound for the hero call. One AudioContext, created on the first tap; the clips
// are decoded into buffers so later clips (the reveal, the ringtone) play without
// another gesture, on iOS too. Nothing here ever plays before a tap.
import { live } from './store';

export type Clip = 'scam' | 'reveal' | 'ring';

const URLS: Record<Clip, string> = {
  scam: '/landing/audio/scam-call.mp3',
  reveal: '/landing/audio/reveal.mp3',
  ring: '/landing/audio/ringtone.mp3',
};

const VOLUME: Record<Clip, number> = { scam: 1, reveal: 1, ring: 0.35 };

type Ctor = typeof AudioContext;

class CallAudio {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private bytes = new Map<Clip, Promise<ArrayBuffer>>();
  private buffers = new Map<Clip, AudioBuffer>();
  private decoding = new Map<Clip, Promise<AudioBuffer>>();
  private playing = new Map<Clip, { src: AudioBufferSourceNode; gain: GainNode; startedAt: number }>();
  private muted = false;
  private decoder: OfflineAudioContext | null = null;

  /** Fetch the files (no decoding, no sound) when the visitor shows intent. */
  prefetch() {
    (Object.keys(URLS) as Clip[]).forEach((clip) => {
      if (this.bytes.has(clip)) return;
      const p = fetch(URLS[clip]).then((r) => {
        if (!r.ok) throw new Error(`audio ${r.status}`);
        return r.arrayBuffer();
      });
      p.catch(() => this.bytes.delete(clip));
      this.bytes.set(clip, p);
    });
  }

  /** Fetch and decode everything (still silent): on hover, focus or touch of Answer. */
  warm() {
    this.prefetch();
    (Object.keys(URLS) as Clip[]).forEach((c) => this.load(c).catch(() => undefined));
  }

  /** Must run synchronously inside a tap handler. Returns false when Web Audio is missing. */
  unlock(): boolean {
    try {
      if (!this.ctx) {
        const Ctx: Ctor | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
        if (!Ctx) return false;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;
        this.data = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
        // The analyser listens before the mute, so the glow follows the voice with sound off too.
        this.analyser.connect(this.master);
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
      // iOS: a silent one-sample buffer started inside the gesture unlocks output.
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.start(0);
      return true;
    } catch {
      return false;
    }
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  isReady(clip: Clip) {
    return this.buffers.has(clip);
  }

  /** Decode a clip; resolves when it can start at once. Decoding makes no sound, so it
   * may run before the tap (on an offline context) and the buffer is reused later. */
  load(clip: Clip): Promise<AudioBuffer> {
    const done = this.buffers.get(clip);
    if (done) return Promise.resolve(done);
    const pending = this.decoding.get(clip);
    if (pending) return pending;
    let ctx: BaseAudioContext | null = this.ctx;
    if (!ctx) {
      try {
        this.decoder ??= new OfflineAudioContext(1, 1, 44100);
        ctx = this.decoder;
      } catch {
        return Promise.reject(new Error('no audio'));
      }
    }
    this.prefetch();
    const p = (this.bytes.get(clip) as Promise<ArrayBuffer>)
      // decodeAudioData detaches the buffer; decode a copy so a retry can reuse the bytes.
      .then((ab) => ctx.decodeAudioData(ab.slice(0)))
      .then((buf) => {
        this.buffers.set(clip, buf);
        return buf;
      });
    p.catch(() => this.decoding.delete(clip));
    this.decoding.set(clip, p);
    return p;
  }

  /** Start a decoded clip now. Returns its start time on the context clock, or null. */
  play(clip: Clip, { loop = false }: { loop?: boolean } = {}): number | null {
    const buf = this.buffers.get(clip);
    if (!this.ctx || !buf || !this.analyser) return null;
    this.stop(clip, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const gain = this.ctx.createGain();
    gain.gain.value = VOLUME[clip];
    src.connect(gain);
    gain.connect(clip === 'ring' ? (this.master as GainNode) : this.analyser);
    const startedAt = this.ctx.currentTime + 0.01;
    src.start(startedAt);
    this.playing.set(clip, { src, gain, startedAt });
    src.onended = () => {
      if (this.playing.get(clip)?.src === src) this.playing.delete(clip);
    };
    return startedAt;
  }

  /** Seconds into a playing clip, or null. */
  clipTime(clip: Clip): number | null {
    const p = this.playing.get(clip);
    if (!p || !this.ctx) return null;
    return Math.max(0, this.ctx.currentTime - p.startedAt);
  }

  stop(clip: Clip, fadeMs = 120) {
    const p = this.playing.get(clip);
    if (!p || !this.ctx) return;
    this.playing.delete(clip);
    const t = this.ctx.currentTime;
    try {
      p.gain.gain.cancelScheduledValues(t);
      p.gain.gain.setValueAtTime(p.gain.gain.value, t);
      p.gain.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
      p.src.stop(t + fadeMs / 1000 + 0.02);
    } catch {
      /* already stopped */
    }
  }

  stopAll(fadeMs = 120) {
    (['scam', 'reveal', 'ring'] as Clip[]).forEach((c) => this.stop(c, fadeMs));
  }

  /** RMS of what is playing, 0..1. Also written to live.audioLevel. */
  level(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i += 1) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.data.length);
    const lvl = Math.min(1, rms * 4);
    live.audioLevel = lvl;
    return lvl;
  }

  /** The soft message tick for Decline: 1200 Hz, 40 ms. */
  tick() {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = 1200;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.05);
  }

  /** The glitch: a band-passed noise burst and a low thunk. */
  glitch() {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.18);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) ch[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.07, t + 0.02);
    ng.gain.linearRampToValueAtTime(0, t + 0.18);
    noise.connect(bp).connect(ng).connect(this.master);
    noise.start(t);
    const o = ctx.createOscillator();
    o.frequency.value = 70;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.12, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.14);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }
}

export const callAudio = new CallAudio();
