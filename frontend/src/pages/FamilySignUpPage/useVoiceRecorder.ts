// One microphone recording at a time, with MediaRecorder. It stops by itself
// after a minute; the page lets the person stop after 20 seconds.
// Chrome and Firefox record webm (opus); Safari records mp4.

import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_SECONDS = 60;
export const MIN_SECONDS = 20;

export type RecorderPhase = 'idle' | 'starting' | 'recording';

export type Recording = { memberId: string; audio: Blob; extension: 'webm' | 'mp4'; seconds: number };

type Format = { mimeType: string | undefined; extension: 'webm' | 'mp4' };

function pickFormat(): Format | null {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return null;
  const supported = (type: string) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  };
  if (supported('audio/webm;codecs=opus')) return { mimeType: 'audio/webm;codecs=opus', extension: 'webm' };
  if (supported('audio/mp4')) return { mimeType: 'audio/mp4', extension: 'mp4' };
  if (supported('audio/webm')) return { mimeType: 'audio/webm', extension: 'webm' };
  return { mimeType: undefined, extension: 'webm' }; // the browser's own default
}

export function canRecord(): boolean {
  return pickFormat() !== null && Boolean(navigator.mediaDevices?.getUserMedia);
}

function microphoneError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The browser blocked the microphone. Allow it (the icon next to the address bar) and try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found. Connect one and try again.';
  }
  if (name === 'NotReadableError') {
    return 'Another app is using the microphone. Close it and try again.';
  }
  return 'The microphone could not start. Try again.';
}

type Handlers = {
  onRecorded: (recording: Recording) => void;
  onError: (memberId: string, message: string) => void;
};

export function useVoiceRecorder(handlers: Handlers) {
  const [memberId, setMemberId] = useState<string | null>(null);
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsed, setElapsed] = useState(0);

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const unmountedRef = useRef(false);

  const releaseMicrophone = useCallback(() => {
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      releaseMicrophone();
    };
  }, [releaseMicrophone]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const start = useCallback(async (id: string) => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') return;
    const format = pickFormat();
    if (!format || !navigator.mediaDevices?.getUserMedia) {
      handlersRef.current.onError(id, 'This browser cannot record audio. Try Chrome, Edge or Safari.');
      return;
    }
    setMemberId(id);
    setPhase('starting');
    setElapsed(0);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      setPhase('idle');
      setMemberId(null);
      handlersRef.current.onError(id, microphoneError(error));
      return;
    }
    if (unmountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, format.mimeType ? { mimeType: format.mimeType } : undefined);
    } catch {
      releaseMicrophone();
      setPhase('idle');
      setMemberId(null);
      handlersRef.current.onError(id, 'This browser cannot record audio. Try Chrome, Edge or Safari.');
      return;
    }
    recorderRef.current = recorder;

    const chunks: Blob[] = [];
    const startedAt = performance.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const seconds = (performance.now() - startedAt) / 1000;
      releaseMicrophone();
      recorderRef.current = null;
      if (unmountedRef.current) return;
      setPhase('idle');
      setMemberId(null);
      setElapsed(0);
      const type = recorder.mimeType || format.mimeType || 'audio/webm';
      const extension = type.includes('mp4') ? 'mp4' : format.extension;
      const audio = new Blob(chunks, { type });
      if (audio.size === 0 || seconds < 3) {
        handlersRef.current.onError(id, 'Nothing was recorded. Check the microphone and try again.');
        return;
      }
      handlersRef.current.onRecorded({ memberId: id, audio, extension, seconds });
    };

    recorder.start(1000);
    setPhase('recording');
    timerRef.current = window.setInterval(() => {
      const seconds = (performance.now() - startedAt) / 1000;
      setElapsed(seconds);
      if (seconds >= MAX_SECONDS) stop();
    }, 200);
  }, [releaseMicrophone, stop]);

  return { memberId, phase, elapsed, start, stop };
}
