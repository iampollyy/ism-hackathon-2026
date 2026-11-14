// One state for the live call screen, built either from the stream's events
// (applied in order, deduplicated by seq) or, when there is no stream, from
// the call object (GET /api/calls/{id}). Both paths end in the same shape,
// so the screen does not care which one fed it.

import type {
  CallStatus, CallView, EndedBy, Outcome, RiskLevel, RiskPointView, RiskSignal, Speaker, StreamEventType, Tactic,
} from '../../api/types';
import { isOutcome, isTactic, SAFE_OUTCOMES, TACTIC_LABELS } from '../../api/types';

export type LiveTurn = { speaker: Speaker; text: string; t: number | null };

/** A tactic the caller marked. turnIndex is the caller line it belongs to,
 * null while no caller line has been heard yet (it then joins the next one). */
export type LiveTactic = { key: Tactic; label: string; t: number | null; turnIndex: number | null };

/** What the person did. afterTurns: how many lines had been said when it happened. */
export type LiveOutcome = { outcome: Outcome; secondsToChallenge: number | null; afterTurns: number };

export type LiveResult = {
  outcome: Outcome;
  seconds_to_challenge: number | null;
  lesson: string;
  debrief: string | null;
  tactics_used: Tactic[];
  tactics_worked: Tactic[];
};

/** The Shield alerted the family (a shield call only, at most once).
 * turnIndex: the caller line whose risk check set it off, when known. */
export type ShieldAlert = { alerted: number; level: RiskLevel | null; t: number | null; turnIndex: number | null };

export type LiveState = {
  /** Where the conversation below came from. */
  source: 'none' | 'snapshot' | 'stream';
  /** The call object, for the header (target, voice, scenario, timestamps). */
  call: CallView | null;
  lastSeq: number;
  status: CallStatus | null;
  endedBy: EndedBy | null;
  turns: LiveTurn[];
  tactics: LiveTactic[];
  risk: RiskPointView[];
  outcome: LiveOutcome | null;
  revealed: boolean;
  consent: boolean | null;
  callback: { seconds: number | null } | null;
  result: LiveResult | null;
  shieldAlert: ShieldAlert | null;
};

export type RawEvent = { type: StreamEventType; data: unknown; seq: number };

export type LiveAction =
  | { type: 'reset' }
  | { type: 'events'; events: RawEvent[] }
  /** replace: rebuild the conversation from the call (polling). Otherwise
   * only the header is taken, unless nothing else has filled the screen yet. */
  | { type: 'snapshot'; call: CallView; replace: boolean };

export const initialState: LiveState = {
  source: 'none',
  call: null,
  lastSeq: 0,
  status: null,
  endedBy: null,
  turns: [],
  tactics: [],
  risk: [],
  outcome: null,
  revealed: false,
  consent: null,
  callback: null,
  result: null,
  shieldAlert: null,
};

// ---------------------------------------------------------------- statuses

const STATUS_RANK: Record<CallStatus, number> = {
  scheduled: 0, ringing: 1, in_progress: 2, ended: 3, scored: 4, declined: 5, missed: 5, failed: 5,
};
const STATUSES = Object.keys(STATUS_RANK) as CallStatus[];
const ENDED_BY: readonly EndedBy[] = ['agent', 'user', 'timeout', 'error'];

/** The status further along, so a stale call object never moves the screen back. */
export function laterStatus(a: CallStatus | null, b: CallStatus | null): CallStatus | null {
  if (!a) return b;
  if (!b) return a;
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

export const FINAL_STATUSES: readonly CallStatus[] = ['declined', 'missed', 'failed'];

/** The family number can be tapped up to ten minutes after a practice ends
 * (backend: CALLBACK_WINDOW_SECONDS). */
export const CALLBACK_WINDOW_MS = 10 * 60 * 1000;

/** Back-end timestamps are ISO 8601 in UTC, sometimes without a zone and
 * with microseconds; read them safely. */
export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  let text = value.trim().replace(/(\.\d{3})\d+/, '$1');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(text)) text += 'Z';
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

export function callbackWindowOver(endedAt: string | null | undefined, now = Date.now()): boolean {
  const ended = parseTime(endedAt);
  return ended !== null && now - ended > CALLBACK_WINDOW_MS;
}

/** Nothing more will happen on this call: polling and the stream can stop. */
export function isCallDone(call: CallView): boolean {
  if (FINAL_STATUSES.includes(call.status)) return true;
  if (call.status !== 'scored') return false;
  if (call.kind !== 'practice' || call.callback_seconds !== null) return true;
  return callbackWindowOver(call.ended_at);
}

// ---------------------------------------------------------------- applying events

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

function lastCallerTurn(turns: LiveTurn[]): number | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) if (turns[i].speaker === 'agent') return i;
  return null;
}

function tacticList(value: unknown): Tactic[] {
  return Array.isArray(value) ? value.filter(isTactic) : [];
}

function riskPoint(data: Record<string, unknown>): RiskPointView | null {
  const level = str(data.level);
  if (level !== 'green' && level !== 'yellow' && level !== 'red') return null;
  const signals = Array.isArray(data.signals) ? data.signals.filter((s): s is RiskSignal => typeof s === 'string') : [];
  const labels = Array.isArray(data.labels) ? data.labels.filter((s): s is string => typeof s === 'string') : [];
  return {
    level,
    signals,
    labels,
    reason: str(data.reason) ?? '',
    turn_index: num(data.turn_index) ?? -1,
    source: str(data.source) ?? '',
    t: num(data.t),
  };
}

function applyEvent(state: LiveState, event: RawEvent): LiveState {
  if (Number.isFinite(event.seq) && event.seq > 0) {
    if (event.seq <= state.lastSeq) return state; // already seen (the stream replays on connect)
    state = { ...state, lastSeq: event.seq };
  }
  const data = record(event.data);
  const t = num(data.t);

  switch (event.type) {
    case 'call.status': {
      const status = str(data.status) as CallStatus | null;
      if (!status || !STATUSES.includes(status)) return state;
      const endedBy = str(data.ended_by) as EndedBy | null;
      return {
        ...state,
        status: laterStatus(state.status, status),
        endedBy: endedBy && ENDED_BY.includes(endedBy) ? endedBy : state.endedBy,
      };
    }
    case 'turn': {
      const speaker = str(data.speaker);
      const text = str(data.text);
      if ((speaker !== 'agent' && speaker !== 'user') || !text) return state;
      const turns: LiveTurn[] = [...state.turns, { speaker, text, t }];
      // Tactics marked before any caller line join the first caller line.
      const tactics = speaker === 'agent' && state.tactics.some((x) => x.turnIndex === null)
        ? state.tactics.map((x) => (x.turnIndex === null ? { ...x, turnIndex: turns.length - 1 } : x))
        : state.tactics;
      return { ...state, turns, tactics };
    }
    case 'tactic': {
      if (!isTactic(data.key)) return state;
      const tactic: LiveTactic = {
        key: data.key,
        label: str(data.label) ?? TACTIC_LABELS[data.key],
        t,
        turnIndex: lastCallerTurn(state.turns),
      };
      return { ...state, tactics: [...state.tactics, tactic] };
    }
    case 'outcome': {
      if (!isOutcome(data.outcome) || state.outcome) return state; // the first one counts
      return {
        ...state,
        outcome: { outcome: data.outcome, secondsToChallenge: num(data.seconds_to_challenge), afterTurns: state.turns.length },
      };
    }
    case 'revealed':
      return { ...state, revealed: true };
    case 'consent':
      return typeof data.given === 'boolean' ? { ...state, consent: data.given } : state;
    case 'callback.connected':
      return { ...state, callback: { seconds: num(data.seconds) } };
    case 'result': {
      if (!isOutcome(data.outcome)) return state;
      const result: LiveResult = {
        outcome: data.outcome,
        seconds_to_challenge: num(data.seconds_to_challenge),
        lesson: str(data.lesson) ?? '',
        debrief: str(data.debrief),
        tactics_used: tacticList(data.tactics_used),
        tactics_worked: tacticList(data.tactics_worked),
      };
      const callbackSeconds = num(data.callback_seconds);
      return {
        ...state,
        result,
        status: laterStatus(state.status, 'scored'),
        callback: state.callback ?? (callbackSeconds !== null ? { seconds: callbackSeconds } : null),
      };
    }
    case 'risk': {
      const point = riskPoint({ ...data, t });
      return point ? { ...state, risk: [...state.risk, point] } : state;
    }
    case 'shield.alert': {
      if (state.shieldAlert) return state; // once per call
      const level = str(data.level);
      // It comes right after the risk event that set it off.
      const last = state.risk.length ? state.risk[state.risk.length - 1] : null;
      return {
        ...state,
        shieldAlert: {
          alerted: num(data.alerted) ?? 0,
          level: level === 'green' || level === 'yellow' || level === 'red' ? level : null,
          t,
          turnIndex: last && last.turn_index >= 0 ? last.turn_index : null,
        },
      };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------- the Shield

/** Signals that warn even on yellow (backend: services/shield.py WARN_SIGNALS). */
const WARN_SIGNALS: readonly RiskSignal[] = ['money_request', 'asks_for_code', 'refuses_callback'];

/** A risk reading the Shield acts on: red, or yellow with money, a code or a dodged call-back. */
export function riskWarns(point: RiskPointView | null | undefined): boolean {
  if (!point) return false;
  return point.level === 'red' || (point.level === 'yellow' && point.signals.some((signal) => WARN_SIGNALS.includes(signal)));
}

/** The alert as the call object tells it (replay, or the screen polling). */
function shieldAlertFromCall(call: CallView): ShieldAlert | null {
  const shield = call.shield;
  if (!shield || !shield.alerted_at) return null;
  const at = parseTime(shield.alerted_at);
  const answered = parseTime(call.answered_at);
  const first = (call.risk ?? []).find(riskWarns);
  return {
    alerted: shield.alerted,
    level: shield.alert_level ?? null,
    t: at !== null && answered !== null ? Math.max(0, (at - answered) / 1000) : null,
    turnIndex: first && first.turn_index >= 0 ? first.turn_index : null,
  };
}

/** The whole state rebuilt from the call object: the replay path when there is no stream. */
export function stateFromCall(call: CallView): LiveState {
  const turns: LiveTurn[] = call.turns.map((turn) => ({ speaker: turn.speaker, text: turn.text, t: turn.t ?? null }));
  // A tactic belongs to the caller line just before it (as the back end reads it).
  const firstCaller = turns.findIndex((turn) => turn.speaker === 'agent');
  const tactics: LiveTactic[] = call.tactics.map((tactic) => {
    let turnIndex = -1;
    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      if (turn.speaker === 'agent' && (tactic.t === null || turn.t === null || turn.t <= tactic.t)) turnIndex = index;
    }
    if (turnIndex === -1) turnIndex = firstCaller;
    return { key: tactic.key, label: tactic.label || TACTIC_LABELS[tactic.key], t: tactic.t, turnIndex: turnIndex === -1 ? null : turnIndex };
  });
  const result: LiveResult | null = call.result
    ? {
      outcome: call.result.outcome,
      seconds_to_challenge: call.result.seconds_to_challenge,
      lesson: call.result.lesson,
      debrief: call.result.debrief ?? null,
      tactics_used: call.result.tactics_used ?? [],
      tactics_worked: call.result.tactics_worked ?? [],
    }
    : null;
  // Before scoring, the call object carries the first outcome the phone
  // reported (live_outcome) and the welcome call's consent answer so far.
  const outcomeKey = result?.outcome ?? call.live_outcome ?? null;
  const challengeAt = result ? result.seconds_to_challenge : call.live_seconds_to_challenge ?? null;
  return {
    ...initialState,
    source: 'snapshot',
    call,
    status: call.status,
    endedBy: call.ended_by ?? null,
    turns,
    tactics,
    risk: call.risk ?? [],
    outcome: outcomeKey
      ? {
        outcome: outcomeKey,
        secondsToChallenge: challengeAt,
        afterTurns: challengeAt === null ? turns.length : turns.filter((turn) => turn.t === null || turn.t <= challengeAt).length,
      }
      : null,
    // The phone always shows the reveal after an answered practice that ended.
    revealed: call.kind === 'practice' && !!call.answered_at && (call.status === 'ended' || call.status === 'scored'),
    consent: call.consent_given ?? null,
    callback: call.callback_seconds !== null ? { seconds: call.callback_seconds } : null,
    result,
    shieldAlert: shieldAlertFromCall(call),
  };
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'reset':
      return initialState;
    case 'events': {
      // The first stream events replace whatever the call object showed: the
      // stream replays the whole call, so starting clean avoids doubles.
      let next: LiveState = state.source === 'stream' ? state : { ...initialState, call: state.call, source: 'stream' };
      for (const event of action.events) next = applyEvent(next, event);
      if (next.call) next = { ...next, status: laterStatus(next.status, next.call.status) };
      return next;
    }
    case 'snapshot': {
      if (action.replace || state.source === 'none') return stateFromCall(action.call);
      return {
        ...state,
        call: action.call,
        status: laterStatus(state.status, action.call.status),
        endedBy: state.endedBy ?? action.call.ended_by ?? null,
        callback: state.callback ?? (action.call.callback_seconds !== null ? { seconds: action.call.callback_seconds } : null),
        shieldAlert: state.shieldAlert ?? shieldAlertFromCall(action.call),
      };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------- reading the state

export function isSafe(outcome: Outcome | null | undefined): boolean {
  return !!outcome && SAFE_OUTCOMES.includes(outcome);
}

export function latestRisk(state: LiveState): RiskPointView | null {
  return state.risk.length ? state.risk[state.risk.length - 1] : null;
}

const LEVEL_RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 };

/** The caller lines where the light went up a colour, for markers in the conversation. */
export function riskChanges(risk: RiskPointView[]): Map<number, RiskPointView> {
  const changes = new Map<number, RiskPointView>();
  let level: RiskLevel = 'green';
  for (const point of risk) {
    if (LEVEL_RANK[point.level] > LEVEL_RANK[level]) {
      level = point.level;
      if (point.turn_index >= 0) changes.set(point.turn_index, point);
    }
  }
  return changes;
}

/** Signals both the caller marked and the independent check heard. */
export function agreeing(state: LiveState): Set<string> {
  const heard = new Set<string>(latestRisk(state)?.signals ?? []);
  return new Set(state.tactics.map((tactic) => tactic.key).filter((key) => heard.has(key)));
}

// ---------------------------------------------------------------- the scam's stages

export type StageKey = 'hook' | 'story' | 'urgency' | 'ask' | 'pressure' | 'reveal';
export type Stage = { key: StageKey; label: string; reached: boolean; at: number | null };

const STAGE_LABELS: Record<StageKey, string> = {
  hook: 'Hook', story: 'Story', urgency: 'Urgency', ask: 'The ask', pressure: 'Pressure', reveal: 'Reveal',
};

// Which tactics (from the caller) and warning signals (from the risk check)
// show that a stage has been reached.
const STAGE_SIGNALS: Record<'story' | 'urgency' | 'ask' | 'pressure', readonly RiskSignal[]> = {
  story: ['new_number', 'emotional_appeal', 'authority'],
  urgency: ['urgency'],
  ask: ['small_ask_first', 'unusual_payment', 'money_request', 'asks_for_code'],
  pressure: ['secrecy', 'isolation', 'refuses_callback'],
};

/** Stages derived from what happened: the first caller line is the hook, the
 * reveal is the reveal, and the stages between are reached when the caller
 * marks a matching tactic or the risk check hears a matching signal. `at` is
 * the caller line where it was first seen. Stages can be skipped. */
export function deriveStages(state: LiveState, revealed: boolean): Stage[] {
  const firstCaller = state.turns.findIndex((turn) => turn.speaker === 'agent');
  const firstSeen = (signals: readonly RiskSignal[]): number | null => {
    const lines: number[] = [];
    for (const tactic of state.tactics) {
      if (signals.includes(tactic.key) && tactic.turnIndex !== null) lines.push(tactic.turnIndex);
    }
    for (const point of state.risk) {
      if (point.turn_index >= 0 && point.signals.some((signal) => signals.includes(signal))) lines.push(point.turn_index);
    }
    return lines.length ? Math.min(...lines) : null;
  };
  const at: Record<StageKey, number | null> = {
    hook: firstCaller === -1 ? null : firstCaller,
    story: firstSeen(STAGE_SIGNALS.story),
    urgency: firstSeen(STAGE_SIGNALS.urgency),
    ask: firstSeen(STAGE_SIGNALS.ask),
    pressure: firstSeen(STAGE_SIGNALS.pressure),
    reveal: revealed ? Number.MAX_SAFE_INTEGER : null,
  };
  return (Object.keys(STAGE_LABELS) as StageKey[]).map((key) => ({
    key, label: STAGE_LABELS[key], reached: at[key] !== null, at: at[key],
  }));
}

/** The furthest stage reached before the person did the safe thing, if they did. */
export function stoppedAt(stages: Stage[], outcome: LiveOutcome | null): Stage | null {
  if (!outcome || !isSafe(outcome.outcome)) return null;
  let last: Stage | null = null;
  for (const stage of stages) {
    if (stage.key !== 'reveal' && stage.at !== null && stage.at < outcome.afterTurns) last = stage;
  }
  return last;
}
