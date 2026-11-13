// The phone page's engine: polls phone-state every second, rings, runs the
// ElevenLabs conversation, sends its events, ends the call exactly once and
// waits for the lesson. Ported from backend/app/static/dev_phone.html, the
// bare test phone that first made real calls work.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Conversation } from '@elevenlabs/client';
import type { DisconnectionDetails, PartialOptions } from '@elevenlabs/client';
import { ApiError, api } from '../../api/client';
import { isOutcome, isTactic } from '../../api/types';
import type { CallKind, EndedBy, FamilyLineStarted, Session } from '../../api/types';
import { EventQueue, isTransient } from './eventQueue';
import { PhoneSound, type SoundStatus } from './phoneSound';
import { initialPhoneState, phoneReducer, type PhoneAction, type PhoneUiState } from './phoneState';

const POLL_EVERY_MS = 1000;
const SCORE_POLL_EVERY_MS = 1500;
const SCORE_POLL_TRIES = 60; // about a minute and a half
const MAX_TURN_LENGTH = 4000; // the back end's limit for one line

type Overrides = NonNullable<PartialOptions['overrides']>;

/** One call on this phone, from answer to the end the back end has heard. */
type CallRun = {
  callId: string;
  kind: CallKind;
  voiceOf: string | null;
  queue: EventQueue;
  conversation: Conversation | null;
  finished: boolean;
  /** Set when we end the call ourselves, so onDisconnect reports it right. */
  endingBy: EndedBy | null;
};

/** An error as one plain sentence for the screen. Never a stack. */
export function plainError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!(error instanceof ApiError)) return fallback;
  switch (error.code) {
    case 'not_ringing':
      return 'This call had already stopped ringing.';
    case 'session_failed':
      return 'The call could not connect. Please try again later.';
    default:
      return error.message || fallback;
  }
}

function endedByFor(details: DisconnectionDetails): EndedBy {
  if (details.reason === 'agent') return 'agent';
  if (details.reason === 'user') return 'user';
  return details.context?.type === 'max_duration_exceeded' ? 'timeout' : 'error';
}

/** The agent's consent answer as a boolean; anything unclear is dropped. */
function consentGiven(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === 'yes') return true;
    if (text === 'false' || text === 'no') return false;
  }
  return null;
}

function param(parameters: unknown, name: string): unknown {
  return parameters && typeof parameters === 'object' ? (parameters as Record<string, unknown>)[name] : undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function endWithRetry(callId: string, endedBy: EndedBy): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await api.endCall(callId, endedBy);
      return;
    } catch (error) {
      if (!isTransient(error)) {
        console.warn('Callback: the back end refused the end of the call', error);
        return;
      }
      await sleep(500 * attempt);
    }
  }
  console.warn('Callback: could not report the end of the call; the server will time it out');
}

export function usePhone(memberId: string) {
  const [state, dispatch] = useReducer(phoneReducer, initialPhoneState);
  // A synchronous copy, so taps and callbacks always see the latest state.
  const stateRef = useRef<PhoneUiState>(initialPhoneState);
  const [sound, setSound] = useState<SoundStatus>('off');
  const [soundBusy, setSoundBusy] = useState(false);
  const soundRef = useRef<PhoneSound | null>(null);
  const runRef = useRef<CallRun | null>(null);
  const aliveRef = useRef(false);

  const act = useCallback((action: PhoneAction) => {
    stateRef.current = phoneReducer(stateRef.current, action);
    dispatch(action);
  }, []);

  // ------------------------------------------------------------ ending a call

  const finish = useCallback(
    async (run: CallRun, endedBy: EndedBy) => {
      if (run.finished) return; // exactly once
      run.finished = true;
      if (run.kind === 'practice') run.queue.push({ type: 'revealed' });
      run.queue.stop();
      const conversation = run.conversation;
      run.conversation = null;
      conversation?.endSession().catch(() => undefined); // nothing happens if it already ended
      act({ type: 'finished', callId: run.callId, kind: run.kind, endedBy, voiceOf: run.voiceOf });
      await run.queue.drain();
      await endWithRetry(run.callId, endedBy);
      if (runRef.current === run) runRef.current = null;
      act({ type: 'end_sent', callId: run.callId });
    },
    [act],
  );

  // ------------------------------------------------------------ running a call

  const runCall = useCallback(
    async (callId: string, session: Session) => {
      const queue = new EventQueue(callId);
      const run: CallRun = {
        callId,
        kind: session.kind,
        voiceOf: session.reveal?.voice_of ?? null,
        queue,
        conversation: null,
        finished: false,
        endingBy: null,
      };
      runRef.current = run;
      queue.start(500);

      const clientTools =
        session.kind === 'family_line'
          ? undefined
          : {
              mark_tactic: (parameters: unknown) => {
                const key = param(parameters, 'key');
                if (!run.finished && isTactic(key)) queue.push({ type: 'tactic', key });
              },
              practice_result: (parameters: unknown) => {
                const outcome = param(parameters, 'outcome');
                if (!run.finished && isOutcome(outcome)) queue.push({ type: 'outcome', outcome });
              },
              consent_result: (parameters: unknown) => {
                const given = consentGiven(param(parameters, 'given'));
                if (!run.finished && given !== null) queue.push({ type: 'consent', given });
              },
            };

      try {
        const conversation = await Conversation.startSession({
          conversationToken: session.conversation_token,
          connectionType: 'webrtc',
          overrides: session.overrides as Overrides,
          dynamicVariables: session.dynamic_variables,
          ...(clientTools ? { clientTools } : {}),
          onConnect: () => act({ type: 'connected', callId }),
          onMessage: (message) => {
            const text = (message.message || '').trim().slice(0, MAX_TURN_LENGTH);
            if (!text || run.finished) return;
            const speaker = message.role === 'agent' || message.source === 'ai' ? 'agent' : 'user';
            queue.push({ type: 'turn', speaker, text });
          },
          onModeChange: ({ mode }) => act({ type: 'mode', callId, mode }),
          onError: (message) => console.warn('Callback: conversation error:', message),
          onDisconnect: (details) => void finish(run, run.endingBy ?? endedByFor(details)),
        });
        if (run.finished) {
          // Ended (End tapped, or the page closed) while it was connecting.
          conversation.endSession().catch(() => undefined);
          return;
        }
        run.conversation = conversation;
        act({ type: 'connected', callId });
      } catch (error) {
        console.warn('Callback: the conversation could not start:', error);
        void finish(run, 'error');
      }
    },
    [act, finish],
  );

  // ------------------------------------------------------------ taps

  const switchOnSound = useCallback(() => {
    const phoneSound = soundRef.current;
    if (!phoneSound) return;
    setSoundBusy(true);
    // switchOn's first steps run now, inside the tap, as phones require.
    void phoneSound.switchOn().then((status) => {
      if (!aliveRef.current) return;
      setSound(status);
      setSoundBusy(false);
    });
  }, []);

  const answer = useCallback(async () => {
    const view = stateRef.current.view;
    if (view.name !== 'ringing') return; // a second tap
    const call = view.call;
    soundRef.current?.stopRinging();
    act({ type: 'answer', call, at: Date.now() });
    let session: Session;
    try {
      session = await api.answer(call.call_id);
    } catch (error) {
      // No voice was heard, so no reveal screen, but a practice still says what it was.
      const message =
        call.kind === 'practice' ? 'That was a Callback practice call, but it could not connect.' : plainError(error);
      act({ type: 'answer_failed', callId: call.call_id, message });
      return;
    }
    if (!aliveRef.current) {
      void endWithRetry(call.call_id, 'error');
      return;
    }
    await runCall(call.call_id, session);
  }, [act, runCall]);

  const decline = useCallback(async () => {
    const view = stateRef.current.view;
    if (view.name !== 'ringing') return;
    const callId = view.call.call_id;
    soundRef.current?.stopRinging();
    act({ type: 'decline', callId });
    try {
      await api.decline(callId);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_ringing') return; // it had stopped anyway
      act({ type: 'notice', tone: 'error', text: plainError(error) });
    }
  }, [act]);

  const hangUp = useCallback(() => {
    const run = runRef.current;
    if (!run || run.finished) return;
    run.endingBy = 'user';
    void finish(run, 'user'); // ends the session first, then tells the back end
  }, [finish]);

  const callFamilyNumber = useCallback(async () => {
    const view = stateRef.current.view;
    if (view.name !== 'reveal' || view.startingFamilyLine || !view.endSent) return;
    act({ type: 'family_line_starting' });
    let started: FamilyLineStarted;
    try {
      started = await api.familyLine(memberId);
    } catch (error) {
      act({ type: 'family_line_failed', message: plainError(error) });
      return;
    }
    if (!aliveRef.current) {
      void endWithRetry(started.call_id, 'error');
      return;
    }
    act({ type: 'family_line_started', callId: started.call_id, at: Date.now() });
    await runCall(started.call_id, started.session);
  }, [act, memberId, runCall]);

  const done = useCallback(() => act({ type: 'done' }), [act]);
  const dismissNotice = useCallback(() => act({ type: 'dismiss_notice' }), [act]);

  const dismissMessage = useCallback(
    (id: number) => {
      act({ type: 'hide_messages', ids: [id] });
      api.markMessagesRead(memberId, [id]).catch(() => act({ type: 'show_messages', ids: [id] }));
    },
    [act, memberId],
  );

  // ------------------------------------------------------------ effects

  // Sound lives as long as the page; a call still running when the page goes
  // away is ended, so the back end is not left waiting.
  useEffect(() => {
    aliveRef.current = true;
    const phoneSound = new PhoneSound();
    soundRef.current = phoneSound;
    return () => {
      aliveRef.current = false;
      phoneSound.dispose();
      soundRef.current = null;
      const run = runRef.current;
      if (run && !run.finished) {
        run.endingBy = 'error';
        void finish(run, 'error');
      }
    };
  }, [finish]);

  // phone-state every second, always: it also keeps the phone "online" for the laptop.
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let failures = 0;
    const tick = async () => {
      const started = Date.now();
      try {
        const phone = await api.phoneState(memberId);
        if (stopped) return;
        failures = 0;
        act({ type: 'phone', phone });
      } catch (error) {
        if (stopped) return;
        failures += 1;
        act({ type: 'phone_failed', failures, notFound: error instanceof ApiError && error.status === 404 });
      }
      if (!stopped) timer = window.setTimeout(tick, Math.max(0, POLL_EVERY_MS - (Date.now() - started)));
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [act, memberId]);

  // The ringtone and vibration, while it rings.
  const ringing = state.view.name === 'ringing';
  useEffect(() => {
    if (!ringing) return;
    const phoneSound = soundRef.current;
    phoneSound?.startRinging();
    return () => phoneSound?.stopRinging();
  }, [ringing]);

  // After a practice: ask for the call until it is scored, then show the lesson.
  const scoringCallId =
    state.view.name === 'reveal' && state.view.endSent && state.view.scoring === 'waiting' ? state.view.callId : null;
  useEffect(() => {
    if (!scoringCallId) return;
    let stopped = false;
    let timer = 0;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const call = await api.getCall(scoringCallId);
        if (stopped) return;
        if (call.status === 'scored') {
          // Scored with no result happens when the voice never connected.
          act({ type: 'scored', callId: scoringCallId, result: call.result });
          return;
        }
      } catch (error) {
        if (stopped) return;
        console.warn('Callback: could not read the call yet:', error);
      }
      if (tries >= SCORE_POLL_TRIES) {
        act({ type: 'scoring_gave_up', callId: scoringCallId });
        return;
      }
      timer = window.setTimeout(tick, SCORE_POLL_EVERY_MS);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [act, scoringCallId]);

  return {
    state,
    sound,
    soundBusy,
    switchOnSound,
    answer,
    decline,
    hangUp,
    callFamilyNumber,
    done,
    dismissNotice,
    dismissMessage,
  };
}

export type PhoneController = ReturnType<typeof usePhone>;
