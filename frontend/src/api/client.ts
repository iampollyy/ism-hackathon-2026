// One small client for the back end. Every path is under /api: in
// development Vite proxies it to the back end, on the server the back end
// serves the front end itself, so relative URLs work everywhere.
//
// Errors come back as { "error": { "code", "message" } }; they are thrown
// as ApiError with that code and message, ready to show.

import type {
  CallCreated, CallView, ConsentUpdate, FamilyCreate, FamilyCreated, FamilyLineStarted, FamilyView,
  Ok, PhoneEvent, PhoneState, PracticeCallCreate, ScenarioView, Session, VoiceReady, EndedBy,
} from './types';

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
