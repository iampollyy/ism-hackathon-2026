// The caller's screen of a live call, /live/:callId: the organiser (or a
// teammate playing the scammer) calls a family member through Callback from
// their own phone or laptop. The two browsers talk directly (live/peer.ts);
// this side also turns the caller's words into text (live/listen.ts) and
// posts them to the call, where the Shield on the member's phone judges them.
// For the presenter it shows what Callback heard and what the Shield did.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Mic, MicOff, PhoneOff, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { CallView, RiskLevel } from '../../api/types';
import { LivePeer, openMicrophone, type LinkStatus } from '../../live/peer';
import { listenToCaller, postCallerTurn, type Listening } from '../../live/listen';
import '../PhonePage/PhonePage.scss';
import './CallerPage.scss';

type Phase = 'starting' | 'ringing' | 'in_call' | 'ended';
type Risk = { level: RiskLevel; reason: string } | null;

const SHOWN_LINES = 4;
const RISK_POLL_MS = 1500;
const LINK_PATIENCE_MS = 10_000;

const ENDED_WORDS: Record<string, string> = {
  declined: 'They declined the call.',
  missed: 'No answer.',
  failed: 'The call could not connect.',
};

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function CallerPage() {
  const { callId = '' } = useParams<{ callId: string }>();
  return <Caller key={callId} callId={callId} />;
}

function Caller({ callId }: { callId: string }) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [name, setName] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [endedText, setEndedText] = useState('The call ended.');
  const [link, setLink] = useState<LinkStatus>('connecting');
  const [slow, setSlow] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [listenNote, setListenNote] = useState<string | null>(null);
  const [risk, setRisk] = useState<Risk>(null);
  const [alerted, setAlerted] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const peerRef = useRef<LivePeer | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const listenRef = useRef<Listening | null>(null);
  const phaseRef = useRef<Phase>('starting');
  const doneRef = useRef(false);

  const setPhaseBoth = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const stopAll = useCallback(() => {
    peerRef.current?.close();
    listenRef.current?.stop();
    listenRef.current = null;
    micRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const endWith = useCallback(
    (text: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      stopAll();
      setEndedText(text);
      setPhaseBoth('ended');
    },
    [stopAll],
  );

  const startListening = useCallback(async () => {
    try {
      listenRef.current = await listenToCaller(
        callId,
        (text) => {
          setLines((before) => [...before, text].slice(-SHOWN_LINES));
          void postCallerTurn(callId, text).catch(() => undefined);
        },
        (message) => setListenNote(message),
      );
    } catch (error) {
      setListenNote(error instanceof ApiError ? error.message : 'Live listening could not start.');
    }
  }, [callId]);

  // Who we call, and the call itself.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const call: CallView = await api.getCall(callId);
        if (cancelled) return;
        setName(call.target.name);
        setFamilyId(call.family_id ?? null);
        if (call.status !== 'ringing' && call.status !== 'in_progress') {
          endWith(ENDED_WORDS[call.status] ?? 'This call is over.');
          return;
        }
      } catch (error) {
        if (!cancelled) setProblem(error instanceof ApiError ? error.message : 'This call could not be found.');
        return;
      }
      let mic: MediaStream;
      try {
        mic = await openMicrophone();
      } catch {
        if (!cancelled) {
          void api.decline(callId).catch(() => undefined);
          setProblem('Callback needs the microphone for this call. Allow it in your browser settings, then start again.');
        }
        return;
      }
      if (cancelled) {
        mic.getTracks().forEach((track) => track.stop());
        return;
      }
      micRef.current = mic;
      setPhaseBoth('ringing');
      const peer = new LivePeer(callId, 'caller', mic, {
        onRemoteStream: (stream) => {
          const audio = document.getElementById('caller-remote-audio');
          if (audio instanceof HTMLAudioElement) {
            audio.srcObject = stream;
            void audio.play().catch(() => undefined);
          }
        },
        onLink: setLink,
        onCallStatus: (status) => {
          if (status === 'in_progress' && phaseRef.current === 'ringing') {
            setPhaseBoth('in_call');
            setStartedAt(Date.now());
            void startListening();
          }
        },
        onClosed: () => {
          void api.getCall(callId).then(
            (call) => endWith(ENDED_WORDS[call.status] ?? 'The call ended.'),
            () => endWith('The call ended.'),
          );
        },
      });
      peerRef.current = peer;
      try {
        await peer.start();
      } catch {
        setLink('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, endWith, startListening]);

  // Leaving the page hangs up.
  useEffect(
    () => () => {
      if (!doneRef.current) {
        peerRef.current?.hangUp();
        stopAll();
      }
    },
    [stopAll],
  );

  // The clock, and the Shield's view of the call for the presenter.
  useEffect(() => {
    if (phase !== 'in_call') return;
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    const poll = window.setInterval(() => {
      api.getCall(callId).then(
        (call) => {
          const last = call.risk[call.risk.length - 1];
          if (last) setRisk({ level: last.level, reason: last.reason });
          setAlerted(call.shield?.alerted ?? 0);
        },
        () => undefined,
      );
    }, RISK_POLL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [callId, phase]);

  useEffect(() => {
    if (phase !== 'in_call' || link === 'connected') return;
    const timer = window.setTimeout(() => setSlow(true), LINK_PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, link]);

  const hangUp = () => {
    const wasRinging = phaseRef.current === 'ringing' || phaseRef.current === 'starting';
    peerRef.current?.hangUp();
    if (wasRinging) void api.decline(callId).catch(() => undefined);
    else void api.endCall(callId, 'user').catch(() => undefined);
    endWith('You hung up.');
  };

  const toggleMute = () => {
    const next = !muted;
    micRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    listenRef.current?.setMuted(next);
    setMuted(next);
  };

  const who = name ?? 'your family';
  const status =
    phase === 'starting'
      ? 'Starting…'
      : phase === 'ringing'
        ? 'Calling…'
        : phase === 'in_call' && startedAt
          ? clock((now - startedAt) / 1000)
          : endedText;

  return (
    <div className="phone-page caller-page">
      <audio id="caller-remote-audio" autoPlay playsInline />
      <main className="phone-screen phone-dark phone-in-call caller-screen">
        {problem ? (
          <div className="call-head">
            <h1 className="call-title">This call can't start</h1>
            <p className="caller-note">{problem}</p>
            {familyId && (
              <Link className="caller-back" to={`/family/${familyId}`}>
                Back to the family page
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="call-head">
              <span className="call-avatar call-avatar--small" aria-hidden="true">
                <UserRound size={36} strokeWidth={1.6} />
              </span>
              <h1 className="call-title">{who}</h1>
              <p className="call-timer" aria-live="polite">
                {status}
              </p>
              {phase === 'in_call' && (slow || link === 'failed') && link !== 'connected' && (
                <p className="caller-note">No sound link yet. Stand together and talk: Callback still listens.</p>
              )}
            </div>

            {phase === 'in_call' && (
              <section className={`caller-shield caller-shield--${risk?.level ?? 'green'}`} aria-live="polite">
                <p className="caller-shield__head">
                  {risk?.level === 'red' ? <ShieldAlert size={18} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
                  Shield on {who}'s phone:{' '}
                  <strong>{risk?.level === 'red' ? 'warning shown' : risk?.level === 'yellow' ? 'watching closely' : 'listening'}</strong>
                </p>
                {risk?.reason && <p className="caller-shield__reason">{risk.reason}</p>}
                {alerted > 0 && (
                  <p className="caller-shield__alert">
                    Family alerted ({alerted} {alerted === 1 ? 'person' : 'people'})
                  </p>
                )}
              </section>
            )}

            {phase === 'in_call' && (
              <section className="caller-heard" aria-label="What Callback heard">
                <h2>What Callback heard</h2>
                {lines.length === 0 ? (
                  <p className="caller-heard__empty">Start talking. Each sentence shows here.</p>
                ) : (
                  <ul>
                    {lines.map((line, index) => (
                      <li key={`${index}-${line}`}>{line}</li>
                    ))}
                  </ul>
                )}
                {listenNote && <p className="caller-note">{listenNote}</p>}
              </section>
            )}

            {phase === 'ended' ? (
              <div className="caller-ended">
                {familyId && (
                  <Link className="caller-back" to={`/family/${familyId}`}>
                    Back to the family page
                  </Link>
                )}
                <Link className="caller-back caller-back--quiet" to={`/calls/${callId}`}>
                  See the call
                </Link>
              </div>
            ) : (
              <div className="call-buttons caller-buttons">
                {phase === 'in_call' && (
                  <div className="call-button">
                    <button
                      type="button"
                      className={`round-button caller-mute ${muted ? 'is-on' : ''}`}
                      onClick={toggleMute}
                      aria-pressed={muted}
                      aria-label={muted ? 'Unmute' : 'Mute'}
                    >
                      {muted ? <MicOff size={28} aria-hidden="true" /> : <Mic size={28} aria-hidden="true" />}
                    </button>
                    <span>{muted ? 'Unmute' : 'Mute'}</span>
                  </div>
                )}
                <div className="call-button">
                  <button type="button" className="round-button round-button--red" onClick={hangUp} aria-label="End call">
                    <PhoneOff size={32} aria-hidden="true" />
                  </button>
                  <span>End</span>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
