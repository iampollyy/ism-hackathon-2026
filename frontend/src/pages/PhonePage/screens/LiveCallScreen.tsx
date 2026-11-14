// The member's side of a live call: a person calling through Callback
// (live/peer.ts), heard directly, while the Shield listens. Answering here
// opens the microphone, accepts the caller's audio link, and shows the same
// in-call screen and Shield warning as any shield call.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { LivePeer, openMicrophone, type LinkStatus } from '../../../live/peer';
import { plainError } from '../usePhone';
import { CallScreen } from './CallScreen';
import type { ShieldState } from './ShieldWarning';

type LiveCallScreenProps = {
  callId: string;
  title: string;
  number: string | null;
  startedAt: number;
  shield: ShieldState | null;
  /** The call is over; the message (if any) shows on the home screen. */
  onEnded: (message: string | null) => void;
};

/** After this long without an audio link, say so (the Shield still listens). */
const LINK_PATIENCE_MS = 10_000;

export function LiveCallScreen({ callId, title, number, startedAt, shield, onEnded }: LiveCallScreenProps) {
  const [link, setLink] = useState<LinkStatus>('connecting');
  const [slow, setSlow] = useState(false);
  const [ending, setEnding] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const peerRef = useRef<LivePeer | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);
  const statusRef = useRef('ringing');

  const finish = useCallback(
    (message: string | null) => {
      if (doneRef.current) return;
      doneRef.current = true;
      peerRef.current?.close();
      micRef.current?.getTracks().forEach((track) => track.stop());
      onEnded(message);
    },
    [onEnded],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let mic: MediaStream;
      try {
        mic = await openMicrophone();
      } catch {
        if (!cancelled) {
          void api.decline(callId).catch(() => undefined);
          finish('Callback needs the microphone for calls. Allow it in your browser settings and try again.');
        }
        return;
      }
      if (cancelled) {
        mic.getTracks().forEach((track) => track.stop());
        return;
      }
      micRef.current = mic;
      try {
        await api.answerLive(callId);
      } catch (error) {
        finish(plainError(error, 'The call could not be answered.'));
        return;
      }
      const peer = new LivePeer(callId, 'callee', mic, {
        onRemoteStream: (stream) => {
          const audio = audioRef.current;
          if (!audio) return;
          audio.srcObject = stream;
          void audio.play().catch(() => undefined);
        },
        onLink: setLink,
        onCallStatus: (status) => {
          statusRef.current = status;
        },
        onClosed: () => finish('The call ended.'),
      });
      peerRef.current = peer;
      void peer.start();
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, finish]);

  useEffect(() => {
    if (link === 'connected') return;
    const timer = window.setTimeout(() => setSlow(true), LINK_PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [link]);

  // Leaving the page ends the call cleanly.
  useEffect(() => () => {
    if (!doneRef.current) {
      peerRef.current?.hangUp();
      micRef.current?.getTracks().forEach((track) => track.stop());
    }
  }, []);

  const hangUp = useCallback(() => {
    if (ending) return;
    setEnding(true);
    peerRef.current?.hangUp();
    void api.endCall(callId, 'user').catch(() => undefined);
    finish(shield?.warn ? 'You hung up. That was the right thing to do.' : 'The call ended.');
  }, [callId, ending, finish, shield?.warn]);

  const connected = link === 'connected';
  return (
    <>
      <audio ref={audioRef} autoPlay playsInline />
      <CallScreen
        title={title}
        number={number}
        variant="practice"
        startedAt={startedAt}
        connected={connected}
        mode={connected ? 'listening' : null}
        ending={ending}
        shield={shield}
        note={!connected && (slow || link === 'failed') ? 'Still connecting the sound. Callback Shield is listening.' : undefined}
        onCallBack={() => hangUp()}
        onEnd={hangUp}
      />
    </>
  );
}
