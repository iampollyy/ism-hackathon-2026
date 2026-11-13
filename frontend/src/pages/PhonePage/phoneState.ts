// The phone page's state: one reducer for what the screen shows.
// waiting -> ringing -> in_call -> reveal (practice) -> family_line -> waiting
//
// Pure: no requests here. usePhone.ts does the requests and the conversation
// and reports what happened as actions.

import type { Mode } from '@elevenlabs/client';
import type { CallKind, CallResultView, EndedBy, IncomingCall, PhoneState } from '../../api/types';

export type RevealView = {
  name: 'reveal';
  callId: string;
  voiceOf: string | null;
  endedBy: EndedBy;
  /** The back end has the end: the family number can be called now. */
  endSent: boolean;
  scoring: 'waiting' | 'done' | 'gave_up';
  result: CallResultView | null;
  startingFamilyLine: boolean;
  familyLineError: string | null;
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
  | RevealView;

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
};

export type PhoneAction =
  | { type: 'phone'; phone: PhoneState }
  | { type: 'phone_failed'; notFound: boolean; failures: number }
  | { type: 'answer'; call: IncomingCall; at: number }
  | { type: 'answer_failed'; callId: string; message: string }
  | { type: 'decline'; callId: string }
  | { type: 'connected'; callId: string }
  | { type: 'mode'; callId: string; mode: Mode }
  | { type: 'finished'; callId: string; kind: CallKind; endedBy: EndedBy; voiceOf: string | null }
  | { type: 'end_sent'; callId: string }
  | { type: 'scored'; callId: string; result: CallResultView | null }
  | { type: 'scoring_gave_up'; callId: string }
  | { type: 'family_line_starting' }
  | { type: 'family_line_failed'; message: string }
  | { type: 'family_line_started'; callId: string; at: number }
  | { type: 'done' }
  | { type: 'notice'; tone: Notice['tone']; text: string }
  | { type: 'dismiss_notice' }
  | { type: 'hide_messages'; ids: number[] }
  | { type: 'show_messages'; ids: number[] };

export const initialPhoneState: PhoneUiState = {
  phone: null,
  link: 'loading',
  view: { name: 'waiting' },
  handled: [],
  notice: null,
  noticeSeq: 0,
  hiddenMessages: [],
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

function finishedState(state: PhoneUiState, action: Extract<PhoneAction, { type: 'finished' }>): PhoneUiState {
  if (callIdOf(state.view) !== action.callId) return state;
  if (action.kind === 'practice') {
    // The reveal is certain: every practice call ends here, however it ended.
    return {
      ...state,
      view: {
        name: 'reveal',
        callId: action.callId,
        voiceOf: action.voiceOf,
        endedBy: action.endedBy,
        endSent: false,
        scoring: 'waiting',
        result: null,
        startingFamilyLine: false,
        familyLineError: null,
      },
    };
  }
  const waiting: PhoneUiState = { ...state, view: { name: 'waiting' } };
  if (action.kind === 'welcome') {
    return action.endedBy === 'error'
      ? withNotice(waiting, 'error', 'The call could not connect. Your family can ring again from their laptop.')
      : withNotice(waiting, 'good', 'Thank you for the call. You are all set, and Callback stays on.');
  }
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
        view.name === 'waiting' || (view.name === 'reveal' && !view.startingFamilyLine);
      if (canRing && incoming && !state.handled.includes(incoming.call_id)) {
        next = { ...next, view: { name: 'ringing', call: incoming }, notice: null };
      } else if (view.name === 'ringing' && incoming?.call_id !== view.call.call_id) {
        // It stopped ringing before an answer: missed, or cancelled.
        next = { ...next, view: { name: 'waiting' }, handled: remember(state.handled, view.call.call_id) };
        next = withNotice(next, 'info', `Missed call from ${view.call.caller.label}.`, true);
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
        },
      };

    case 'answer_failed':
      if (callIdOf(view) !== action.callId) return state;
      return withNotice({ ...state, view: { name: 'waiting' } }, 'error', action.message);

    case 'decline':
      if (view.name !== 'ringing' || view.call.call_id !== action.callId) return state;
      return { ...state, view: { name: 'waiting' }, handled: remember(state.handled, action.callId) };

    case 'connected':
      if ((view.name !== 'in_call' && view.name !== 'family_line') || view.callId !== action.callId) return state;
      return view.connected ? state : { ...state, view: { ...view, connected: true } };

    case 'mode':
      if ((view.name !== 'in_call' && view.name !== 'family_line') || view.callId !== action.callId) return state;
      return { ...state, view: { ...view, mode: action.mode, connected: true } };

    case 'finished':
      return finishedState(state, action);

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
      return view.name === 'reveal' && !view.startingFamilyLine ? { ...state, view: { name: 'waiting' } } : state;

    case 'notice':
      return withNotice(state, action.tone, action.text);

    case 'dismiss_notice':
      return { ...state, notice: null };

    case 'hide_messages':
      return { ...state, hiddenMessages: [...new Set([...state.hiddenMessages, ...action.ids])] };

    case 'show_messages':
      return { ...state, hiddenMessages: state.hiddenMessages.filter((id) => !action.ids.includes(id)) };
  }
}
