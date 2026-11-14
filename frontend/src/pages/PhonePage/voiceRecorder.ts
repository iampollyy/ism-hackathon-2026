// The member's own side of the welcome call, recorded so their voice can be
// copied after a spoken yes (docs/full-app/voice-from-call.md).
//
// Only their microphone, through a stream of its own, never the agent's
// audio. Echo cancellation stays on so the agent's voice from the speaker
// does not leak in. The back end decides whether the recording may be used
// and deletes it at once if not; the page uploads whatever was recorded.
//
// It starts just before the call's own session, so on a phone that keeps
// only one live capture, the call's microphone (opened second) is the one
// that wins: the call always works, and at worst the recording is silent.

import { ApiError, api } from '../../api/client';
import type { VoiceSampleStatus } from '../../api/types';
import { isTransient } from './eventQueue';

const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'] as const;
/** The call never waits longer than this for the recording to start. */
const START_WAIT_MS = 4000;
const STOP_WAIT_MS = 3000;

export type Recording = { blob: Blob; filename: string };

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function pickType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export class WelcomeRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private type = '';
  private stopped = false;
  private starting: Promise<void> | null = null;
  /** Why nothing was recorded, for the console. */
  problem: string | null = null;

  /** Open the microphone and start recording. Never throws, and gives up
   * waiting after a few seconds so the call is never held up by it. */
  start(): Promise<void> {
    if (!this.starting) this.starting = this.open();
    return Promise.race([this.starting, sleep(START_WAIT_MS)]);
  }

  get recording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  private async open(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.problem = 'This browser cannot record.';
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      this.problem = `No microphone for the recording: ${String(error)}`;
      return;
    }
    if (this.stopped) {
      // The call ended while the microphone was opening.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const type = pickType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      this.problem = `The recorder could not start: ${String(error)}`;
      return;
    }
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.stream = stream;
    this.recorder = recorder;
    this.type = recorder.mimeType || type || 'audio/webm';
    try {
      recorder.start(1000);
    } catch (error) {
      this.problem = `The recorder could not start: ${String(error)}`;
      this.release();
    }
  }

  /** Stop recording and the microphone; the recording, or null if nothing
   * was recorded. Safe to call more than once. */
  async finish(): Promise<Recording | null> {
    this.stopped = true;
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      await Promise.race([
        new Promise<void>((resolve) => {
          recorder.addEventListener('stop', () => resolve(), { once: true });
          try {
            recorder.stop();
          } catch {
            resolve();
          }
        }),
        sleep(STOP_WAIT_MS),
      ]);
    }
    this.release();
    if (this.chunks.length === 0) return null;
    const blob = new Blob(this.chunks, { type: this.type });
    this.chunks = [];
    if (blob.size === 0) return null;
    return { blob, filename: this.type.includes('mp4') ? 'welcome.mp4' : 'welcome.webm' };
  }

  /** Stop everything and drop the recording (the page is closing). */
  discard(): void {
    this.stopped = true;
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // already stopped
      }
    }
    this.chunks = [];
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

/** Upload the recording; one more try after a network or server error. */
export async function uploadRecording(callId: string, recording: Recording) {
  try {
    return await api.uploadVoiceSample(callId, recording.blob, recording.filename);
  } catch (error) {
    if (!isTransient(error)) throw error;
    await sleep(1500);
    return api.uploadVoiceSample(callId, recording.blob, recording.filename);
  }
}

export const FINAL_VOICE_STATES: ReadonlyArray<VoiceSampleStatus['state']> = ['ready', 'failed', 'none'];

/** The upload's error as a sentence for the thank-you screen. */
export function uploadProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'There was no connection, so your recording could not be sent.';
    return error.message;
  }
  return 'Your recording could not be sent.';
}
