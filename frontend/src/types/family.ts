export type MemberPlanStep = {
  when: string;
  scenario: string;
  why: string;
  status: 'done' | 'scheduled' | 'next';
};

export type MemberPlan = {
  thisWeek: string;
  steps: MemberPlanStep[];
};

export type ReadinessItem = {
  label: string;
  before: number;
  now: number;
  max: number;
};

export type FamilyMember = {
  id: string;
  name: string;
  relationship: string;
  consent: boolean;
  voiceReady: boolean;
  readiness: {
    before: number;
    now: number;
    items: ReadinessItem[];
  };
  weakSpot: string;
  quote: string;
  plan: MemberPlan;
  nextPractice: string;
  accent: string;
};

export type FamilySummary = {
  id: string;
  name: string;
  safeWord: string;
  familyNumber: string;
  readiness: {
    before: number;
    now: number;
  };
  members: FamilyMember[];
  week: {
    recent: string[];
    planned: string[];
  };
};

export type CallTurn = {
  speaker: 'caller' | 'member';
  text: string;
  t: number;
  tactic?: string;
};

export type CallTactic = {
  key: string;
  label: string;
  t: number;
};

export type PracticeCall = {
  id: string;
  kind: 'practice';
  target: string;
  voiceOf: string;
  scenario: string;
  status: 'ringing' | 'in_progress' | 'ended';
  turns: CallTurn[];
  tactics: CallTactic[];
  result: {
    outcome: 'asked_safe_word' | 'hung_up' | 'hesitated';
    secondsToChallenge: number;
    lesson: string;
  };
  callbackSeconds: number;
};
