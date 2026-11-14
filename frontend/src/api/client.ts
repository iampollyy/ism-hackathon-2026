// One small client for the back end. Every path is under /api: in
// development Vite proxies it to the back end, on the server the back end
// serves the front end itself, so relative URLs work everywhere.
//
// Errors come back as { "error": { "code", "message" } }; they are thrown
// as ApiError with that code and message, ready to show.

import type {
  ActivityView, AlertRequest, AlertSent, CallCreated, CallView, ConsentUpdate, DrillList, DrillPause, EndedBy,
  FamilyCreate, FamilyCreated, FamilyLineStarted, FamilyList, FamilyPlanView, FamilyView, Habits, Joined, JoinIn,
  JoinView, LearnTactics, LoginIn, Me, NewsRefreshed, NewsView, Ok, PhoneEvent, PhoneState, PlanChoice,
  PracticeCallCreate, Pricing, ProgressView, ProtectionMemberView, ProtectionUpdate, ProtectionView, RegisterIn,
  ScenarioView, Session, ShieldCallCreated, ShieldCallRequest, SurpriseDrillCreated, SurpriseDrillRequest,
  VoiceReady, VoiceSampleAccepted, VoiceSampleStatus, WaitlistCount, WaitlistIn, MemberAdd, MemberAdded,
  LiveCallCreated, LiveSide, LiveSignalKind, LiveSignals, ScribeToken,
} from './types';
import type { PushPublicKey } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = init.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...init.headers };
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network', 'No connection to the server. Check the internet and try again.');
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error;
    throw new ApiError(response.status, error?.code ?? 'error', error?.message ?? `Something went wrong (${response.status}).`);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  // families and members
  createFamily: (body: FamilyCreate) => request<FamilyCreated>('/families', json(body)),
  getFamily: (familyId: string) => request<FamilyView>(`/families/${familyId}`),
  /** Add a person later (organiser only); they join through the returned invite_link. */
  addMember: (familyId: string, body: MemberAdd) => request<MemberAdded>(`/families/${familyId}/members`, json(body)),
  setConsent: (memberId: string, body: ConsentUpdate) => request<Ok>(`/members/${memberId}/consent`, json(body)),
  uploadVoice: (memberId: string, audio: Blob, filename: string) => {
    const form = new FormData();
    form.append('audio', audio, filename);
    return request<VoiceReady>(`/members/${memberId}/voice`, { method: 'POST', body: form });
  },
  deleteVoice: (memberId: string) => request<Ok>(`/members/${memberId}/voice`, { method: 'DELETE' }),
  optOut: (memberId: string) => request<Ok>(`/members/${memberId}/opt-out`, { method: 'POST' }),

  // starting calls (laptop)
  scenarios: () => request<ScenarioView[]>('/scenarios'),
  startPractice: (body: PracticeCallCreate) => request<CallCreated>('/practice-calls', json(body)),
  startWelcomeCall: (memberId: string) => request<CallCreated>(`/members/${memberId}/welcome-call`, { method: 'POST' }),
  getCall: (callId: string) => request<CallView>(`/calls/${callId}`),

  // the phone page
  phoneState: (memberId: string) => request<PhoneState>(`/members/${memberId}/phone-state`),
  markMessagesRead: (memberId: string, ids?: number[]) =>
    request<Ok>(`/members/${memberId}/messages/read`, json(ids ? { ids } : {})),
  answer: (callId: string) => request<Session>(`/calls/${callId}/answer`, { method: 'POST' }),
  decline: (callId: string) => request<Ok>(`/calls/${callId}/decline`, { method: 'POST' }),
  sendEvents: (callId: string, events: PhoneEvent[]) => request<Ok>(`/calls/${callId}/events`, json({ events })),
  endCall: (callId: string, endedBy: EndedBy) => request<Ok>(`/calls/${callId}/end`, json({ ended_by: endedBy })),
  familyLine: (memberId: string) => request<FamilyLineStarted>(`/members/${memberId}/family-line`, { method: 'POST' }),

  // organiser accounts (a cb_session cookie; same-origin fetch sends it)
  register: (body: RegisterIn) => request<Me>('/auth/register', json(body)),
  login: (body: LoginIn) => request<Me>('/auth/login', json(body)),
  logout: () => request<Ok>('/auth/logout', { method: 'POST' }),
  me: () => request<Me>('/auth/me'),
  myFamilies: () => request<FamilyList>('/families'),

  // joining by invite (/join/:memberId)
  getJoin: (memberId: string) => request<JoinView>(`/join/${memberId}`),
  join: (memberId: string, body: JoinIn) => request<Joined>(`/join/${memberId}`, json(body)),

  // the member's voice from their own side of the welcome call
  uploadVoiceSample: (callId: string, audio: Blob, filename: string) => {
    const form = new FormData();
    form.append('audio', audio, filename);
    return request<VoiceSampleAccepted>(`/calls/${callId}/voice-sample`, { method: 'POST', body: form });
  },
  voiceSampleStatus: (callId: string) => request<VoiceSampleStatus>(`/calls/${callId}/voice-sample/status`),
  memberVoiceSample: (memberId: string) => request<VoiceSampleStatus>(`/members/${memberId}/voice-sample`),

  // protection, random drills and the Shield
  protection: (familyId: string) => request<ProtectionView>(`/families/${familyId}/protection`),
  setProtection: (familyId: string, body: ProtectionUpdate) =>
    request<ProtectionView>(`/families/${familyId}/protection`, { method: 'PUT', body: JSON.stringify(body) }),
  pauseDrills: (memberId: string, body: DrillPause) =>
    request<ProtectionMemberView>(`/members/${memberId}/drills`, { method: 'PUT', body: JSON.stringify(body) }),
  surpriseDrill: (familyId: string, body: SurpriseDrillRequest = { within_seconds: 60 }) =>
    request<SurpriseDrillCreated>(`/families/${familyId}/surprise-drill`, json(body)),
  shieldCall: (familyId: string, body: ShieldCallRequest) =>
    request<ShieldCallCreated>(`/families/${familyId}/shield-call`, json(body)),
  alertFamily: (memberId: string, body: AlertRequest = {}) => request<AlertSent>(`/members/${memberId}/alert`, json(body)),

  // live calls: a person calls a member, browser to browser, and the Shield listens
  startLiveCall: (familyId: string, memberId: string) =>
    request<LiveCallCreated>(`/families/${familyId}/live-call`, json({ member_id: memberId })),
  answerLive: (callId: string) => request<Ok>(`/calls/${callId}/live/answer`, { method: 'POST' }),
  sendSignal: (callId: string, side: LiveSide, kind: LiveSignalKind, data: Record<string, unknown> = {}) =>
    request<Ok>(`/calls/${callId}/live/signal`, json({ side, kind, data })),
  signals: (callId: string, side: LiveSide, after: number) =>
    request<LiveSignals>(`/calls/${callId}/live/signal?side=${side}&after=${after}`),
  scribeToken: (callId: string) => request<ScribeToken>(`/calls/${callId}/live/scribe-token`, { method: 'POST' }),

  // review, progress, learning, news
  drills: (familyId: string, memberId?: string, limit = 50) =>
    request<DrillList>(`/families/${familyId}/drills?${new URLSearchParams({ ...(memberId ? { member_id: memberId } : {}), limit: String(limit) })}`),
  activity: (familyId: string, limit = 100) => request<ActivityView>(`/families/${familyId}/activity?limit=${limit}`),
  progress: (memberId: string) => request<ProgressView>(`/members/${memberId}/progress`),
  tactics: () => request<LearnTactics>('/learn/tactics'),
  habits: () => request<Habits>('/learn/habits'),
  news: (familyId: string) => request<NewsView>(`/families/${familyId}/news`),
  refreshNews: (familyId: string) => request<NewsRefreshed>(`/families/${familyId}/news/refresh`, { method: 'POST' }),

  // plans (demo mode: no payment, no card details) and the waitlist
  pricing: () => request<Pricing>('/pricing'),
  plan: (familyId: string) => request<FamilyPlanView>(`/families/${familyId}/plan`),
  choosePlan: (familyId: string, body: PlanChoice) => request<FamilyPlanView>(`/families/${familyId}/plan`, json(body)),
  cancelPlan: (familyId: string) => request<FamilyPlanView>(`/families/${familyId}/plan/cancel`, { method: 'POST' }),
  joinWaitlist: (body: WaitlistIn) => request<Ok>('/waitlist', json(body)),
  waitlistCount: () => request<WaitlistCount>('/waitlist/count'),

  // Web Push: wakes a phone whose page is closed (docs/backend.md, "Waking the phone")
  pushPublicKey: () => request<PushPublicKey>('/push/public-key'),
  /** The browser's PushSubscription.toJSON(), as it is. */
  subscribePush: (memberId: string, subscription: PushSubscriptionJSON) =>
    request<Ok>(`/members/${memberId}/push-subscription`, json(subscription)),
  unsubscribePush: (memberId: string, endpoint: string) =>
    request<Ok>(`/members/${memberId}/push-subscription`, { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
};

/** The live stream of a call, for the laptop (see StreamEventMap in types.ts). */
export function callStreamUrl(callId: string): string {
  return `/api/calls/${callId}/events`;
}

/** The address phones should open, for QR codes. On the server it is this
 * site; in local development set VITE_PUBLIC_URL to the HTTPS address phones
 * can reach, because localhost means nothing on a phone. */
export function publicUrl(path: string): string {
  const base = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') || window.location.origin;
  return `${base}${path}`;
}
