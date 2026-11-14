// The phone page's engine: polls phone-state every second, rings, runs the
// ElevenLabs conversation, sends its events, ends the call exactly once and
// waits for the lesson. Ported from backend/app/static/dev_phone.html, the
// bare test phone that first made real calls work.
//
// A page that closes or reloads mid-call (pagehide) still sends its queued
// events and the end (lastWords.ts), and a practice answered in this tab
// gets its reveal back after a reload (openPractice.ts).
//
// The welcome call also records the member's own side (voiceRecorder.ts) and
// uploads it when the call ends, for a copy of their voice after a spoken
// yes, but only when they ticked the voice box at join: nobody else's
// microphone is recorded or sent. A Shield call shows phone-state.shield's
// live warning (ShieldWarning).

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Conversation } from '@elevenlabs/client';
import type { DisconnectionDetails, PartialOptions } from '@elevenlabs/client';
import { ApiError, api } from '../../api/client';
import { isOutcome, isTactic } from '../../api/types';
import type { CallKind, EndedBy, FamilyLineStarted, Session } from '../../api/types';
import { primedAudio } from './audioUnlock';
import { EventQueue, isTransient } from './eventQueue';
import { sendLastWords, type LastWords } from './lastWords';
import {
  SHOW_ENDED_FOR_MS, clearOpenPractice, readOpenPractice, saveOpenPractice, updateOpenPractice, type OpenPractice,
} from './openPractice';
import { PhoneSound, type SoundStatus } from './phoneSound';
import { initialPhoneState, phoneReducer, type PhoneAction, type PhoneUiState, type RevealKind } from './phoneState';
import { FINAL_VOICE_STATES, WelcomeRecorder, uploadProblem, uploadRecording, type Recording } from './voiceRecorder';

const POLL_EVERY_MS = 1000;
const SCORE_POLL_EVERY_MS = 1500;
const SCORE_POLL_TRIES = 60; // about a minute and a half
const MAX_TURN_LENGTH = 4000; // the back end's limit for one line
/** Events still unsent after the end keep trying this long in the background. */
const LINGER_EVERY_MS = 2000;
const LINGER_FOR_MS = 10 * 60 * 1000;
/** The voice copy: ask how it is going this often, for about two minutes. */
const VOICE_POLL_EVERY_MS = 1500;
const VOICE_POLL_TRIES = 80;
/** A spoken yes can still arrive in a late batch: wait this many polls for it. */
const VOICE_WAIT_FOR_YES_TRIES = 14;

type Overrides = NonNullable<PartialOptions['overrides']>;

/** One call on this phone, from answer to the end the back end has heard. */
type CallRun = {
  callId: string;
  kind: CallKind;
  /** A practice drill or a Shield demo call (reveal.kind). */
  revealKind: RevealKind;
  voiceOf: string | null;
  queue: EventQueue;
  conversation: Conversation | null;
  finished: boolean;
  /** Set when we end the call ourselves, so onDisconnect reports it right. */
  endingBy: EndedBy | null;
  /** How it ended, once finished. */
  endedBy: EndedBy | null;
  /** The end has gone to the back end (or to the closing page's last words). */
  endSent: boolean;
  /** The welcome call's consent answer, if the agent reported one. */
  consent: boolean | null;
  /** The welcome call's answer about a copy of their voice. */
  voiceConsent: boolean | null;
  /** The welcome call: whether they ticked "Callback may make a copy of my
   * voice" at join, asked while the call is answered. */
  mayRecord: Promise<boolean> | null;
  /** The welcome call's recording of their own microphone. */
  recorder: WelcomeRecorder | null;
  /** The recording, once stopped at the end of the call. */
  recording: Promise<Recording | null> | null;
};

/** An answer on its way: End (or the page closing) can come before the session. */
type PendingAnswer = { callId: string; cancelledBy: EndedBy | null };

/** The "Something's wrong?" button. */
export type AlertState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; alerted: number }
  | { status: 'error'; message: string };

function newRun(callId: string, session: Session, mayRecord: Promise<boolean> | null = null): CallRun {
  return {
    callId,
    kind: session.kind,
    revealKind: session.reveal?.kind === 'shield' ? 'shield' : 'practice',
    voiceOf: session.reveal?.voice_of ?? null,
    queue: new EventQueue(callId),
    conversation: null,
    finished: false,
    endingBy: null,
    endedBy: null,
    endSent: false,
    consent: null,
    voiceConsent: null,
    mayRecord,
    recorder: null,
    recording: null,
  };
}

/** Did they tick the voice box at join (and are still in)? Asked fresh for
 * each welcome call, since they can change it any time. Anything unclear is
 * a no: no recording without the tick. */
async function cloneTicked(memberId: string): Promise<boolean> {
  try {
    const join = await api.getJoin(memberId);
    return join.consents.clone_from_call && !join.opted_out;
  } catch (error) {
    console.warn('Callback: could not check the voice choice, so the welcome call is not recorded:', error);
    return false;
  }
}

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

/** A copy of their voice needs a clear yes: true only for a real true. */
function voiceConsentGiven(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
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

const FOUND_RINGING_CHECKS = 6;
const FOUND_RINGING_EVERY_MS = 1500;

/** Ending a practice found after a reload. 'never_answered' when the back
 * end says it was not answered (or does not know it): nothing to reveal.
 * The answer sent just before the reload can still be on its way (the back
 * end fetches the voice token first), so a call that is still ringing is
 * asked again for a few seconds before giving up. */
async function endFoundCall(callId: string): Promise<'ended' | 'never_answered'> {
  let transient = 0;
  let ringing = 0;
  for (;;) {
    try {
      await api.endCall(callId, 'error');
      return 'ended';
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return 'never_answered';
      if (error instanceof ApiError && error.code === 'not_answered') {
        ringing += 1;
        if (ringing >= FOUND_RINGING_CHECKS) return 'never_answered';
        await sleep(FOUND_RINGING_EVERY_MS);
        continue;
      }
      if (!isTransient(error)) return 'ended';
      transient += 1;
      if (transient >= 5) return 'ended'; // the reveal still shows; the server times the call out
      await sleep(500 * transient);
    }
  }
}

export function usePhone(memberId: string) {
  const [state, dispatch] = useReducer(phoneReducer, initialPhoneState);
  // A synchronous copy, so taps and callbacks always see the latest state.
  const stateRef = useRef<PhoneUiState>(initialPhoneState);
  const [sound, setSound] = useState<SoundStatus>('off');
  const [soundBusy, setSoundBusy] = useState(false);
  const [alert, setAlert] = useState<AlertState>({ status: 'idle' });
  const [welcomeStart, setWelcomeStart] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  /** The welcome call's own recording is running (shown on the call screen). */
  const [recording, setRecording] = useState(false);
  const soundRef = useRef<PhoneSound | null>(null);
  const runRef = useRef<CallRun | null>(null);
  const pendingRef = useRef<PendingAnswer | null>(null);
  /** Finished calls whose last events are still being retried. */
  const lingeringRef = useRef(new Set<EventQueue>());
  const aliveRef = useRef(false);
  /** "Call {name}" on the Shield warning with no number: the family line
   * starts as soon as this call's reveal can call it. */
  const callBackAfterRef = useRef<string | null>(null);
  const historyAskedRef = useRef(false);
  // A practice this tab answered before a reload, read once at the start.
  const [found] = useState<OpenPractice | null>(() => readOpenPractice(memberId));
  const recoveryRef = useRef<OpenPractice | null>(found);
  const recoveryStartedRef = useRef(false);

  const act = useCallback((action: PhoneAction) => {
    stateRef.current = phoneReducer(stateRef.current, action);
    dispatch(action);
  }, []);

  // ------------------------------------------------------------ the welcome call's recording

  /** Upload their side of the welcome call, then follow the voice copy
   * until it is ready, failed or not kept. The thank-you screen shows it. */
  const sendVoice = useCallback(
    async (run: CallRun) => {
      const { callId } = run;
      const recording = run.recording ? await run.recording : null;
      if (!recording) {
        if (run.recorder?.problem) console.warn('Callback: nothing recorded on the welcome call:', run.recorder.problem);
        act({ type: 'voice', progress: { callId, phase: 'no_recording', state: null, reason: null } });
        return;
      }
      act({ type: 'voice', progress: { callId, phase: 'uploading', state: null, reason: null } });
      try {
        const accepted = await uploadRecording(callId, recording);
        act({
          type: 'voice',
          progress: { callId, phase: 'checking', state: accepted.cloning ? 'cloning' : null, reason: accepted.reason ?? null },
        });
      } catch (error) {
        console.warn('Callback: the recording could not be uploaded:', error);
        act({ type: 'voice', progress: { callId, phase: 'upload_failed', state: null, reason: uploadProblem(error) } });
        return;
      }
      let waitingForYes = 0;
      let last: { state: NonNullable<PhoneUiState['voice']>['state']; reason: string | null } = { state: null, reason: null };
      for (let tries = 0; tries < VOICE_POLL_TRIES; tries += 1) {
        await sleep(VOICE_POLL_EVERY_MS);
        if (!aliveRef.current) return;
        try {
          const status = await api.voiceSampleStatus(callId);
          last = { state: status.state, reason: status.reason ?? null };
          const final = FINAL_VOICE_STATES.includes(status.state);
          if (status.state === 'waiting_for_consent') waitingForYes += 1;
          const done = final || waitingForYes > VOICE_WAIT_FOR_YES_TRIES;
          act({ type: 'voice', progress: { callId, phase: done ? 'final' : 'checking', ...last } });
          if (done) return;
        } catch (error) {
          console.warn('Callback: could not read the voice status yet:', error);
        }
      }
      act({ type: 'voice', progress: { callId, phase: 'final', ...last } });
    },
    [act],
  );

  // ------------------------------------------------------------ ending a call

  /** The local part of the end, the same for every way a call ends: stop the
   * conversation and the recording, queue `revealed` for a practice, show the
   * next screen. */
  const close = useCallback(
    (run: CallRun, endedBy: EndedBy) => {
      run.finished = true;
      run.endedBy = endedBy;
      if (run.kind === 'practice') run.queue.push({ type: 'revealed' });
      run.queue.stop();
      const conversation = run.conversation;
      run.conversation = null;
      conversation?.endSession().catch(() => undefined); // nothing happens if it already ended
      // The microphone stops with the call.
      if (run.recorder && !run.recording) run.recording = run.recorder.finish();
      if (run.recorder) setRecording(false);
      act({
        type: 'finished',
        callId: run.callId,
        kind: run.kind,
        endedBy,
        voiceOf: run.voiceOf,
        consent: run.consent,
        voiceConsent: run.voiceConsent,
        revealKind: run.revealKind,
      });
    },
    [act],
  );

  const finish = useCallback(
    async (run: CallRun, endedBy: EndedBy) => {
      if (run.finished) return; // exactly once
      close(run, endedBy);
      const drained = await run.queue.drain();
      if (!run.endSent) {
        run.endSent = true;
        await endWithRetry(run.callId, endedBy);
      }
      // After the end, as the back end expects; the screen does not wait for it.
      if (run.kind === 'welcome' && run.recorder) void sendVoice(run);
      else if (run.kind === 'welcome' && run.mayRecord && !(await run.mayRecord)) {
        // Not recorded: they did not tick the voice box when they joined.
        act({ type: 'voice', progress: { callId: run.callId, phase: 'not_allowed', state: null, reason: null } });
      }
      if (!drained && run.queue.size > 0) {
        // Never lose events: the end has gone, the rest keep trying (the back
        // end still takes them after the end).
        const lingering = lingeringRef.current;
        lingering.add(run.queue);
        run.queue.linger(LINGER_EVERY_MS, LINGER_FOR_MS, () => lingering.delete(run.queue));
      }
      if (run.kind === 'practice') updateOpenPractice(memberId, run.callId, { endedBy });
      if (runRef.current === run) runRef.current = null;
      act({ type: 'end_sent', callId: run.callId });
    },
    [act, close, memberId, sendVoice],
  );

  /** The page is going away (reload, pull-to-refresh, tab closed): the
   * requests above would be cancelled, so the end and the queued events go
   * as keepalive requests now. A recording cannot go that way: it is dropped. */
  const sayLastWords = useCallback(() => {
    const words: LastWords[] = [];
    const pending = pendingRef.current;
    if (pending && !pending.cancelledBy) {
      pending.cancelledBy = 'error';
      words.push({ callId: pending.callId, events: [], endedBy: 'error' });
    }
    const run = runRef.current;
    if (run && !run.endSent) {
      run.recorder?.discard();
      if (!run.finished) {
        run.endingBy = 'error';
        close(run, 'error');
      }
      run.endSent = true;
      words.push({ callId: run.callId, events: run.queue.takeAll(), endedBy: run.endedBy ?? 'error' });
      act({ type: 'end_sent', callId: run.callId });
    }
    for (const queue of lingeringRef.current) {
      const events = queue.takeAll();
      if (events.length > 0) words.push({ callId: queue.callId, events, endedBy: null });
    }
    if (words.length > 0) sendLastWords(words);
  }, [act, close]);

  // ------------------------------------------------------------ running a call

  const runCall = useCallback(
    async (run: CallRun, session: Session) => {
      const { callId, queue } = run;
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
                if (run.finished || given === null) return;
                run.consent = given;
                queue.push({ type: 'consent', given });
              },
              voice_consent_result: (parameters: unknown) => {
                if (run.finished) return;
                const given = voiceConsentGiven(param(parameters, 'given'));
                run.voiceConsent = given;
                queue.push({ type: 'voice_consent', given });
              },
            };

      // The welcome call records their own microphone, opened just before
      // the call's own (see voiceRecorder.ts for why first), and only when
      // they ticked the voice box at join.
      if (session.kind === 'welcome') {
        const allowed = run.mayRecord ? await run.mayRecord : false;
        if (run.finished) return; // ended meanwhile: finish() has it
        if (allowed) {
          const recorder = new WelcomeRecorder();
          run.recorder = recorder;
          await recorder.start();
          if (run.finished) return; // ended while the microphone opened: finish() has it
          setRecording(recorder.recording);
          // A slow microphone prompt can outlast start()'s wait: the notice
          // still appears the moment recording really begins.
          if (!recorder.recording) {
            void recorder.opened.then(() => {
              if (!run.finished) setRecording(recorder.recording);
            });
          }
        }
      }

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
    const at = Date.now();
    act({ type: 'answer', call, at });
    const pending: PendingAnswer = { callId: call.call_id, cancelledBy: null };
    pendingRef.current = pending;
    // Asked alongside the answer, so the welcome call does not wait for it.
    const mayRecord = call.kind === 'welcome' ? cloneTicked(memberId) : null;
    if (call.kind === 'practice') {
      saveOpenPractice(memberId, { callId: call.call_id, voiceOf: null, voiceKnown: false, at, endedBy: null });
    }
    let session: Session;
    try {
      session = await api.answer(call.call_id);
    } catch (error) {
      if (pendingRef.current === pending) pendingRef.current = null;
      // A page that is closing keeps the saved practice for after the reload.
      if (call.kind === 'practice' && pending.cancelledBy !== 'error') clearOpenPractice(memberId, at);
      // The answer may have reached the back end before the line dropped:
      // end it, which changes nothing if it was never answered.
      if (isTransient(error)) void endWithRetry(call.call_id, 'error');
      // No voice was heard, so no reveal screen, but a practice still says what it was.
      const message =
        call.kind === 'practice' ? 'That was a Callback practice call, but it could not connect.' : plainError(error);
      act({ type: 'answer_failed', callId: call.call_id, message });
      return;
    }
    if (pendingRef.current === pending) pendingRef.current = null;
    if (call.kind === 'practice') {
      updateOpenPractice(memberId, call.call_id, {
        voiceOf: session.reveal?.voice_of ?? null,
        voiceKnown: true,
        shield: session.reveal?.kind === 'shield',
      });
    }
    const run = newRun(call.call_id, session, mayRecord);
    if (pending.cancelledBy || !aliveRef.current) {
      // End was tapped (or the page went away) while the answer was on its
      // way: end it the normal way, without starting the voice.
      // (A closing page's end may have reached the back end before the
      // answer did, so the end is always sent again here; a second end is ok.)
      const endedBy = pending.cancelledBy ?? 'error';
      run.endingBy = endedBy;
      runRef.current = run;
      await finish(run, endedBy);
      return;
    }
    await runCall(run, session);
  }, [act, finish, memberId, runCall]);

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
    if (run && !run.finished) {
      run.endingBy = 'user';
      void finish(run, 'user'); // ends the session first, then tells the back end
      return;
    }
    // Still answering: end as soon as the answer comes back.
    const pending = pendingRef.current;
    if (pending && !pending.cancelledBy) {
      pending.cancelledBy = 'user';
      act({ type: 'ending', callId: pending.callId });
    }
  }, [act, finish]);

  /** "Call {name}" on the Shield's warning. With their number, the tel: link
   * opens the phone's dialler and this ends the call here; without it, the
   * family line starts once the call has ended. */
  const callBackFromShield = useCallback(
    (hasNumber: boolean) => {
      const view = stateRef.current.view;
      if (view.name !== 'in_call') return;
      if (!hasNumber) callBackAfterRef.current = view.callId;
      hangUp();
    },
    [hangUp],
  );

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
    // The person has moved on from the reveal: a reload no longer brings it back.
    clearOpenPractice(memberId);
    act({ type: 'family_line_started', callId: started.call_id, at: Date.now() });
    await runCall(newRun(started.call_id, started.session), started.session);
  }, [act, memberId, runCall]);

  const done = useCallback(() => {
    clearOpenPractice(memberId);
    act({ type: 'done' });
  }, [act, memberId]);
  const dismissNotice = useCallback(() => act({ type: 'dismiss_notice' }), [act]);

  const dismissMessage = useCallback(
    (id: number) => {
      act({ type: 'hide_messages', ids: [id] });
      api.markMessagesRead(memberId, [id]).catch(() => act({ type: 'show_messages', ids: [id] }));
    },
    [act, memberId],
  );

  /** "Start my welcome call": it rings here on the next poll. The tap also
   * switches the sound on, if it is not on yet, so the ring is heard. */
  const startWelcomeCall = useCallback(() => {
    if (sound !== 'on' && !soundBusy) switchOnSound();
    setWelcomeStart({ busy: true, error: null });
    void api.startWelcomeCall(memberId).then(
      () => {
        if (!aliveRef.current) return;
        act({ type: 'welcome_requested' });
        setWelcomeStart({ busy: false, error: null });
      },
      (error: unknown) => {
        if (!aliveRef.current) return;
        const message =
          error instanceof ApiError && error.code === 'busy'
            ? 'Another call is on its way. Please wait for it to finish, then try again.'
            : plainError(error, 'The welcome call could not start. Please try again.');
        setWelcomeStart({ busy: false, error: message });
      },
    );
  }, [act, memberId, sound, soundBusy, switchOnSound]);

  /** "Something's wrong?": every other family member gets a message to call. */
  const alertFamily = useCallback(() => {
    setAlert({ status: 'sending' });
    void api.alertFamily(memberId).then(
      (sent) => aliveRef.current && setAlert({ status: 'sent', alerted: sent.alerted }),
      (error: unknown) =>
        aliveRef.current &&
        setAlert({
          status: 'error',
          message: plainError(error, 'Your family could not be told. Please try again, or ring them yourself.'),
        }),
    );
  }, [memberId]);
  const resetAlert = useCallback(() => setAlert({ status: 'idle' }), []);

  // ------------------------------------------------------------ effects

  // Sound lives as long as the page; a call still running when the page goes
  // away is ended, so the back end is not left waiting.
  useEffect(() => {
    aliveRef.current = true;
    const phoneSound = new PhoneSound();
    soundRef.current = phoneSound;
    // The phone can take the sound away again (lock screen, a real call):
    // then the waiting screen asks for a new tap.
    phoneSound.onStatusChange((status) => {
      if (aliveRef.current) setSound(status);
    });
    // Arrived from the Join page: its tap already unlocked sound and the
    // microphone, so the welcome call can ring out loud straight away.
    const primed = primedAudio();
    if (primed) {
      setSoundBusy(true);
      void phoneSound.adopt(primed).then((status) => {
        if (!aliveRef.current || soundRef.current !== phoneSound) return;
        setSound(status);
        setSoundBusy(false);
      });
    }
    return () => {
      aliveRef.current = false;
      phoneSound.dispose();
      soundRef.current = null;
      const run = runRef.current;
      if (run && !run.finished) {
        run.endingBy = 'error';
        void finish(run, 'error');
      }
      const pending = pendingRef.current;
      if (pending && !pending.cancelledBy) pending.cancelledBy = 'error';
    };
  }, [finish]);

  // A reload, a pull-to-refresh or a closed tab: React runs no cleanup then.
  useEffect(() => {
    window.addEventListener('pagehide', sayLastWords);
    return () => window.removeEventListener('pagehide', sayLastWords);
  }, [sayLastWords]);

  // After a reload: the practice this tab answered is ended (if the closing
  // page could not) and its reveal comes back.
  useEffect(() => {
    const saved = recoveryRef.current;
    if (!saved || recoveryStartedRef.current) return;
    recoveryStartedRef.current = true;
    const { callId } = saved;
    const kind: RevealKind = saved.shield ? 'shield' : 'practice';
    if (saved.endedBy && Date.now() - saved.at > SHOW_ENDED_FOR_MS) {
      recoveryRef.current = null;
      clearOpenPractice(memberId, saved.at);
      return;
    }
    if (saved.voiceKnown) {
      act({
        type: 'recovered',
        callId,
        kind,
        voiceOf: saved.voiceOf,
        endedBy: saved.endedBy ?? 'error',
        endSent: saved.endedBy !== null,
      });
    } else {
      // Not answered as far as this page knows: it must not ring here while
      // the back end is asked.
      act({ type: 'recovering', callId });
    }
    const drop = () => {
      clearOpenPractice(memberId, saved.at);
      recoveryRef.current = null;
      act({ type: 'recovery_dropped', callId });
    };
    void (async () => {
      let voiceOf = saved.voiceOf;
      if (saved.endedBy === null) {
        if ((await endFoundCall(callId)) === 'never_answered') {
          drop();
          return;
        }
        updateOpenPractice(memberId, callId, { endedBy: 'error' });
      }
      if (!saved.voiceKnown) {
        // The page closed before the answer came back: was it answered (a
        // call that rang out was not), and whose voice was it?
        try {
          const call = await api.getCall(callId);
          if (!call.answered_at) {
            drop();
            return;
          }
          voiceOf = call.voice_of?.name ?? null;
          updateOpenPractice(memberId, callId, { voiceOf, voiceKnown: true });
        } catch {
          voiceOf = null;
        }
      }
      recoveryRef.current = null;
      if (saved.voiceKnown) act({ type: 'end_sent', callId });
      else act({ type: 'recovered', callId, kind, voiceOf, endedBy: saved.endedBy ?? 'error', endSent: true });
    })();
  }, [act, memberId]);

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

  // Once online: did a welcome call of theirs ever get as far as their
  // answer? If not (and none is ringing), the home screen offers to start
  // one, after a reload too, the same as after the call itself.
  const online = state.link === 'online';
  useEffect(() => {
    if (!online || historyAskedRef.current) return;
    historyAskedRef.current = true;
    api
      .memberVoiceSample(memberId)
      .then(async (status) => {
        if (status.call_id === null) return false;
        const call = await api.getCall(status.call_id).catch(() => null);
        return call ? call.consent_given != null : true;
      })
      .then(
        (answered) => act({ type: 'welcome_history', answered }),
        () => undefined, // the offer still shows after a missed or failed call here
      );
  }, [act, memberId, online]);

  // The ringtone and vibration, while it rings. A new call also means the
  // person has left the last reveal: a reload no longer brings it back.
  const ringing = state.view.name === 'ringing';
  useEffect(() => {
    if (!ringing) return;
    if (!recoveryRef.current) clearOpenPractice(memberId);
    const phoneSound = soundRef.current;
    phoneSound?.startRinging();
    return () => phoneSound?.stopRinging();
  }, [ringing, memberId]);

  // The Shield: phone-state.shield belongs to the call on screen. Its
  // warning buzzes the phone once, when it first appears.
  const shieldNow = state.phone?.shield ?? null;
  const inCallId = state.view.name === 'in_call' ? state.view.callId : null;
  const shield = shieldNow && inCallId && shieldNow.call_id === inCallId ? shieldNow : null;
  const warningFor = shield?.warn ? shield.call_id : null;
  useEffect(() => {
    if (warningFor) soundRef.current?.warn();
  }, [warningFor]);

  // "Call {name}" from the Shield with no number: the family line, as soon
  // as the reveal of the call just ended can start it.
  const revealReadyFor =
    state.view.name === 'reveal' && state.view.endSent && !state.view.startingFamilyLine ? state.view.callId : null;
  useEffect(() => {
    if (!revealReadyFor || callBackAfterRef.current !== revealReadyFor) return;
    callBackAfterRef.current = null;
    void callFamilyNumber();
  }, [callFamilyNumber, revealReadyFor]);

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
    shield,
    alert,
    welcomeStart,
    recording,
    switchOnSound,
    answer,
    decline,
    hangUp,
    callBackFromShield,
    callFamilyNumber,
    done,
    dismissNotice,
    dismissMessage,
    startWelcomeCall,
    alertFamily,
    resetAlert,
  };
}

export type PhoneController = ReturnType<typeof usePhone>;
