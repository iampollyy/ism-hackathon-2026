// The phone page's state: one reducer for what the screen shows.
// waiting -> ringing -> in_call -> reveal (practice) -> family_line -> waiting
//                              \-> welcome_done (welcome call) -> waiting
//
// Pure: no requests here. usePhone.ts does the requests and the conversation
// and reports what happened as actions.

import type { Mode } from '@elevenlabs/client';
import type { CallKind, CallResultView, EndedBy, IncomingCall, PhoneState, VoiceSampleStatus } from '../../api/types';

/** A practice drill, or a Shield demo call (a simulated real scam call). */
export type RevealKind = 'practice' | 'shield';

export type RevealView = {
  name: 'reveal';
  callId: string;
  kind: RevealKind;
  voiceOf: string | null;
  endedBy: EndedBy;
  /** The back end has the end: the family number can be called now. */
  endSent: boolean;
  scoring: 'waiting' | 'done' | 'gave_up';
  result: CallResultView | null;
  startingFamilyLine: boolean;
  familyLineError: string | null;
};

/** The thank-you screen after the welcome call. */
export type WelcomeDoneView = {
  name: 'welcome_done';
  callId: string;
  endedBy: EndedBy;
  /** The voice connected at some point (an error then means it dropped). */
  connected: boolean;
  /** Their spoken answer to practice calls, if the agent reported one. */
  consent: boolean | null;
  /** Their spoken answer to a copy of their voice, if the agent reported one. */
  voiceConsent: boolean | null;
};

export type PhoneView =
  | { name: 'waiting' }
  | { name: 'ringing'; call: IncomingCall }
  | {
      name: 'in_call';
      callId: string;
      kind: 'practice' | 'welcome';
      title: string;
      number: string | null;
      startedAt: number;
      connected: boolean;
      mode: Mode | null;
      /** End was tapped before the call had connected: waiting for the answer to come back. */
      ending: boolean;
    }
  | {
      name: 'family_line';
      callId: string;
      startedAt: number;
      connected: boolean;
      mode: Mode | null;
      /** The reveal it was called from: back there if the line cannot connect. */
      reveal: RevealView | null;
    }
  | RevealView
  | WelcomeDoneView;

/** What became of the recording of their side of the welcome call. */
export type VoiceProgress = {
  callId: string;
  /** not_allowed: not recorded at all, as they did not tick the voice box at join. */
  phase: 'uploading' | 'checking' | 'final' | 'no_recording' | 'upload_failed' | 'not_allowed';
  state: VoiceSampleStatus['state'] | null;
  reason: string | null;
};

export type Notice = { id: number; tone: 'info' | 'good' | 'error'; text: string; missed?: boolean };

export type PhoneUiState = {
  phone: PhoneState | null;
  /** How the link to the back end is doing (from the phone-state polls). */
  link: 'loading' | 'online' | 'offline' | 'not_found';
  view: PhoneView;
  /** Calls already answered, declined or missed here: they never ring again. */
  handled: string[];
  notice: Notice | null;
  noticeSeq: number;
  /** Messages dismissed here, hidden until the back end stops sending them. */
  hiddenMessages: number[];
  /** The recording from the latest welcome call on this page. */
  voice: VoiceProgress | null;
  /** Offer "Start my welcome call": after one was missed, declined or could
   * not connect here, or when they never answered one. */
  welcomeOffer: 'unknown' | 'show' | 'hide';
};

export type PhoneAction =
  | { type: 'phone'; phone: PhoneState }
  | { type: 'phone_failed'; notFound: boolean; failures: number }
  | { type: 'answer'; call: IncomingCall; at: number }
  | { type: 'answer_failed'; callId: string; message: string }
  | { type: 'decline'; callId: string }
  | { type: 'connected'; callId: string }
  | { type: 'mode'; callId: string; mode: Mode }
  | { type: 'ending'; callId: string }
  | {
      type: 'finished';
      callId: string;
      kind: CallKind;
      endedBy: EndedBy;
      voiceOf: string | null;
      /** The welcome call's consent answer, if the agent reported one. */
      consent: boolean | null;
      /** The welcome call's answer about a copy of their voice. */
      voiceConsent: boolean | null;
      revealKind: RevealKind;
    }
  | { type: 'end_sent'; callId: string }
  | {
      type: 'recovered';
      callId: string;
      kind: RevealKind;
      voiceOf: string | null;
      endedBy: EndedBy;
      endSent: boolean;
    }
  | { type: 'recovering'; callId: string }
  | { type: 'recovery_dropped'; callId: string }
  | { type: 'scored'; callId: string; result: CallResultView | null }
  | { type: 'scoring_gave_up'; callId: string }
  | { type: 'family_line_starting' }
  | { type: 'family_line_failed'; message: string }
  | { type: 'family_line_started'; callId: string; at: number }
  | { type: 'done' }
  | { type: 'notice'; tone: Notice['tone']; text: string }
  | { type: 'dismiss_notice' }
  | { type: 'hide_messages'; ids: number[] }
  | { type: 'show_messages'; ids: number[] }
  | { type: 'voice'; progress: VoiceProgress }
  /** Whether they ever answered a welcome call (asked once, on load). */
  | { type: 'welcome_history'; answered: boolean }
  /** "Start my welcome call" was tapped and the call is on its way. */
  | { type: 'welcome_requested' };

export const initialPhoneState: PhoneUiState = {
  phone: null,
  link: 'loading',
  view: { name: 'waiting' },
  handled: [],
  notice: null,
  noticeSeq: 0,
  hiddenMessages: [],
  voice: null,
  welcomeOffer: 'unknown',
};

/** Polls in a row that may fail before the page says the connection is gone. */
const OFFLINE_AFTER = 3;

function withNotice(state: PhoneUiState, tone: Notice['tone'], text: string, missed = false): PhoneUiState {
  const id = state.noticeSeq + 1;
  return { ...state, noticeSeq: id, notice: { id, tone, text, missed } };
}

function remember(handled: string[], callId: string): string[] {
  return handled.includes(callId) ? handled : [...handled.slice(-49), callId];
}

function callIdOf(view: PhoneView): string | null {
  return 'callId' in view ? view.callId : null;
}

function revealView(
  callId: string,
  kind: RevealKind,
  voiceOf: string | null,
  endedBy: EndedBy,
  endSent: boolean,
): RevealView {
  return {
    name: 'reveal',
    callId,
    kind,
    voiceOf,
    endedBy,
    endSent,
    scoring: 'waiting',
    result: null,
    startingFamilyLine: false,
    familyLineError: null,
  };
}

function finishedState(state: PhoneUiState, action: Extract<PhoneAction, { type: 'finished' }>): PhoneUiState {
  if (callIdOf(state.view) !== action.callId) return state;
  if (action.kind === 'practice') {
    // The reveal is certain: every practice call ends here, however it ended.
    return { ...state, view: revealView(action.callId, action.revealKind, action.voiceOf, action.endedBy, false) };
  }
  if (action.kind === 'welcome') {
    // The thank-you screen: its words match what they said on the call.
    return {
      ...state,
      notice: null,
      // No answer yet (the line dropped, or they hung up early): the home
      // screen keeps offering the welcome call, however it ended.
      welcomeOffer: action.consent === null ? 'show' : 'hide',
      view: {
        name: 'welcome_done',
        callId: action.callId,
        endedBy: action.endedBy,
        connected: state.view.name === 'in_call' && state.view.connected,
        consent: action.consent,
        voiceConsent: action.voiceConsent,
      },
    };
  }
  const waiting: PhoneUiState = { ...state, view: { name: 'waiting' } };
  // The family line. If it could not connect, back to the reveal, where the
  // family number button is, so it can be tried again.
  if (action.endedBy === 'error' && state.view.name === 'family_line' && state.view.reveal) {
    return {
      ...state,
      view: {
        ...state.view.reveal,
        startingFamilyLine: false,
        familyLineError: 'The family line could not connect. Please try again.',
      },
    };
  }
  return action.endedBy === 'error'
    ? withNotice(waiting, 'error', 'The family line could not connect.')
    : waiting;
}

export function phoneReducer(state: PhoneUiState, action: PhoneAction): PhoneUiState {
  const view = state.view;
  switch (action.type) {
    case 'phone': {
      const incoming = action.phone.incoming_call;
      let next: PhoneUiState = { ...state, phone: action.phone, link: 'online' };
      const canRing =
        view.name === 'waiting' ||
        view.name === 'welcome_done' ||
        (view.name === 'reveal' && !view.startingFamilyLine);
      if (canRing && incoming && !state.handled.includes(incoming.call_id)) {
        next = { ...next, view: { name: 'ringing', call: incoming }, notice: null };
        if (incoming.kind === 'welcome') next = { ...next, welcomeOffer: 'hide' };
      } else if (view.name === 'ringing' && incoming?.call_id !== view.call.call_id) {
        // It stopped ringing before an answer: missed, or cancelled.
        next = { ...next, view: { name: 'waiting' }, handled: remember(state.handled, view.call.call_id) };
        next =
          view.call.kind === 'welcome'
            ? withNotice({ ...next, welcomeOffer: 'show' }, 'info', 'You missed your welcome call.', true)
            : withNotice(next, 'info', `Missed call from ${view.call.caller.label}.`, true);
      }
      // Forget hidden messages the back end no longer sends.
      const sent = new Set(action.phone.messages.map((message) => message.id));
      const hidden = state.hiddenMessages.filter((id) => sent.has(id));
      if (hidden.length !== state.hiddenMessages.length) next = { ...next, hiddenMessages: hidden };
      return next;
    }

    case 'phone_failed':
      if (action.notFound) return { ...state, link: 'not_found' };
      return action.failures >= OFFLINE_AFTER ? { ...state, link: 'offline' } : state;

    case 'answer':
      if (view.name !== 'ringing' || view.call.call_id !== action.call.call_id) return state;
      return {
        ...state,
        handled: remember(state.handled, action.call.call_id),
        notice: null,
        view: {
          name: 'in_call',
          callId: action.call.call_id,
          kind: action.call.kind,
          title: action.call.kind === 'welcome' ? 'Callback' : action.call.caller.label || 'Unknown number',
          number: action.call.kind === 'welcome' ? null : action.call.caller.number,
          startedAt: action.at,
          connected: false,
          mode: null,
          ending: false,
        },
      };

    case 'answer_failed': {
      if (callIdOf(view) !== action.callId) return state;
      const welcome = view.name === 'in_call' && view.kind === 'welcome';
      const next: PhoneUiState = { ...state, view: { name: 'waiting' }, welcomeOffer: welcome ? 'show' : state.welcomeOffer };
      return withNotice(next, 'error', action.message);
    }

    case 'decline':
      if (view.name !== 'ringing' || view.call.call_id !== action.callId) return state;
      return {
        ...state,
        view: { name: 'waiting' },
        handled: remember(state.handled, action.callId),
        welcomeOffer: view.call.kind === 'welcome' ? 'show' : state.welcomeOffer,
      };

    case 'connected':
      if ((view.name !== 'in_call' && view.name !== 'family_line') || view.callId !== action.callId) return state;
      return view.connected ? state : { ...state, view: { ...view, connected: true } };

    case 'mode':
      if ((view.name !== 'in_call' && view.name !== 'family_line') || view.callId !== action.callId) return state;
      return { ...state, view: { ...view, mode: action.mode, connected: true } };

    case 'ending':
      if (view.name !== 'in_call' || view.callId !== action.callId) return state;
      return { ...state, view: { ...view, ending: true } };

    case 'finished':
      return finishedState(state, action);

    case 'recovered':
      // After a reload: the practice this tab answered gets its reveal back.
      if (view.name !== 'waiting') return state;
      return {
        ...state,
        handled: remember(state.handled, action.callId),
        notice: null,
        view: revealView(action.callId, action.kind, action.voiceOf, action.endedBy, action.endSent),
      };

    case 'recovering':
      // After a reload, while the back end is asked about a call this tab was
      // answering: it does not ring again here meanwhile.
      return { ...state, handled: remember(state.handled, action.callId) };

    case 'recovery_dropped': {
      // The back end says it was never answered: nothing to reveal, and it
      // may ring again.
      const handled = state.handled.filter((id) => id !== action.callId);
      if (view.name !== 'reveal' || view.callId !== action.callId || view.endSent) return { ...state, handled };
      return { ...state, handled, view: { name: 'waiting' } };
    }

    case 'end_sent':
      if (view.name !== 'reveal' || view.callId !== action.callId) return state;
      return { ...state, view: { ...view, endSent: true } };

    case 'scored':
      if (view.name !== 'reveal' || view.callId !== action.callId) return state;
      return { ...state, view: { ...view, scoring: 'done', result: action.result } };

    case 'scoring_gave_up':
      if (view.name !== 'reveal' || view.callId !== action.callId) return state;
      return { ...state, view: { ...view, scoring: 'gave_up' } };

    case 'family_line_starting':
      if (view.name !== 'reveal') return state;
      return { ...state, view: { ...view, startingFamilyLine: true, familyLineError: null } };

    case 'family_line_failed':
      if (view.name !== 'reveal') return withNotice(state, 'error', action.message);
      return { ...state, view: { ...view, startingFamilyLine: false, familyLineError: action.message } };

    case 'family_line_started':
      return {
        ...state,
        notice: null,
        view: {
          name: 'family_line',
          callId: action.callId,
          startedAt: action.at,
          connected: false,
          mode: null,
          reveal: view.name === 'reveal' ? view : null,
        },
      };

    case 'done':
      if (view.name === 'welcome_done') return { ...state, view: { name: 'waiting' } };
      return view.name === 'reveal' && !view.startingFamilyLine ? { ...state, view: { name: 'waiting' } } : state;

    case 'notice':
      return withNotice(state, action.tone, action.text);

    case 'dismiss_notice':
      return { ...state, notice: null };

    case 'hide_messages':
      return { ...state, hiddenMessages: [...new Set([...state.hiddenMessages, ...action.ids])] };

    case 'show_messages':
      return { ...state, hiddenMessages: state.hiddenMessages.filter((id) => !action.ids.includes(id)) };

    case 'voice':
      return { ...state, voice: action.progress };

    case 'welcome_history': {
      if (state.welcomeOffer !== 'unknown') return state;
      // Never answered one, and none is ringing or running here right now.
      const busy = view.name !== 'waiting' || state.phone?.incoming_call?.kind === 'welcome';
      return { ...state, welcomeOffer: !action.answered && !busy ? 'show' : 'hide' };
    }

    case 'welcome_requested':
      return { ...state, welcomeOffer: 'hide' };
  }
}
