// Types for the back end's API. Request and response shapes come from the
// generated `schema.d.ts` (openapi-typescript on the back end's OpenAPI
// description, so they cannot drift from backend/app/schemas.py). The live
// stream's events are not in OpenAPI, so they are written out here from
// docs/backend.md ("Reading a call").
//
// Regenerate schema.d.ts after a back-end change (from the repo root):
//   cd backend && .venv/bin/python -c "import json; from app.main import app; json.dump(app.openapi(), open('/tmp/openapi.json','w'))"
//   cd ../frontend && npx -y openapi-typescript@7.13.0 /tmp/openapi.json -o src/api/schema.d.ts

import type { components } from './schema';

type S = components['schemas'];

// ---------------------------------------------------------------- responses and requests

export type Health = S['Health'];
export type FamilyCreate = S['FamilyCreate'];
export type MemberCreate = S['MemberCreate'];
export type FamilyCreated = S['FamilyCreated'];
export type MemberLink = S['MemberLink'];
export type FamilyView = S['FamilyView'];
export type MemberView = S['MemberView'];
export type ReadinessView = S['ReadinessView'];
export type ReadinessItemView = S['ReadinessItemView'];
export type FamilyReadinessView = S['FamilyReadinessView'];
export type PlanView = S['PlanView'];
export type PlanStepView = S['PlanStepView'];
export type WeekItem = S['WeekItem'];
export type ConsentView = S['ConsentView'];
export type ConsentUpdate = S['ConsentUpdate'];
export type ScenarioView = S['ScenarioView'];
export type PracticeCallCreate = S['PracticeCallCreate'];
export type CallCreated = S['CallCreated'];
export type CallView = S['CallView'];
export type CallResultView = S['CallResultView'];
export type TurnView = S['TurnView'];
export type TacticView = S['TacticView'];
export type RiskPointView = S['RiskPointView'];
export type PersonRef = S['PersonRef'];
export type PhoneState = S['PhoneState'];
export type PhoneMessage = S['PhoneMessage'];
export type IncomingCall = S['IncomingCall'];
export type Session = S['Session'];
export type Reveal = S['Reveal'];
export type FamilyLineStarted = S['FamilyLineStarted'];
export type VoiceReady = S['VoiceReady'];
export type Ok = S['Ok'];
export type PushPublicKey = S['PushPublicKey'];

// The full app (Saturday): accounts, joining, voice from the welcome call,
// protection and the Shield, review, learning, news, plans, waitlist.
export type Me = S['Me'];
export type LoginIn = S['LoginIn'];
export type RegisterIn = S['RegisterIn'];
export type FamilyList = S['FamilyList'];
export type JoinView = S['JoinView'];
export type JoinIn = S['JoinIn'];
export type Joined = S['Joined'];
export type VoiceSampleAccepted = S['VoiceSampleAccepted'];
export type VoiceSampleStatus = S['VoiceSampleStatus'];
export type ProtectionView = S['ProtectionView'];
export type ProtectionUpdate = S['ProtectionUpdate'];
export type ProtectionMemberView = S['ProtectionMemberView'];
export type DrillPause = S['DrillPause'];
export type SurpriseDrillRequest = S['SurpriseDrillRequest'];
export type SurpriseDrillCreated = S['SurpriseDrillCreated'];
export type ShieldCallRequest = S['ShieldCallRequest'];
export type ShieldCallCreated = S['ShieldCallCreated'];
export type AlertRequest = S['AlertRequest'];
export type AlertSent = S['AlertSent'];
export type DrillList = S['DrillList'];
export type ActivityView = S['ActivityView'];
export type ProgressView = S['ProgressView'];
export type LearnTactics = S['LearnTactics'];
export type Habits = S['Habits'];
export type NewsView = S['NewsView'];
export type NewsRefreshed = S['NewsRefreshed'];
export type Pricing = S['Pricing'];
export type PricePlan = S['PricePlan'];
export type FamilyPlanView = S['FamilyPlanView'];
export type PlanChoice = S['PlanChoice'];
export type WaitlistIn = S['WaitlistIn'];
export type WaitlistCount = S['WaitlistCount'];
export type MemberAdd = S['MemberAdd'];
export type MemberAdded = S['MemberAdded'];
export type LiveCallCreated = S['LiveCallCreated'];
export type LiveSignals = S['LiveSignals'];
export type ScribeToken = S['ScribeToken'];
export type LiveSignalKind = 'offer' | 'answer' | 'ice' | 'bye';
export type LiveSide = 'caller' | 'callee';

// ---------------------------------------------------------------- fixed lists

export type Tactic =
  | 'new_number' | 'urgency' | 'secrecy' | 'authority'
  | 'emotional_appeal' | 'small_ask_first' | 'isolation' | 'unusual_payment';
export type Outcome = 'asked_safe_word' | 'hung_up' | 'asked_personal_question' | 'hesitated' | 'agreed';
export type ScenarioKey = 'relative_new_number' | 'police' | 'bank_security' | 'hospital';
export type CallKind = 'welcome' | 'practice' | 'family_line';
export type CallStatus = 'scheduled' | 'ringing' | 'in_progress' | 'ended' | 'scored' | 'declined' | 'missed' | 'failed';
export type EndedBy = 'agent' | 'user' | 'timeout' | 'error';
export type Speaker = 'agent' | 'user';
export type RiskLevel = 'green' | 'yellow' | 'red';
export type RiskSignal = Tactic | 'money_request' | 'asks_for_code' | 'refuses_callback';

export const TACTICS: readonly Tactic[] = [
  'new_number', 'urgency', 'secrecy', 'authority', 'emotional_appeal', 'small_ask_first', 'isolation', 'unusual_payment',
];
export const OUTCOMES: readonly Outcome[] = ['asked_safe_word', 'hung_up', 'asked_personal_question', 'hesitated', 'agreed'];
/** Outcomes where the person did the safe thing (the result card turns green). */
export const SAFE_OUTCOMES: readonly Outcome[] = ['asked_safe_word', 'hung_up', 'asked_personal_question'];

// Copied from backend/app/schemas.py (TACTIC_LABELS, OUTCOME_LABELS, RISK_SIGNAL_LABELS).
export const TACTIC_LABELS: Record<Tactic, string> = {
  new_number: 'New number',
  urgency: 'Urgency',
  secrecy: 'Secrecy',
  authority: 'Authority',
  emotional_appeal: 'Emotional appeal',
  small_ask_first: 'Small ask first',
  isolation: "Don't call anyone",
  unusual_payment: 'Unusual payment',
};
export const OUTCOME_LABELS: Record<Outcome, string> = {
  asked_safe_word: 'Asked for the family word',
  hung_up: 'Hung up',
  asked_personal_question: 'Asked a personal question',
  hesitated: 'Hesitated',
  agreed: 'Agreed',
};
export const RISK_SIGNAL_LABELS: Record<RiskSignal, string> = {
  ...TACTIC_LABELS,
  money_request: 'Asks for money',
  asks_for_code: 'Asks for a code',
  refuses_callback: 'Avoids a call-back',
};

export function isTactic(value: unknown): value is Tactic {
  return typeof value === 'string' && (TACTICS as readonly string[]).includes(value);
}
export function isOutcome(value: unknown): value is Outcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------- events the phone sends

export type PhoneEvent =
  | { type: 'turn'; speaker: Speaker; text: string }
  | { type: 'tactic'; key: Tactic }
  | { type: 'outcome'; outcome: Outcome }
  | { type: 'revealed' }
  | { type: 'consent'; given: boolean }
  | { type: 'voice_consent'; given: boolean };

// ---------------------------------------------------------------- the live stream (GET /api/calls/{id}/events)

// Every event is named (use addEventListener, never onmessage). Its SSE id is
// its sequence number; `t` is seconds since the call was answered (null
// before that). The stream replays the whole call on connect, so skip ids
// already seen. When the call is finished the server ends the stream and a
// reconnect gets 204; close the EventSource yourself on `result`.
export type StreamEventMap = {
  'call.status': { status: CallStatus; t: number | null };
  turn: { speaker: Speaker; text: string; t: number | null };
  tactic: { key: Tactic; label: string; t: number | null };
  outcome: { outcome: Outcome; seconds_to_challenge?: number | null; t: number | null };
  revealed: { t: number | null };
  consent: { given: boolean; t: number | null };
  'callback.connected': { seconds: number | null; family_line_call_id?: string; t: number | null };
  result: {
    outcome: Outcome;
    seconds_to_challenge: number | null;
    lesson: string;
    debrief: string;
    tactics_used: Tactic[];
    tactics_worked: Tactic[];
    callback_seconds: number | null;
    t: number | null;
  };
  risk: {
    level: RiskLevel;
    signals: RiskSignal[];
    labels: string[];
    reason: string;
    turn_index: number;
    source: string;
    t: number | null;
  };
  /** A shield call turned red: the family was alerted (once per call). */
  'shield.alert': { alerted: number; level: RiskLevel; t: number | null };
};
export type StreamEventType = keyof StreamEventMap;
export const STREAM_EVENT_TYPES: readonly StreamEventType[] = [
  'call.status', 'turn', 'tactic', 'outcome', 'revealed', 'consent', 'callback.connected', 'result', 'risk',
  'shield.alert',
];
