// Step 2: each member reads a short text for one minute; the recording opens
// with their spoken consent and is sent to POST /api/members/{id}/voice.

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, Mic, RotateCcw, SkipForward, Square } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { Avatar } from '../../components/atoms/Avatar';
import { Badge } from '../../components/atoms/Badge';
import { canRecord, MAX_SECONDS, MIN_SECONDS, useVoiceRecorder, type Recording } from './useVoiceRecorder';
import { avatarColor, initials, type SignUpMember } from './signUpTypes';

type VoiceState =
  | { kind: 'todo' }
  | { kind: 'uploading' }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string }
  | { kind: 'skipped' };

type VoiceStates = Record<string, VoiceState>;

function readingText(name: string): string[] {
  return [
    `I'm ${name}, and I agree to Callback cloning my voice for practice calls inside my family.`,
    "Most mornings I start with a cup of tea and the radio on, before anyone else is up. At the weekend I like a long walk, even when the weather can't make up its mind.",
    'Last summer we spent a whole afternoon by the lake, and nobody wanted to go home. I still think about that picnic: fresh bread, cheese, and far too many strawberries.',
    "When I ring, I usually ask how you are, what you had for dinner, and whether you're sleeping well. If a call ever sounds like me but asks for money in a hurry, hang up and ring me back on the number you know.",
    "I'd much rather you check than worry. Talk soon, and look after yourselves.",
  ];
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function initialState(member: SignUpMember): VoiceState {
  if (member.voiceStatus === 'ready') return { kind: 'ready' };
  if (member.voiceStatus === 'failed') return { kind: 'failed', message: 'The last recording did not work. Please record again.' };
  return { kind: 'todo' };
}

function fileName(name: string, extension: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'voice';
  return `${slug}-voice.${extension}`;
}

const needsRecording = (state: VoiceState | undefined) => !state || state.kind === 'todo' || state.kind === 'failed';

type Props = {
  members: SignUpMember[];
  onNext: () => void;
  onBack?: () => void;
  /** A member's voice is now ready, so the page can remember it between steps. */
  onReady?: (memberId: string) => void;
};

export function VoiceStep({ members, onNext, onBack, onReady }: Props) {
  const [states, setStates] = useState<VoiceStates>(() =>
    Object.fromEntries(members.map((member) => [member.id, initialState(member)])),
  );
  const statesRef = useRef(states);
  const [openId, setOpenId] = useState<string | null>(
    () => members.find((member) => needsRecording(initialState(member)))?.id ?? null,
  );
  const [playback, setPlayback] = useState<Record<string, string>>({});
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  useEffect(() => () => Object.values(playbackRef.current).forEach((url) => URL.revokeObjectURL(url)), []);

  const setState = (id: string, state: VoiceState): VoiceStates => {
    const latest = { ...statesRef.current, [id]: state };
    statesRef.current = latest;
    setStates(latest);
    return latest;
  };

  // After someone is done, open the next person who still needs to record.
  const openNext = (afterId: string, latest: VoiceStates) => {
    const next = members.find((member) => member.id !== afterId && needsRecording(latest[member.id]));
    setOpenId(next?.id ?? null);
  };

  const upload = async ({ memberId, audio, extension }: Recording) => {
    const member = members.find((item) => item.id === memberId);
    if (!member) return;
    const url = URL.createObjectURL(audio);
    setPlayback((current) => {
      if (current[memberId]) URL.revokeObjectURL(current[memberId]);
      return { ...current, [memberId]: url };
    });
    setState(memberId, { kind: 'uploading' });
    try {
      await api.uploadVoice(memberId, audio, fileName(member.name, extension));
      openNext(memberId, setState(memberId, { kind: 'ready' }));
      onReady?.(memberId);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'The recording could not be sent. Please try again.';
      setState(memberId, { kind: 'failed', message });
      setOpenId(memberId);
    }
  };

  const recorder = useVoiceRecorder({
    onRecorded: (recording) => void upload(recording),
    onError: (memberId, message) => {
      setState(memberId, { kind: 'failed', message });
      setOpenId(memberId);
    },
  });

  const skip = (memberId: string) => openNext(memberId, setState(memberId, { kind: 'skipped' }));

  const busy = recorder.phase !== 'idle' || Object.values(states).some((state) => state.kind === 'uploading');
  const readyCount = members.filter((member) => states[member.id]?.kind === 'ready').length;
  const recordingSupported = canRecord();

  return (
    <div className="voice-step">
      <div className="auth-card signup-card">
        <div className="auth-card-header">
          <div>
            <small>Step 2 of 3</small>
            <h2>Everyone's voice</h2>
          </div>
          <span className="mini-badge">
            {readyCount} of {members.length} ready
          </span>
        </div>
        <p className="step-intro">
          Hand the laptop to each person in turn. They read the text out loud for one minute, in a quiet room. The first
          sentence is their consent, so only they may record it. You can skip someone and record them later.
        </p>
        {!recordingSupported ? (
          <div className="form-alert" role="alert">
            This browser cannot record audio. Open this page in Chrome, Edge or Safari to record.
          </div>
        ) : null}
      </div>

      <div className="voice-list">
        {members.map((member, index) => {
          const state = states[member.id] ?? { kind: 'todo' };
          const isRecording = recorder.memberId === member.id;
          const showBody = isRecording || (openId === member.id && state.kind !== 'uploading');
          const canStop = recorder.phase === 'recording' && recorder.elapsed >= MIN_SECONDS;

          return (
            <section key={member.id} className={`voice-card${showBody ? ' open' : ''}${isRecording ? ' recording' : ''}`}>
              <header className="voice-card-head">
                <div className="member-card-head">
                  <Avatar initials={initials(member.name)} color={avatarColor(index)} />
                  <div>
                    <h4>{member.name}</h4>
                    {member.relationship ? <p>{member.relationship}</p> : null}
                  </div>
                </div>
                <VoiceBadge state={state} recording={isRecording} />
              </header>

              {showBody ? (
                <div className="voice-card-body">
                  {state.kind === 'failed' && !isRecording ? (
                    <div className="form-alert" role="alert">
                      <CircleAlert size={16} /> <span>{state.message}</span>
                    </div>
                  ) : null}

                  <div className={`reading-text${isRecording ? ' live' : ''}`}>
                    <span className="eyebrow">{isRecording ? `${member.name}, read this out loud` : 'The text to read'}</span>
                    {readingText(member.name).map((sentence, sentenceIndex) => (
                      <p key={sentenceIndex} className={sentenceIndex === 0 ? 'consent-line' : undefined}>
                        {sentence}
                      </p>
                    ))}
                  </div>

                  {isRecording ? (
                    <div className="record-bar">
                      <div className="record-clock">
                        <span className="rec-dot" aria-hidden="true" />
                        <strong>{recorder.phase === 'starting' ? 'Starting…' : clock(MAX_SECONDS - recorder.elapsed)}</strong>
                        <small>{recorder.phase === 'starting' ? 'Allow the microphone if the browser asks' : 'left'}</small>
                      </div>
                      <div className="record-progress" aria-hidden="true">
                        <div style={{ width: `${Math.min(100, (recorder.elapsed / MAX_SECONDS) * 100)}%` }} />
                        <i style={{ left: `${(MIN_SECONDS / MAX_SECONDS) * 100}%` }} />
                      </div>
                      <button type="button" className="button button-secondary" onClick={recorder.stop} disabled={!canStop}>
                        <Square size={14} /> {canStop ? 'Stop' : `Stop in ${clock(MIN_SECONDS - recorder.elapsed)}`}
                      </button>
                    </div>
                  ) : (
                    <div className="voice-actions">
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => void recorder.start(member.id)}
                        disabled={busy || !recordingSupported}
                      >
                        {state.kind === 'ready' || state.kind === 'failed' ? <RotateCcw size={16} /> : <Mic size={16} />}
                        {state.kind === 'failed' ? 'Try again' : state.kind === 'ready' ? 'Record again' : 'Start recording'}
                      </button>
                      {needsRecording(state) ? (
                        <button type="button" className="button button-ghost" onClick={() => skip(member.id)} disabled={busy}>
                          <SkipForward size={16} /> Skip for now
                        </button>
                      ) : null}
                      <small>One minute. You can stop after 20 seconds, but a full minute sounds most natural.</small>
                    </div>
                  )}
                </div>
              ) : null}

              {state.kind === 'uploading' ? (
                <div className="voice-card-body voice-working">
                  <LoaderCircle size={18} className="spin" />
                  <span>Making {member.name}'s voice. This takes a few seconds.</span>
                </div>
              ) : null}

              {!showBody && state.kind !== 'uploading' ? (
                <div className="voice-card-foot">
                  {state.kind === 'ready' ? (
                    <span className="voice-note good">Voice ready. Callback can use it for practice calls inside this family.</span>
                  ) : state.kind === 'skipped' ? (
                    <span className="voice-note">Skipped. You can record {member.name} later from the family page.</span>
                  ) : state.kind === 'failed' ? (
                    <span className="voice-note bad">{state.message}</span>
                  ) : (
                    <span className="voice-note">Not recorded yet.</span>
                  )}
                  <button type="button" className="text-button" onClick={() => setOpenId(member.id)} disabled={busy}>
                    {state.kind === 'ready' ? 'Record again' : state.kind === 'failed' ? 'Try again' : 'Record now'}
                  </button>
                </div>
              ) : null}

              {playback[member.id] && state.kind === 'ready' && !isRecording ? (
                <div className="voice-playback">
                  <small>Listen back</small>
                  <audio controls src={playback[member.id]} />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="step-footer">
        {onBack ? (
          <button type="button" className="button button-secondary" onClick={onBack} disabled={busy}>
            <ArrowLeft size={16} /> Family page
          </button>
        ) : null}
        <span>
          {readyCount === members.length
            ? 'Every voice is ready.'
            : `${readyCount} of ${members.length} voices ready. A practice call in a family voice needs at least one.`}
        </span>
        <button type="button" className="button button-primary" onClick={onNext} disabled={busy}>
          Next: phone links <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

function VoiceBadge({ state, recording }: { state: VoiceState; recording: boolean }) {
  if (recording) return <Badge tone="accent">Recording</Badge>;
  switch (state.kind) {
    case 'ready':
      return <Badge tone="good">Voice ready</Badge>;
    case 'uploading':
      return <Badge tone="neutral">Sending</Badge>;
    case 'failed':
      return <Badge tone="accent">Try again</Badge>;
    case 'skipped':
      return <Badge tone="neutral">Skipped</Badge>;
    default:
      return <Badge tone="neutral">Not recorded</Badge>;
  }
}
